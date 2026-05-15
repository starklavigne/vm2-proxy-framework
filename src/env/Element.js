const createStyleProxy = require('./CSSStyleDeclaration');
const DOMTokenList = require('./DOMTokenList');
const NamedNodeMap = require('./NamedNodeMap');
const { nativize } = require('../utils/tools');

// 尝试加载集合类
let HTMLCollection, NodeList;
try {
    const dom = require('./DOMCollection');
    HTMLCollection = dom.HTMLCollection;
    NodeList = dom.NodeList;
} catch (e) {
    HTMLCollection = Array;
    NodeList = Array;
}

// ==========================================
// 1. 辅助工具
// ==========================================
const parsePx = (val) => {
    if (!val) return 0;
    if (typeof val === 'number') return val;
    const n = parseFloat(val);
    return isNaN(n) ? 0 : n;
};

// ==========================================
// 2. 本地僵尸节点 (Zombie) - 必须同步加强
// ==========================================
class ZombieElement {
    constructor() {
        this.tagName = 'ZOMBIE';
        this.nodeType = 1;
        this.style = {};
        this.classList = { add:()=>{}, remove:()=>{}, contains:()=>false, toggle:()=>{} };
        this.id = '';
        // 【核心修复】补全属性，防止访问 undefined.readyState 崩溃
        this.readyState = 'complete';
        this.src = '';
    }
    insertBefore() { return this; }
    appendChild(child) { return child; }
    removeChild(child) { return child; }
    replaceChild(newChild) { return newChild; }
    getAttribute() { return null; }
    setAttribute() {}
    get children() { return []; }
    get childNodes() { return []; }
    // 链式调用保护
    querySelector() { return this; }
    querySelectorAll() { return []; }
    getElementsByTagName() { return []; }
    getElementById() { return this; }
    // 尺寸保护
    getBoundingClientRect() { return { x:0, y:0, width:0, height:0, top:0, left:0, right:0, bottom:0 }; }
    getClientRects() { return [{top:0, left:0, width:0, height:0}]; }
}
const theZombie = new ZombieElement();

