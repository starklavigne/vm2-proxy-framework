const Crypto = require('./Crypto');

// ==========================================
// 1. 原生伪装工具
// ==========================================
const nativize = (func, name) => {
    if (typeof func !== 'function') return func;
    const funcName = name || func.name || '';
    const nativeString = `function ${funcName}() { [native code] }`;
    Object.defineProperty(func, 'toString', { value: () => nativeString, writable: true, configurable: true, enumerable: false });
    Object.defineProperty(func, 'name', { value: funcName, writable: false, configurable: true, enumerable: false });
    return func;
};

// ==========================================
// 2. 样式代理生成器 (通用)
// ==========================================
const createStyleProxy = () => {
    const _values = {};
    return new Proxy(_values, {
        get: (target, prop) => {
            if (prop === 'getPropertyValue') return nativize((n) => target[n] || "", 'getPropertyValue');
            if (prop === 'setProperty') return nativize((n, v) => { target[n] = String(v); }, 'setProperty');
            if (prop === 'removeProperty') return nativize((n) => { delete target[n]; }, 'removeProperty');
            if (prop === 'item') return nativize(() => "", 'item');
            return target[prop] || '';
        },
        set: (target, prop, value) => {
            target[prop] = String(value);
            return true;
        }
    });
};

// ==========================================
// 3. 僵尸节点 (Zombie) - 防御最终防线
// ==========================================
class ZombieElement {
    constructor() {
        this.tagName = 'ZOMBIE';
        this.nodeType = 1;
        this.style = createStyleProxy(); // 【关键】僵尸必须有 style，否则 null.style 后的 obj.style 会崩
        this.classList = { add:()=>{}, remove:()=>{}, contains:()=>false, toggle:()=>{} };
        this._children = [];
        this.id = '';
    }
    insertBefore() { return this; }
    appendChild(child) { return child; } // 假装添加成功
    removeChild(child) { return child; }
    replaceChild(n) { return n; }
    getAttribute() { return null; }
    setAttribute() {}
    querySelector() { return this; } // 无限套娃，防止链式调用崩溃
    querySelectorAll() { return []; }
    getElementsByTagName() { return []; }
    get parentNode() { return this; }
    get children() { return []; }
    get firstChild() { return null; }
    get nextSibling() { return null; }
    contains() { return false; }
    focus() {}
    blur() {}
}
const theZombie = new ZombieElement();

// ==========================================
// 4. 简易 HTML 解析器
// ==========================================
const parseHTML = (html, context, ElementClass) => {
    const rootChildren = [];
    const stack = [];
    const tagRegex = /<\/?([a-zA-Z0-9\-]+)([^>]*)>/g;
    let match;

    while ((match = tagRegex.exec(html)) !== null) {
        const [fullTag, tagName, attrsStr] = match;
        const isCloseTag = fullTag.startsWith('</');
        const tag = tagName.toUpperCase();

        if (isCloseTag) {
            if (stack.length > 0 && stack[stack.length - 1].tagName === tag) stack.pop();
        } else {
            let el;
            const clsName = `HTML${tag.charAt(0).toUpperCase() + tag.slice(1).toLowerCase()}Element`;
            if (context && context[clsName]) {
                el = new context[clsName]();
            } else {
                el = new ElementClass(tag, context);
            }

            const attrRegex = /([a-zA-Z0-9\-]+)=["']([^"']*)["']/g;
            let attrMatch;
            while ((attrMatch = attrRegex.exec(attrsStr)) !== null) {
                el.setAttribute(attrMatch[1], attrMatch[2]);
            }

            if (stack.length > 0) {
                stack[stack.length - 1].appendChild(el);
            } else {
                rootChildren.push(el);
            }

            const voidTags = ['IMG', 'INPUT', 'BR', 'HR', 'META', 'LINK'];
            if (!voidTags.includes(tag) && !fullTag.endsWith('/>')) {
                stack.push(el);
            }
        }
    }
    return rootChildren;
};

// ==========================================
// 5. Element 基类
// ==========================================
class Element {
    constructor(tagName = 'DIV', context = null) {
        this.tagName = (tagName || 'DIV').toUpperCase();

        Object.defineProperties(this, {
            '_context': { value: context, writable: true, enumerable: false },
            '_children': { value: [], writable: true, enumerable: false },
            '_attributes': { value: {}, writable: true, enumerable: false },
            '_parentNode': { value: null, writable: true, enumerable: false },
        });

        this.style = createStyleProxy();

        this.nodeType = 1;
        this.id = "";
        this.classList = { add:()=>{}, remove:()=>{}, contains:()=>false, toggle:()=>{} };
        this.ownerDocument = context ? context.document : null;
    }

