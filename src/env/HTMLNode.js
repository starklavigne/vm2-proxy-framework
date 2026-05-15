const Crypto = require('./Crypto');

// ==========================================
// 1. 原生伪装工具
// ==========================================
const nativize = (func, name) => {
    if (typeof func !== 'function') return func;
    const funcName = name || func.name || '';
    const nativeString = `function ${funcName}() { [native code] }`;
    Object.defineProperty(func, 'toString', {
        value: () => nativeString,
        writable: true,
        configurable: true,
        enumerable: false
    });
    Object.defineProperty(func, 'name', {value: funcName, writable: false, configurable: true, enumerable: false});
    return func;
};

// ==========================================
// 2. 样式代理生成器
// ==========================================
const createStyleProxy = () => {
    const _values = {};
    return new Proxy(_values, {
        get: (target, prop) => {
            if (prop === 'getPropertyValue') return nativize((n) => target[n] || "", 'getPropertyValue');
            if (prop === 'setProperty') return nativize((n, v) => {
                target[n] = String(v);
            }, 'setProperty');
            if (prop === 'removeProperty') return nativize((n) => {
                delete target[n];
            }, 'removeProperty');
            if (prop === 'item') return nativize(() => "", 'item');
            return target[prop] || '';
        },
        set: (target, prop, value) => {
            target[prop] = String(value);
            return true;
        }
    });
};

const createClassList = (element) => {
    const tokens = new Set();
    const sync = () => {
        element._attributes.class = Array.from(tokens).join(' ');
        element.className = element._attributes.class;
    };
    return {
        add: (...items) => {
            items.forEach((item) => String(item).split(/\s+/).filter(Boolean).forEach((token) => tokens.add(token)));
            sync();
        },
        remove: (...items) => {
            items.forEach((item) => String(item).split(/\s+/).filter(Boolean).forEach((token) => tokens.delete(token)));
            sync();
        },
        contains: (token) => tokens.has(String(token)),
        toggle: (token, force) => {
            token = String(token);
            if (force === true) {
                tokens.add(token);
                sync();
                return true;
            }
            if (force === false) {
                tokens.delete(token);
                sync();
                return false;
            }
            if (tokens.has(token)) {
                tokens.delete(token);
                sync();
                return false;
            }
            tokens.add(token);
            sync();
            return true;
        },
        item: (index) => Array.from(tokens)[index] || null,
        toString: () => Array.from(tokens).join(' '),
        get value() { return Array.from(tokens).join(' '); },
        set value(value) {
            tokens.clear();
            String(value).split(/\s+/).filter(Boolean).forEach((token) => tokens.add(token));
            sync();
        },
        get length() { return tokens.size; },
        [Symbol.iterator]: function () { return tokens.values(); }
    };
};

const walkElements = (root, visitor) => {
    const children = root && root._children ? root._children : [];
    for (const child of children) {
        if (visitor(child)) return child;
        const found = walkElements(child, visitor);
        if (found) return found;
    }
    return null;
};

const collectElements = (root, visitor, result = []) => {
    const children = root && root._children ? root._children : [];
    for (const child of children) {
        if (visitor(child)) result.push(child);
        collectElements(child, visitor, result);
    }
    return result;
};

