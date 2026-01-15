const Element = require('./Element');
const {
    HTMLDivElement, HTMLSpanElement, HTMLAnchorElement, HTMLFormElement,
    HTMLIFrameElement, HTMLScriptElement, HTMLImageElement, HTMLCanvasElement,
    HTMLBodyElement, HTMLHeadElement, HTMLHtmlElement, HTMLElement,
    HTMLAudioElement, HTMLVideoElement
} = require('./HTMLNode');
const {HTMLCollection} = require('./DOMCollection');

class Document {
    constructor(profile, windowContext) {
        this._windowContext = windowContext;
        // 【关键】Document 也需要 UID
        this._uid = 'doc_' + Date.now();
        this.nodeType = 9;

        this.domain = "challenges.cloudflare.com";
        this.scripts = [];
        this.readyState = 'complete';
        this.onreadystatechange = null;

        // --- DOM 树 ---
        const createEl = (ClassType, tagName) => {
            const el = new ClassType(windowContext);
            if (tagName) el.tagName = tagName;
            el.ownerDocument = this;
            return el;
        };

        this.documentElement = createEl(HTMLHtmlElement);
        this.head = createEl(HTMLHeadElement);
        this.body = createEl(HTMLBodyElement);

        this.documentElement.parentNode = this;
        this._children = [this.documentElement]; // 模拟 Document 的子节点

        this.documentElement.appendChild(this.head);
        this.documentElement.appendChild(this.body);
        this.activeElement = this.body;

        // 注入 Script
        this._currentScript = createEl(HTMLScriptElement);
        this._currentScript.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
        this.head.appendChild(this._currentScript);
        this.scripts.push(this._currentScript);

        // ... (findById, traverseByTag, createElement 等保持不变) ...
        const findById = (node, id) => {
            if (node.id === id) return node;
            if (node._children) {
                for (const child of node._children) {
                    const res = findById(child, id);
                    if (res) return res;
                }
            }
            return null;
        };

        const traverseByTag = (node, tag, result) => {
            if (node.nodeType === 1) {
                if (tag === '*' || node.tagName === tag) result.push(node);
            }
            if (node._children) {
                for (const child of node._children) traverseByTag(child, tag, result);
            }
        };

        this.getElementById = (id) => {
            if (id === 'challenge-form' || id === 'cf-challenge-form') {
                const exist = findById(this.documentElement, id);
                if (exist) return exist;
                const form = createEl(HTMLFormElement);
                form.id = id;
                this.body.appendChild(form);
                return form;
            }
            return findById(this.documentElement, id);
        };

        this.getElementsByTagName = (tagName) => {
            const tag = tagName.toUpperCase();
            const result = [];
            traverseByTag(this.documentElement, tag, result);
            const Collection = this._windowContext.HTMLCollection || HTMLCollection || Array;
            return new Collection(result);
        };

        this.querySelector = (selector) => {
            if (!selector) return null;
            if (selector === 'body') return this.body;
            if (selector === 'head') return this.head;
            if (selector === 'html') return this.documentElement;
            if (selector.startsWith('#')) return this.getElementById(selector.slice(1));
            const tag = selector.toUpperCase();
            const els = this.getElementsByTagName(tag);
            return els.length > 0 ? els[0] : null;
        };

        this.getElementsByClassName = (name) => new (this._windowContext.HTMLCollection || HTMLCollection || Array)([]);

        this.createElement = (tagName) => {
            const tag = tagName.toUpperCase();
            let el;
            switch (tag) {
                case 'DIV':
                    el = createEl(HTMLDivElement);
                    break;
                case 'SPAN':
                    el = createEl(HTMLSpanElement);
                    break;
                case 'A':
                    el = createEl(HTMLAnchorElement);
                    break;
                case 'FORM':
                    el = createEl(HTMLFormElement);
                    break;
                case 'IFRAME':
                    el = createEl(HTMLIFrameElement);
                    break;
                case 'SCRIPT':
                    el = createEl(HTMLScriptElement);
                    break;
                case 'IMG':
                    el = createEl(HTMLImageElement);
                    break;
                case 'CANVAS':
                    el = createEl(HTMLCanvasElement);
                    break;
                case 'BODY':
                    el = createEl(HTMLBodyElement);
                    break;
                case 'HEAD':
                    el = createEl(HTMLHeadElement);
                    break;
                case 'HTML':
                    el = createEl(HTMLHtmlElement);
                    break;
                case 'AUDIO':
                    el = typeof HTMLAudioElement !== 'undefined' ? createEl(HTMLAudioElement) : new HTMLElement('AUDIO', this._windowContext);
                    break;
                case 'VIDEO':
                    el = typeof HTMLVideoElement !== 'undefined' ? createEl(HTMLVideoElement) : new HTMLElement('VIDEO', this._windowContext);
                    break;
                default:
                    el = new HTMLElement(tag, this._windowContext);
                    el.ownerDocument = this;
                    break;
            }
            if (tag === 'SCRIPT') this.scripts.push(el);
            return el;
        };

        this.createElementNS = (ns, tagName) => {
            const el = this.createElement(tagName);
            el.namespaceURI = ns;
            if (!el.getBBox) el.getBBox = () => ({x: 0, y: 0, width: 0, height: 0});
            return el;
        };
        this.createTextNode = (text) => {
            const t = new Element('text', this._windowContext);
            t.textContent = text;
            t.nodeType = 3;
            t.ownerDocument = this;
            return t;
        };
        this.createDocumentFragment = () => {
            const frag = createEl(HTMLDivElement);
            frag.nodeType = 11;
            frag.tagName = null;
            return frag;
        };
        this.createEvent = (type) => ({
            initEvent: (t, b, c) => {
                this.lastEvent = {type: t, bubbles: b, cancelable: c};
            }
        });

        this._listeners = {};
        this.addEventListener = (type, listener) => {
            if (!this._listeners[type]) this._listeners[type] = [];
            this._listeners[type].push(listener);
        };
        this.removeEventListener = (type, listener) => {
            if (this._listeners[type]) {
                const idx = this._listeners[type].indexOf(listener);
                if (idx >= 0) this._listeners[type].splice(idx, 1);
            }
        };
        this.dispatchEvent = (event) => {
            const type = event.type;
            if (this._listeners[type]) this._listeners[type].forEach(fn => fn.call(this, event));
            return true;
        };

        // --- 【核心修复】Document 级别的 insertBefore 支持 UID ---
        this.insertBefore = (newNode, refNode) => {
            // 解决 refNode 是 Proxy 的情况
            if (refNode) {
                // 如果 refNode 的父节点指向了 document (或者通过 uid 匹配到了 document)
                if (refNode.parentNode === this || (refNode.parentNode && refNode.parentNode._uid === this._uid)) {
                    // 查找 refNode 索引
                    const idx = this._children.findIndex(c => c === refNode || (c._uid && refNode._uid && c._uid === refNode._uid));
                    if (idx >= 0) {
                        newNode.parentNode = this;
                        this._children.splice(idx, 0, newNode);
                        return newNode;
                    }
                }
            }
            // 容错：追加到 body
            return this.body.appendChild(newNode);
        };

        this.appendChild = (child) => {
            if (child.tagName !== 'HTML') return this.body.appendChild(child);
            return child;
        };

        this.removeChild = (child) => {
            const idx = this._children.findIndex(c => c === child || (c._uid && child._uid && c._uid === child._uid));
            if (idx >= 0) {
                this._children.splice(idx, 1);
                child.parentNode = null;
            }
            return child;
        };

        this.implementation = {createHTMLDocument: () => new Document(profile, windowContext), hasFeature: () => true};

        this._title = "";
        Object.defineProperty(this, 'title', {
            get: () => this._title, set: (val) => {
                this._title = String(val);
            }, enumerable: true, configurable: true
        });
        Object.defineProperty(this, 'location', {
            get: () => this._windowContext.location,
            enumerable: true,
            configurable: true
        });
    }

    get currentScript() {
        return this._currentScript;
    }

    get cookie() {
        return this._cookie;
    }

    set cookie(val) {
        if (!val) return;
        const keyVal = val.split(';')[0];
        if (this._cookie) this._cookie += "; " + keyVal; else this._cookie = keyVal;
    }

    open() {
        return this;
    }

    close() {
    }

    write(html) {
    }

    clear() {
    }
}

module.exports = Document;