    // 1. parentNode 保护 (Getter 返回 Zombie, Setter 允许赋值)
    get parentNode() { return this._parentNode || theZombie; }
    set parentNode(node) { this._parentNode = node; }

    get innerHTML() { return ""; }
    set innerHTML(val) {
        this._children.length = 0;
        const str = String(val);
        if (!str) return;
        try {
            const nodes = parseHTML(str, this._context, Element);
            nodes.forEach(node => this.appendChild(node));
        } catch (e) { }
    }

    get children() { return this._children; }
    get childNodes() { return this._children; }
    get firstChild() { return this._children[0] || null; }
    get lastChild() { return this._children[this._children.length - 1] || null; }
    get nextSibling() {
        if (!this._parentNode || this._parentNode === theZombie) return null;
        const idx = this._parentNode._children.indexOf(this);
        return this._parentNode._children[idx + 1] || null;
    }

    contains(otherNode) {
        if (otherNode === this) return true;
        if (!otherNode) return false;
        let current = otherNode.parentNode;
        while (current && current !== theZombie) {
            if (current === this) return true;
            current = current.parentNode;
        }
        return false;
    }

    appendChild(child) {
        if (!child) return null;
        if (child.parentNode && child.parentNode !== theZombie) {
            child.parentNode.removeChild(child);
        }
        child.parentNode = this;
        this._children.push(child);
        return child;
    }

    removeChild(child) {
        const idx = this._children.indexOf(child);
        if (idx !== -1) {
            this._children.splice(idx, 1);
            child._parentNode = null;
        }
        return child;
    }

    insertBefore(newNode, refNode) {
        if (!newNode) return null;
        if (!refNode) return this.appendChild(newNode);

        const idx = this._children.indexOf(refNode);
        if (idx >= 0) {
            if (newNode.parentNode && newNode.parentNode !== theZombie) {
                newNode.parentNode.removeChild(newNode);
            }
            newNode.parentNode = this;
            this._children.splice(idx, 0, newNode);
            return newNode;
        }
        return this.appendChild(newNode);
    }

    replaceChild(newChild, oldChild) {
        const idx = this._children.indexOf(oldChild);
        if (idx >= 0) {
            if (newChild.parentNode && newChild.parentNode !== theZombie) {
                newChild.parentNode.removeChild(newChild);
            }
            newChild.parentNode = this;
            this._children[idx] = newChild;
            oldChild._parentNode = null;
            return oldChild;
        }
        return this.appendChild(newChild);
    }

    getAttribute(name) { return this._attributes[name] || null; }
    setAttribute(name, value) {
        this._attributes[name] = String(value);
        if (name === 'id') this.id = value;
    }
    removeAttribute(name) { delete this._attributes[name]; }
    hasAttribute(name) { return Object.prototype.hasOwnProperty.call(this._attributes, name); }

    getElementsByTagName(tagName) {
        const tag = tagName.toUpperCase();
        const res = [];
        const traverse = (node) => {
            if (node.tagName === tag || tag === '*') res.push(node);
            node._children.forEach(traverse);
        };
        this._children.forEach(traverse);
        return res;
    }

    // 【核心修复】querySelector 绝对不返回 null
    querySelector(selector) {
        if (!selector) return theZombie; // 空选择器返回僵尸

        // 1. 尝试查找
        if (selector.startsWith('#')) {
            const id = selector.slice(1);
            const traverse = (node) => {
                if (node.id === id) return node;
                for (const c of node._children) {
                    const r = traverse(c);
                    if (r) return r;
                }
                return null;
            }
            if (this.id === id) return this;
            let found = null;
            for (const child of this._children) {
                found = traverse(child);
                if (found) break;
            }

            // 2. 找不到？自动创建！
            if (!found) {
                console.log(`[DOM] Auto-creating missing element #${id}`);
                const el = new Element('DIV', this._context);
                el.id = id;
                this.appendChild(el);
                return el;
            }
            return found;
        }

        // Tag 查找
        const tag = selector.toUpperCase();
        const traverseTag = (node) => {
            if (node.tagName === tag) return node;
            for (const c of node._children) {
                const r = traverseTag(c);
                if (r) return r;
            }
            return null;
        }
        let foundTag = traverseTag(this);

        // 找不到 Tag？返回僵尸节点 (防止 null.style 报错)
        if (!foundTag) {
            // console.warn(`[DOM] Selector '${selector}' not found, returning Zombie.`);
            return theZombie;
        }
        return foundTag;
    }