// ==========================================
// 3. Element 核心类
// ==========================================
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

        // 样式与属性
        this.style = createStyleProxy(this);
        this.classList = new DOMTokenList(this);
        this.attributes = new NamedNodeMap(this._attributes);
        this.dataset = {};

        // 事件桩
        this.attachEvent = undefined;
        this.detachEvent = undefined;
        this.fireEvent = undefined;

        // 媒体/脚本通用属性补全
        this.readyState = 'complete'; // 防止 Element被当作脚本/文档检测时崩溃

        // 特殊元素初始化
        if (this.tagName === 'IFRAME') this._setupIframe(context);
        if (this.tagName === 'FORM') {
            this.action = ""; this.method = "POST"; this.submit = () => {}; this.reset = () => {};
        }
    }

    _indexOf(node) {
        if (!node) return -1;
        return this._children.findIndex(c => c === node || (c._uid && node._uid && c._uid === node._uid));
    }

    // --- Iframe 模拟 (重点修复区域) ---
    _setupIframe(context) {
        // 创建一个伪造的 Document 对象
        const iframeDoc = new Element('#DOCUMENT', context);
        iframeDoc.nodeType = 9;
        iframeDoc.tagName = null;
        iframeDoc._uid = 'doc_iframe_' + Date.now();

        // 【核心修复】补全 Document 特有属性
        iframeDoc.readyState = 'complete';
        iframeDoc.domain = 'challenges.cloudflare.com';
        iframeDoc.cookie = '';
        // 关键：CF 可能会检查 currentScript
        iframeDoc.currentScript = theZombie;
        iframeDoc.scripts = [];

        const html = new Element('HTML', context);
        const head = new Element('HEAD', context);
        const body = new Element('BODY', context);

        iframeDoc.appendChild(html);
        html.appendChild(head);
        html.appendChild(body);

        iframeDoc.documentElement = html;
        iframeDoc.head = head;
        iframeDoc.body = body;

        // 简易工厂
        iframeDoc.createElement = (tag) => {
             const el = new Element(tag, context);
             el.ownerDocument = iframeDoc;
             if(tag.toUpperCase() === 'SCRIPT') iframeDoc.scripts.push(el);
             return el;
        };
        // 【核心修复】找不到时返回僵尸，而不是 null
        iframeDoc.getElementById = (id) => theZombie;
        iframeDoc.querySelector = (sel) => theZombie;
        iframeDoc.getElementsByTagName = (t) => new HTMLCollection([]);

        iframeDoc.open = () => iframeDoc;
        iframeDoc.close = () => {};
        iframeDoc.write = () => {};

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

    // --- 树操作 ---
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
            const a = new Element('A', this._context);
            if (hrefMatch) a.href = hrefMatch[1];
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
            [...newNode._children].reverse().forEach(c => this.insertBefore(c, refNode));
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

    // --- 查询与属性 ---
    // 默认返回 Zombie，防止链式调用报错
    querySelector(selector) { return theZombie; }
    getElementsByTagName(tagName) { return new HTMLCollection([]); }
    getElementsByClassName(className) { return new HTMLCollection([]); }
    getElementById(id) { return theZombie; }

    getAttribute(name) { return this._attributes[name] || this[name] || null; }
    setAttribute(name, value) {
        this._attributes[name] = String(value);
        if (name === 'id') this.id = value;
        if (!['href', 'src', 'style', 'tagName', 'nodeType'].includes(name)) {
            this[name] = value;
        }
    }
    removeAttribute(name) { delete this._attributes[name]; delete this[name]; }
    hasAttribute(name) { return Object.prototype.hasOwnProperty.call(this._attributes, name); }

    get href() { return this._attributes['href'] || ''; }
    set href(val) { this._attributes['href'] = val; }

    // --- 布局引擎模拟 ---
    _computeLayout() {
        if (this.style.display === 'none' || this.style.visibility === 'hidden') {
            return { w: 0, h: 0, x: 0, y: 0 };
        }
        let w = parsePx(this.style.width);
        if (w === 0) {
            const blockTags = ['DIV', 'P', 'FORM', 'BODY', 'HTML', 'H1', 'H2', 'HEADER', 'FOOTER'];
            const screenW = 1920;
            if (this.tagName === 'BODY' || this.tagName === 'HTML') w = screenW;
            else if (blockTags.includes(this.tagName)) w = screenW;
            else w = 50;
        }
        let h = parsePx(this.style.height);
        if (h === 0) {
            if (this.tagName === 'BODY' || this.tagName === 'HTML') h = 1080;
            else h = 20;
        }
        let x = parsePx(this.style.left) || parsePx(this.style.marginLeft) || 0;
        let y = parsePx(this.style.top) || parsePx(this.style.marginTop) || 0;
        if (this.parentNode && this.parentNode !== theZombie) {
            const index = this.parentNode._indexOf(this);
            if (index > 0) y += index * 20;
        }
        return { w, h, x, y };
    }

    get offsetWidth() { return this._computeLayout().w; }
    get offsetHeight() { return this._computeLayout().h; }
    get clientWidth() { return this.offsetWidth; }
    get clientHeight() { return this.offsetHeight; }
    get offsetLeft() { return this._computeLayout().x; }
    get offsetTop() { return this._computeLayout().y; }

    getBoundingClientRect() {
        const { w, h, x, y } = this._computeLayout();
        return { x, y, left: x, top: y, right: x + w, bottom: y + h, width: w, height: h };
    }

    getClientRects() {
        return [this.getBoundingClientRect()];
    }

    focus() {}
    blur() {}
    click() {}
    toString() { return `[object ${this.constructor.name}]`; }
}

module.exports = Element;