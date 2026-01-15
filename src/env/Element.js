const createStyleProxy = require('./CSSStyleDeclaration');
const DOMTokenList = require('./DOMTokenList');
const NamedNodeMap = require('./NamedNodeMap');

// 懒加载集合类
let HTMLCollection, NodeList;
try {
    const dom = require('./DOMCollection');
    HTMLCollection = dom.HTMLCollection;
    NodeList = dom.NodeList;
} catch (e) {
    HTMLCollection = Array;
    NodeList = Array;
}

class Element {
    constructor(tagName = 'div', context = null) {
        this.tagName = (tagName || 'DIV').toUpperCase();
        this._context = context;
        // 【核心修复】唯一身份标识，用于穿透 Proxy
        this._uid = 'el_' + Math.random().toString(36).slice(2) + Date.now();

        this._children = [];
        this._innerHTML = "";
        this.textContent = "";
        this.nodeType = 1;
        this.id = "";
        this._attributes = {};
        this.ownerDocument = null;
        this._parentNode = null;

        this.style = createStyleProxy(this);
        this.classList = new DOMTokenList(this);
        this.attributes = new NamedNodeMap(this._attributes);
        this.dataset = {};

        this.attachEvent = undefined;
        this.detachEvent = undefined;
        this.fireEvent = undefined;

        if (this.tagName === 'IFRAME') {
            this._setupIframe(context);
        }
        if (this.tagName === 'FORM') {
            this.action = "";
            this.method = "POST";
            this.submit = () => {};
            this.reset = () => {};
        }
    }

    // 【核心修复】模糊查找辅助函数
    _indexOf(node) {
        if (!node) return -1;
        // 既匹配引用，也匹配 UID (穿透 Proxy)
        return this._children.findIndex(c => c === node || (c._uid && node._uid && c._uid === node._uid));
    }

    _setupIframe(context) {
        const iframeDoc = new Element('#DOCUMENT', context);
        iframeDoc.nodeType = 9;
        iframeDoc.tagName = null;

        const html = new Element('HTML', context);
        const head = new Element('HEAD', context);
        const body = new Element('BODY', context);

        iframeDoc.appendChild(html);
        html.appendChild(head);
        html.appendChild(body);

        iframeDoc.documentElement = html;
        iframeDoc.head = head;
        iframeDoc.body = body;

        iframeDoc.createElement = (tag) => {
             const el = new Element(tag, context);
             el.ownerDocument = iframeDoc;
             return el;
        };
        iframeDoc.getElementById = (id) => null;
        iframeDoc.getElementsByTagName = (tagName) => {
            const tag = tagName.toUpperCase();
            const res = [];
            const find = (node) => {
                if(node.tagName === tag) res.push(node);
                node._children.forEach(find);
            };
            find(html);
            return new HTMLCollection(res);
        };
        iframeDoc.write = () => {};
        iframeDoc.open = () => iframeDoc;
        iframeDoc.close = () => {};
        iframeDoc.cookie = "";

        this.contentWindow = new Proxy(context || {}, {
            get: (target, prop) => {
                if (prop === 'document') return iframeDoc;
                if (prop === 'frameElement') return this;
                if (prop === 'top' || prop === 'parent') return target;
                if (prop === 'self' || prop === 'window') return this.contentWindow;
                return Reflect.get(target, prop);
            }
        });
        this.contentDocument = iframeDoc;
    }

    // --- Accessors ---
    get children() { return new HTMLCollection(this._children.filter(c => c.nodeType === 1)); }
    get childNodes() { return new NodeList(this._children); }
    get firstChild() { return this._children[0] || null; }
    get lastChild() { return this._children[this._children.length - 1] || null; }

    get parentNode() { return this._parentNode || null; }
    set parentNode(node) { this._parentNode = node; }

    get nextSibling() {
        if(!this._parentNode) return null;
        const idx = this._parentNode._indexOf(this);
        return this._parentNode._children[idx + 1] || null;
    }

    get innerHTML() { return this._innerHTML; }
    set innerHTML(val) {
        this._innerHTML = String(val);
        this._children = [];
        const str = String(val);
        if (str.includes('<a') || str.includes('<A')) {
            const hrefMatch = str.match(/href=["'](.*?)["']/i);
            const contentMatch = str.match(/>(.*?)</);
            const a = new Element('A', this._context);
            if (hrefMatch) a.href = hrefMatch[1];
            if (contentMatch) a.textContent = contentMatch[1];
            this.appendChild(a);
        }
    }

    // --- DOM Ops (使用 _indexOf) ---

    appendChild(child) {
        if (!child) return null;
        // 如果已存在，先移除
        if (this._indexOf(child) >= 0) {
             this.removeChild(child);
        }
        child.parentNode = this;
        this._children.push(child);
        return child;
    }

    removeChild(child) {
        const i = this._indexOf(child);
        if (i >= 0) {
            this._children.splice(i, 1);
            child.parentNode = null;
        }
        return child;
    }

    insertBefore(newNode, refNode) {
        if (!newNode) return null;
        if (!refNode) return this.appendChild(newNode);

        const i = this._indexOf(refNode); // 使用 UID 匹配
        if (i >= 0) {
            newNode.parentNode = this;
            this._children.splice(i, 0, newNode);
        } else {
            // 容错：如果找不到参照物，追加到末尾
            this.appendChild(newNode);
        }
        return newNode;
    }

    replaceChild(newChild, oldChild) {
        const i = this._indexOf(oldChild);
        if (i >= 0) {
            newChild.parentNode = this;
            this._children[i] = newChild;
            oldChild.parentNode = null;
            return oldChild;
        }
        return this.appendChild(newChild);
    }

    // --- Query ---
    querySelector(selector) {
        if (!selector) return null;
        if (selector.startsWith('#')) {
            const id = selector.slice(1);
            const find = (node) => {
                if (node.id === id) return node;
                for (const c of node._children) {
                    const r = find(c);
                    if (r) return r;
                }
                return null;
            }
            return find(this);
        }
        const tag = selector.toUpperCase();
        const find = (node) => {
             if (node.tagName === tag) return node;
             for (const c of node._children) {
                 const r = find(c);
                 if (r) return r;
             }
             return null;
        };
        return find(this) || null;
    }

    getElementsByTagName(tagName) {
        const tag = tagName.toUpperCase();
        const result = [];
        const traverse = (node) => {
            for (const child of node._children) {
                if (child.nodeType === 1) {
                    if (tag === '*' || child.tagName === tag) result.push(child);
                    traverse(child);
                }
            }
        };
        traverse(this);
        return new HTMLCollection(result);
    }

    getElementsByClassName(className) { return new HTMLCollection([]); }

    getAttribute(name) { return this._attributes[name] || this[name] || null; }
    setAttribute(name, value) {
        this._attributes[name] = String(value);
        if (name === 'id') this.id = value;
        if (name !== 'href' && name !== 'src' && name !== 'style') this[name] = value;
    }
    removeAttribute(name) { delete this._attributes[name]; delete this[name]; }
    hasAttribute(name) { return Object.prototype.hasOwnProperty.call(this._attributes, name); }

    get href() { return this._attributes['href'] || ''; }
    set href(val) { this._attributes['href'] = val; }

    getBoundingClientRect() { return { top: 0, left: 0, width: 0, height: 0, x: 0, y: 0, bottom: 0, right: 0 }; }
    getClientRects() { return [{ top: 0, left: 0, width: 0, height: 0 }]; }

    focus() {}
    blur() {}
    click() {}
    toString() { return `[object ${this.constructor.name}]`; }
}

module.exports = Element;