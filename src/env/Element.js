const createStyleProxy = require('./CSSStyleDeclaration');
const DOMTokenList = require('./DOMTokenList');
const NamedNodeMap = require('./NamedNodeMap');
const { nativize } = require('../utils/tools'); // 假设 tools 就在这里，如果路径不对请调整

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
// 1. 辅助工具：像素解析与布局计算
// ==========================================
const parsePx = (val) => {
    if (!val) return 0;
    if (typeof val === 'number') return val;
    const n = parseFloat(val);
    return isNaN(n) ? 0 : n;
};

// ==========================================
// 2. 僵尸节点 (Zombie) - 防御最终防线
// ==========================================
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
    // 僵尸节点的尺寸永远是 0，防止逻辑穿透
    getBoundingClientRect() { return { x:0, y:0, width:0, height:0, top:0, left:0, right:0, bottom:0 }; }
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

        // 特殊元素初始化
        if (this.tagName === 'IFRAME') this._setupIframe(context);
        if (this.tagName === 'FORM') {
            this.action = ""; this.method = "POST"; this.submit = () => {}; this.reset = () => {};
        }
    }

    // --- 内部索引查找 ---
    _indexOf(node) {
        if (!node) return -1;
        return this._children.findIndex(c => c === node || (c._uid && node._uid && c._uid === node._uid));
    }

    // --- Iframe 模拟 ---
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

        // 简易工厂
        iframeDoc.createElement = (tag) => {
             const el = new Element(tag, context);
             el.ownerDocument = iframeDoc;
             return el;
        };
        iframeDoc.getElementById = () => null;
        iframeDoc.getElementsByTagName = (t) => new HTMLCollection([]);

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
        // 简易的 A 标签解析，防止脚本仅仅为了检查链接而崩溃
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
        if (child.nodeType === 11) { // Fragment
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
    querySelector(selector) { return null; } // 由 HTMLNode.js 覆盖
    getElementsByTagName(tagName) { return new HTMLCollection([]); } // 由 HTMLNode.js 覆盖
    getElementsByClassName(className) { return new HTMLCollection([]); }

    getAttribute(name) { return this._attributes[name] || this[name] || null; }
    setAttribute(name, value) {
        this._attributes[name] = String(value);
        if (name === 'id') this.id = value;
        // 不允许直接覆盖关键属性
        if (!['href', 'src', 'style', 'tagName', 'nodeType'].includes(name)) {
            this[name] = value;
        }
    }
    removeAttribute(name) { delete this._attributes[name]; delete this[name]; }
    hasAttribute(name) { return Object.prototype.hasOwnProperty.call(this._attributes, name); }

    get href() { return this._attributes['href'] || ''; }
    set href(val) { this._attributes['href'] = val; }


    // ==========================================
    // 【核心修复】布局引擎模拟 (Fake Layout Engine)
    // ==========================================

    // 内部方法：计算自身的尺寸和位置
    _computeLayout() {
        // 1. 隐藏元素检查
        if (this.style.display === 'none' || this.style.visibility === 'hidden') {
            return { w: 0, h: 0, x: 0, y: 0 };
        }

        // 2. 宽度计算 (Width)
        let w = parsePx(this.style.width);
        if (w === 0) {
            // 如果没有显式设置宽度，根据类型给默认值
            const blockTags = ['DIV', 'P', 'FORM', 'BODY', 'HTML', 'H1', 'H2', 'HEADER', 'FOOTER'];
            const screenW = 1920; // 假设屏幕宽
            if (this.tagName === 'BODY' || this.tagName === 'HTML') w = screenW;
            else if (blockTags.includes(this.tagName)) w = screenW; // 块级元素占满
            else w = 50; // 行内元素默认给一点宽度
        }

        // 3. 高度计算 (Height)
        let h = parsePx(this.style.height);
        if (h === 0) {
            if (this.tagName === 'BODY' || this.tagName === 'HTML') h = 1080;
            else h = 20; // 默认行高
        }

        // 4. 位置计算 (Position X, Y)
        // 简易流式布局：Y 轴简单累加，防止所有元素都在 (0,0)
        let x = parsePx(this.style.left) || parsePx(this.style.marginLeft) || 0;
        let y = parsePx(this.style.top) || parsePx(this.style.marginTop) || 0;

        // 如果在文档流中，且有父节点，累加父节点位置
        if (this.parentNode && this.parentNode !== theZombie) {
            // 获取父节点的计算布局（递归可能会深，这里只取 DOM 树上的偏移）
            // 为了性能和防止死循环，我们不递归调用父节点的 getBoundingClientRect
            // 而是简单假设父节点位置为 0，或者基于 siblings 索引计算偏移

            // 简易垂直堆叠逻辑：
            // 如果我是父节点的第 N 个子元素，我的 Y 坐标大约是 N * 20
            const index = this.parentNode._indexOf(this);
            if (index > 0) {
                y += index * 20; // 模拟每个兄弟元素高 20px
            }
        }

        return { w, h, x, y };
    }

    get offsetWidth() {
        return this._computeLayout().w;
    }

    get offsetHeight() {
        return this._computeLayout().h;
    }

    get clientWidth() {
        return this.offsetWidth; // 简化：不减去边框
    }

    get clientHeight() {
        return this.offsetHeight;
    }

    get offsetLeft() {
        return this._computeLayout().x;
    }

    get offsetTop() {
        return this._computeLayout().y;
    }

    // 关键方法：被 CF 重点检测
    getBoundingClientRect() {
        const { w, h, x, y } = this._computeLayout();

        // 注意：getBoundingClientRect 返回的是相对于 Viewport 的坐标
        // 这里的 x, y 已经是简易计算后的模拟值
        return {
            x: x,
            y: y,
            left: x,
            top: y,
            right: x + w,
            bottom: y + h,
            width: w,
            height: h
        };
    }

    getClientRects() {
        return [this.getBoundingClientRect()];
    }

    // 交互方法桩
    focus() {}
    blur() {}
    click() {}
    toString() { return `[object ${this.constructor.name}]`; }
}

// 导出
module.exports = Element;