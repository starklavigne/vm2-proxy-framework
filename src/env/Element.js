const createStyleProxy = require('./CSSStyleDeclaration');
const DOMTokenList = require('./DOMTokenList');
const NamedNodeMap = require('./NamedNodeMap');

let HTMLCollection, NodeList;
try {
    const dom = require('./DOMCollection');
    HTMLCollection = dom.HTMLCollection;
    NodeList = dom.NodeList;
} catch (e) {
    HTMLCollection = Array;
    NodeList = Array;
}

// 僵尸节点防御机制
class ZombieElement {
    constructor() {
        this.tagName = 'ZOMBIE';
        this.nodeType = 1;
        this.style = {};
        this.classList = { add:()=>{}, remove:()=>{}, contains:()=>false };
    }
    insertBefore() { return null; }
    appendChild(child) { return child; }
    removeChild(child) { return child; }
    replaceChild(newChild) { return newChild; }
    getAttribute() { return null; }
    setAttribute() {}
    get children() { return []; }
    get childNodes() { return []; }
}
const theZombie = new ZombieElement();

class Element {
    constructor(tagName = 'div', context = null) {
        this.tagName = (tagName || 'DIV').toUpperCase();
        this._context = context;
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

        if (this.tagName === 'IFRAME') this._setupIframe(context);
        if (this.tagName === 'FORM') {
            this.action = ""; this.method = "POST"; this.submit = () => {}; this.reset = () => {};
        }
    }

    _indexOf(node) {
        if (!node) return -1;
        return this._children.findIndex(c => c === node || (c._uid && node._uid && c._uid === node._uid));
    }

    _setupIframe(context) {
        const iframeDoc = new Element('#DOCUMENT', context);
        iframeDoc.nodeType = 9;
        iframeDoc.tagName = null;
        iframeDoc._uid = 'doc_iframe_' + Date.now();

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

    get parentNode() { return this._parentNode || theZombie; }
    set parentNode(node) { this._parentNode = node; }

    get children() { return new HTMLCollection(this._children.filter(c => c.nodeType === 1)); }
    get childNodes() { return new NodeList(this._children); }
    get firstChild() { return this._children[0] || null; }
    get lastChild() { return this._children[this._children.length - 1] || null; }

    get nextSibling() {
        if(!this._parentNode || this._parentNode === theZombie) return null;
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

    appendChild(child) {
        if (!child) return null;
        if (child.nodeType === 11) {
            const fragChildren = [...child._children];
            fragChildren.forEach(c => this.appendChild(c));
            child._children = [];
            return child;
        }
        if (this._indexOf(child) >= 0) this.removeChild(child);
        child.parentNode = this;
        this._children.push(child);
        return child;
    }

    removeChild(child) {
        const i = this._indexOf(child);
        if (i >= 0) {
            this._children.splice(i, 1);
            child._parentNode = null;
        }
        return child;
    }

    insertBefore(newNode, refNode) {
        if (!newNode) return null;
        if (!refNode) return this.appendChild(newNode);
        if (newNode.nodeType === 11) {
            const fragChildren = [...newNode._children];
            for (let k = fragChildren.length - 1; k >= 0; k--) {
                this.insertBefore(fragChildren[k], refNode);
            }
            newNode._children = [];
            return newNode;
        }
        const i = this._indexOf(refNode);
        if (i >= 0) {
            if (newNode.parentNode && newNode.parentNode !== theZombie) newNode.parentNode.removeChild(newNode);
            newNode.parentNode = this;
            this._children.splice(i, 0, newNode);
        } else {
            this.appendChild(newNode);
        }
        return newNode;
    };

    replaceChild(newChild, oldChild) {
        const i = this._indexOf(oldChild);
        if (i >= 0) {
            if (newChild.parentNode && newChild.parentNode !== theZombie) newChild.parentNode.removeChild(newChild);
            newChild.parentNode = this;
            this._children[i] = newChild;
            oldChild._parentNode = null;
            return oldChild;
        }
        return this.appendChild(newChild);
    }

    // 查询方法已在 HTMLNode.js 中通过 Mixin 覆盖，这里仅保留基础结构
    querySelector(selector) { return null; }
    getElementsByTagName(tagName) { return new HTMLCollection([]); }
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

    // 【核心修复】返回非零尺寸，防止被识别为 Hidden/Headless
    getBoundingClientRect() {
        return { top: 0, left: 0, width: 800, height: 600, x: 0, y: 0, bottom: 600, right: 800 };
    }
    getClientRects() {
        return [{ top: 0, left: 0, width: 800, height: 600 }];
    }

    focus() {}
    blur() {}
    click() {}
    toString() { return `[object ${this.constructor.name}]`; }
}

module.exports = Element;