const matchesSimpleSelector = (node, selector) => {
    if (!node || node.nodeType !== 1 || !selector) return false;
    selector = String(selector).trim();
    if (!selector || selector === '*') return true;
    const attrMatches = [...selector.matchAll(/\[([^=\]\s]+)(?:=["']?([^"'\]]*)["']?)?\]/g)];
    selector = selector.replace(/\[[^\]]+\]/g, '');
    const idMatch = selector.match(/#([A-Za-z0-9_-]+)/);
    const classMatches = [...selector.matchAll(/\.([A-Za-z0-9_-]+)/g)].map((m) => m[1]);
    const tag = selector.replace(/#[A-Za-z0-9_-]+/g, '').replace(/\.[A-Za-z0-9_-]+/g, '').trim();

    if (tag && node.tagName !== tag.toUpperCase()) return false;
    if (idMatch && node.id !== idMatch[1]) return false;
    for (const className of classMatches) {
        if (!node.classList || !node.classList.contains(className)) return false;
    }
    for (const match of attrMatches) {
        const value = node.getAttribute ? node.getAttribute(match[1]) : null;
        if (value == null) return false;
        if (match[2] !== undefined && String(value) !== match[2]) return false;
    }
    return true;
};

const createElementFromHTML = (html, context) => {
    const tagMatch = html.match(/^<\s*([A-Za-z0-9:-]+)/);
    if (!tagMatch) return null;
    const element = new Element(tagMatch[1], context);
    const attrSource = html.slice(tagMatch[0].length, html.indexOf('>') === -1 ? html.length : html.indexOf('>'));
    attrSource.replace(/([A-Za-z_:][-A-Za-z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g, (_, name, v1, v2, v3) => {
        element.setAttribute(name, v1 ?? v2 ?? v3 ?? '');
        return '';
    });
    const textMatch = html.match(/>([^<]*)<\//);
    if (textMatch) element.textContent = textMatch[1];
    return element;
};

// ==========================================
// 3. 僵尸节点 (Zombie) - 终极防御
// ==========================================
class ZombieElement {
    constructor() {
        this.tagName = 'ZOMBIE';
        this.nodeType = 1;
        // 关键：僵尸也必须有 readyState，防止 undefined.readyState 这种虽然不报错但 null.readyState 会报错的情况
        // 如果这里返回 undefined，访问 z.readyState 是安全的。
        // 但如果通过 getElementById 返回了 null，访问 null.readyState 才会报你遇到的错。
        // 所以这里的核心是确保 getElementById 返回这个实例。
        this.readyState = 'complete';
        this.style = createStyleProxy();
        this.classList = {
            add: () => {}, remove: () => {}, contains: () => false, toggle: () => {}
        };
        this._children = [];
        this.id = '';
        this.name = '';
    }

    insertBefore() { return this; }
    appendChild(child) { return child; }
    removeChild(child) { return child; }
    replaceChild(n) { return n; }
    getAttribute() { return null; }
    setAttribute() {}
    querySelector() { return null; }
    querySelectorAll() { return []; }
    getElementsByTagName() { return []; }
    get parentNode() { return this; }
    get children() { return []; }
    get firstChild() { return null; }
    get nextSibling() { return null; }
    contains() { return false; }
    focus() {}
    blur() {}
    click() {}
    // 媒体相关属性防止崩溃
    canPlayType() { return ''; }
    load() {}
    play() { return Promise.resolve(); }
    pause() {}
}

const theZombie = new ZombieElement();

// ==========================================
// 4. Element 基类
// ==========================================
class Element {
    constructor(tagName = 'DIV', context = null) {
        this.tagName = (tagName || 'DIV').toUpperCase();

        Object.defineProperties(this, {
            '_context': {value: context, writable: true, enumerable: false},
            '_children': {value: [], writable: true, enumerable: false},
            '_attributes': {value: {}, writable: true, enumerable: false},
            '_parentNode': {value: null, writable: true, enumerable: false},
        });

        this.style = createStyleProxy();
        this.nodeType = 1;
        this.id = "";
        this.className = "";
        this.classList = createClassList(this);
        this.ownerDocument = context ? context.document : null;
    }

    get parentNode() { return this._parentNode || theZombie; }
    set parentNode(node) { this._parentNode = node; }

    get innerHTML() { return ""; }
    set innerHTML(val) {
        this._children.length = 0;
        this._innerHTML = String(val);
        const matches = String(val).match(/<\s*[A-Za-z0-9:-]+[^>]*>(?:[^<]*<\/\s*[A-Za-z0-9:-]+\s*>)?/g) || [];
        for (const chunk of matches) {
            const child = createElementFromHTML(chunk, this._context);
            if (child) this.appendChild(child);
        }
    }

    get children() { return this._children; }
    get childNodes() { return this._children; }
    get firstChild() { return this._children[0] || null; }
    get lastChild() { return this._children[this._children.length - 1] || null; }
    get parentElement() { return this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : null; }
    get firstElementChild() { return this._children.find((node) => node.nodeType === 1) || null; }
    get lastElementChild() {
        for (let i = this._children.length - 1; i >= 0; i--) {
            if (this._children[i].nodeType === 1) return this._children[i];
        }
        return null;
    }

    get nextSibling() {
        if (!this._parentNode || this._parentNode === theZombie) return null;
        const idx = this._parentNode._children.indexOf(this);
        return this._parentNode._children[idx + 1] || null;
    }

    get previousSibling() {
        if (!this._parentNode || this._parentNode === theZombie) return null;
        const idx = this._parentNode._children.indexOf(this);
        return idx > 0 ? this._parentNode._children[idx - 1] : null;
    }

    get nextElementSibling() {
        let node = this.nextSibling;
        while (node && node.nodeType !== 1) node = node.nextSibling;
        return node || null;
    }

    get previousElementSibling() {
        let node = this.previousSibling;
        while (node && node.nodeType !== 1) node = node.previousSibling;
        return node || null;
    }

    contains(otherNode) {
        if (otherNode === this) return true;
        let current = otherNode && otherNode.parentNode;
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
        if (child.tagName === 'IFRAME' && this._context) {
            if (!child.contentWindow || !child.contentWindow.eval) {
                child.contentWindow = this._context;
                child.contentDocument = this._context.document || null;
            }
            const frameIndex = Number(this._context.length || 0);
            this._context[frameIndex] = child.contentWindow || {};
            this._context.length = frameIndex + 1;
        }
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

    remove() {
        if (this._parentNode && this._parentNode !== theZombie) {
            this._parentNode.removeChild(this);
        }
    }

    insertBefore(newNode, refNode) {
        if (!newNode) return null;
        if (!refNode) return this.appendChild(newNode);
        const idx = this._children.indexOf(refNode);
        if (idx >= 0) {
            if (newNode.parentNode && newNode.parentNode !== theZombie) newNode.parentNode.removeChild(newNode);
            newNode.parentNode = this;
            this._children.splice(idx, 0, newNode);
            return newNode;
        }
        return this.appendChild(newNode);
    }

    replaceChild(newChild, oldChild) {
        const idx = this._children.indexOf(oldChild);
        if (idx >= 0) {
            if (newChild.parentNode && newChild.parentNode !== theZombie) newChild.parentNode.removeChild(newChild);
            newChild.parentNode = this;
            this._children[idx] = newChild;
            oldChild._parentNode = null;
            return oldChild;
        }
        return this.appendChild(newChild);
    }

    getAttribute(name) { return this._attributes[name] || null; }
    setAttribute(name, value) {
        name = String(name);
        this._attributes[name] = String(value);
        if (name === 'id') this.id = String(value);
        if (name === 'class') this.classList.value = String(value);
        if (name === 'name') this.name = String(value);
        if (name === 'src') this.src = String(value);
        if (name === 'href') this.href = String(value);
    }
    removeAttribute(name) { delete this._attributes[name]; }
    hasAttribute(name) { return Object.prototype.hasOwnProperty.call(this._attributes, name); }

    getElementsByTagName(tagName) {
        const tag = tagName.toUpperCase();
        return collectElements(this, (node) => node.nodeType === 1 && (node.tagName === tag || tag === '*'));
    }

    getElementsByClassName(className) {
        return collectElements(this, (node) => node.nodeType === 1 && node.classList && node.classList.contains(className));
    }

    querySelector(selector) {
        if (!selector) return null;
        const selectors = String(selector).split(',').map((part) => part.trim()).filter(Boolean);
        for (const sel of selectors) {
            const parts = sel.split(/\s+/);
            const last = parts[parts.length - 1];
            const found = walkElements(this, (node) => matchesSimpleSelector(node, last));
            if (found) return found;
        }
        return selector === '#jklY6' ? null : theZombie;
    }

    querySelectorAll(selector) {
        const selectors = String(selector || '').split(',').map((part) => part.trim()).filter(Boolean);
        if (!selectors.length) return [];
        return collectElements(this, (node) => selectors.some((sel) => matchesSimpleSelector(node, sel.split(/\s+/).pop())));
    }

    getBoundingClientRect() { return {top:0, left:0, width:0, height:0, x:0, y:0}; }
    getClientRects() { return [{top:0, left:0, width:0, height:0}]; }

    focus() {}
    blur() {}
    click() {}
}

['appendChild', 'removeChild', 'remove', 'insertBefore', 'replaceChild', 'getAttribute', 'setAttribute', 'getElementsByTagName', 'getElementsByClassName', 'querySelector', 'querySelectorAll', 'contains'].forEach(method => {
    Element.prototype[method] = nativize(Element.prototype[method], method);
});

// ==========================================
// 6. 具体元素类
// ==========================================
class HTMLElement extends Element {
    constructor(t, c) { super(t, c); }
}

class HTMLDivElement extends HTMLElement { constructor(c) { super('DIV', c); } }
class HTMLSpanElement extends HTMLElement { constructor(c) { super('SPAN', c); } }
class HTMLAnchorElement extends HTMLElement {
    constructor(c) { super('A', c); }
    get href() { return this.getAttribute('href') || ''; }
    set href(v) { this.setAttribute('href', v); }
}
class HTMLFormElement extends HTMLElement { constructor(c) { super('FORM', c); } }
class HTMLInputElement extends HTMLElement {
    constructor(c) { super('INPUT', c); }
    get value() { return this.getAttribute('value') || ''; }
    set value(v) { this.setAttribute('value', v); }
}
class HTMLButtonElement extends HTMLElement { constructor(c) { super('BUTTON', c); } }
class HTMLImageElement extends HTMLElement { constructor(c) { super('IMG', c); } }
class HTMLCanvasElement extends HTMLElement { constructor(c) { super('CANVAS', c); } }

// 【核心修复】Script 元素必须有 readyState
class HTMLScriptElement extends HTMLElement {
    constructor(c) {
        super('SCRIPT', c);
        this.src = "";
    }
    get readyState() { return 'complete'; } // 骗过 CF 的 script 加载检查
}

class HTMLIFrameElement extends HTMLElement {
    constructor(c) {
        super('IFRAME', c);
        // 这里的 c 是 windowContext
        this.contentWindow = c || {};
        this.contentDocument = this.contentWindow.document || null;
    }
}

class HTMLBodyElement extends HTMLElement { constructor(c) { super('BODY', c); } }
class HTMLHeadElement extends HTMLElement { constructor(c) { super('HEAD', c); } }
class HTMLHtmlElement extends HTMLElement { constructor(c) { super('HTML', c); } }

// 【核心修复】补充媒体元素，防止 new Audio() 后访问 readyState 崩溃
class HTMLMediaElement extends HTMLElement {
    constructor(tag, c) {
        super(tag, c);
        this.readyState = 0; // HAVE_NOTHING
    }
    canPlayType(type) { return 'probably'; }
    play() { return Promise.resolve(); }
    pause() {}
    load() {}
}

class HTMLAudioElement extends HTMLMediaElement { constructor(c) { super('AUDIO', c); } }
class HTMLVideoElement extends HTMLMediaElement { constructor(c) { super('VIDEO', c); } }

class SVGElement extends Element {
    constructor(t, c) {
        super(t, c);
        this.namespaceURI = "http://www.w3.org/2000/svg";
    }
}
class SVGGraphicsElement extends SVGElement {}
class SVGSVGElement extends SVGGraphicsElement {
    constructor(c) { super('svg', c); }
    createSVGPoint() { return {x:0, y:0}; }
    createSVGMatrix() { return {a:1, b:0, c:0, d:1, e:0, f:0}; }
    createSVGRect() { return {x:0, y:0, width:0, height:0}; }
}

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
    HTMLAudioElement: nativize(HTMLAudioElement, 'HTMLAudioElement'), // 新增
    HTMLVideoElement: nativize(HTMLVideoElement, 'HTMLVideoElement'), // 新增
    SVGElement: nativize(SVGElement, 'SVGElement'),
    SVGGraphicsElement: nativize(SVGGraphicsElement, 'SVGGraphicsElement'),
    SVGSVGElement: nativize(SVGSVGElement, 'SVGSVGElement'),
    theZombie // 导出僵尸供 Document 使用
};