    getBoundingClientRect() { return { top: 0, left: 0, width: 800, height: 600, x: 0, y: 0 }; }
    getClientRects() { return [{ top: 0, left: 0, width: 800, height: 600 }]; }
    focus() {}
    blur() {}
    click() {}
}

['appendChild', 'removeChild', 'insertBefore', 'replaceChild', 'getAttribute', 'setAttribute', 'getElementsByTagName', 'querySelector', 'contains'].forEach(method => {
    Element.prototype[method] = nativize(Element.prototype[method], method);
});

// ==========================================
// 6. 具体元素类
// ==========================================
class HTMLElement extends Element { constructor(t, c) { super(t, c); } }
class HTMLDivElement extends HTMLElement { constructor(c) { super('DIV', c); } }
class HTMLSpanElement extends HTMLElement { constructor(c) { super('SPAN', c); } }
class HTMLAnchorElement extends HTMLElement { constructor(c) { super('A', c); } get href() {return this.getAttribute('href')||'';} set href(v){this.setAttribute('href',v);} }
class HTMLFormElement extends HTMLElement { constructor(c) { super('FORM', c); } }
class HTMLInputElement extends HTMLElement { constructor(c) { super('INPUT', c); } get value(){return this.getAttribute('value')||'';} set value(v){this.setAttribute('value',v);} }
class HTMLButtonElement extends HTMLElement { constructor(c) { super('BUTTON', c); } }
class HTMLImageElement extends HTMLElement { constructor(c) { super('IMG', c); } }
class HTMLCanvasElement extends HTMLElement { constructor(c) { super('CANVAS', c); } }
class HTMLScriptElement extends HTMLElement { constructor(c) { super('SCRIPT', c); } }
class HTMLIFrameElement extends HTMLElement {
    constructor(c) {
        super('IFRAME', c);
        this.contentWindow = c ? c.window : {};
    }
}
class HTMLBodyElement extends HTMLElement { constructor(c) { super('BODY', c); } }
class HTMLHeadElement extends HTMLElement { constructor(c) { super('HEAD', c); } }
class HTMLHtmlElement extends HTMLElement { constructor(c) { super('HTML', c); } }

class SVGElement extends Element { constructor(t, c) { super(t, c); this.namespaceURI = "http://www.w3.org/2000/svg"; } }
class SVGGraphicsElement extends SVGElement { constructor(t, c) { super(t, c); } getBBox(){return {x:0,y:0,width:0,height:0};} getCTM(){return{a:1,b:0,c:0,d:1,e:0,f:0};} getScreenCTM(){return{a:1,b:0,c:0,d:1,e:0,f:0};} }
class SVGSVGElement extends SVGGraphicsElement { constructor(c) { super('svg', c); } createSVGPoint(){return{x:0,y:0};} createSVGMatrix(){return{a:1,b:0,c:0,d:1,e:0,f:0};} createSVGRect(){return{x:0,y:0,width:0,height:0};} }

module.exports = {
    Element: nativize(Element, 'Element'),
    HTMLElement: nativize(HTMLElement, 'HTMLElement'),
    HTMLDivElement: nativize(HTMLDivElement, 'HTMLDivElement'),
    HTMLSpanElement: nativize(HTMLSpanElement, 'HTMLSpanElement'),
    HTMLAnchorElement: nativize(HTMLAnchorElement, 'HTMLAnchorElement'),
    HTMLFormElement: nativize(HTMLFormElement, 'HTMLFormElement'),
    HTMLInputElement: nativize(HTMLInputElement, 'HTMLInputElement'),
    HTMLButtonElement: nativize(HTMLButtonElement, 'HTMLButtonElement'),
    HTMLImageElement: nativize(HTMLImageElement, 'HTMLImageElement'),
    HTMLCanvasElement: nativize(HTMLCanvasElement, 'HTMLCanvasElement'),
    HTMLScriptElement: nativize(HTMLScriptElement, 'HTMLScriptElement'),
    HTMLIFrameElement: nativize(HTMLIFrameElement, 'HTMLIFrameElement'),
    HTMLBodyElement: nativize(HTMLBodyElement, 'HTMLBodyElement'),
    HTMLHeadElement: nativize(HTMLHeadElement, 'HTMLHeadElement'),
    HTMLHtmlElement: nativize(HTMLHtmlElement, 'HTMLHtmlElement'),
    SVGElement: nativize(SVGElement, 'SVGElement'),
    SVGGraphicsElement: nativize(SVGGraphicsElement, 'SVGGraphicsElement'),
    SVGSVGElement: nativize(SVGSVGElement, 'SVGSVGElement')
};