const Element = require('./Element');
const {
    HTMLDivElement, HTMLSpanElement, HTMLAnchorElement, HTMLFormElement,
    HTMLIFrameElement, HTMLScriptElement, HTMLImageElement, HTMLCanvasElement,
    HTMLBodyElement, HTMLHeadElement, HTMLHtmlElement, HTMLElement,
    HTMLAudioElement, HTMLVideoElement, HTMLInputElement, HTMLButtonElement, theZombie // 确保这里引入了 theZombie
} = require('./HTMLNode');
const {HTMLCollection} = require('./DOMCollection');
// 引入 nativize，防止 Proxy 暴露非原生特征
const { nativize } = require('../utils/tools');

class Document {
    constructor(profile, windowContext) {
        this._windowContext = windowContext;
        this.defaultView = windowContext;
        this._uid = 'doc_' + Date.now();
        this.nodeType = 9;

        this.domain = "challenges.cloudflare.com";
        this.scripts = [];
        this.readyState = 'complete'; // 关键属性
        this.onreadystatechange = null;
        this.onerror = null;
        this.onload = null;
        this.onclick = null;
        this.onvisibilitychange = null;
        this.cookie = "";

        // 确保 document.documentElement 存在
        const elementNoop = function () { return elementNoop; };
        Object.defineProperty(elementNoop, 'toString', {
            value: () => '',
            configurable: true
        });
        const withElementFallback = (el) => new Proxy(el, {
            get(target, prop, receiver) {
                if (prop in target || typeof prop === 'symbol') return Reflect.get(target, prop, receiver);
                return elementNoop;
            },
            set(target, prop, value, receiver) {
                return Reflect.set(target, prop, value, receiver);
            }
        });
        const createEl = (ClassType, tagName) => {
            const el = new ClassType(windowContext);
            if (tagName) el.tagName = tagName;
            el.ownerDocument = this;
            return withElementFallback(el);
        };

        this.documentElement = createEl(HTMLHtmlElement);
        this.head = createEl(HTMLHeadElement);
        this.body = createEl(HTMLBodyElement);
        this.documentElement.parentNode = this;
        this._children = [this.documentElement];
        this.documentElement.appendChild(this.head);
        this.documentElement.appendChild(this.body);
        this.activeElement = this.body;

        // 注入 Script
        this._currentScript = createEl(HTMLScriptElement);
        this._currentScript.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
        this.head.appendChild(this._currentScript);
        this.scripts.push(this._currentScript);

        // --- 内部查找工具 ---
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

        const traverseByClass = (node, className, result) => {
            if (node.nodeType === 1 && node.classList && node.classList.contains(className)) result.push(node);
            if (node._children) {
                for (const child of node._children) traverseByClass(child, className, result);
            }
        };

        // --- API 实现 ---
        this.getElementById = nativize((id) => {
            const found = findById(this.documentElement, id);
            if (found) return found;
            // 自动创建常见 CF 挑战页面容器
            const knownIds = ['challenge-form','cf-challenge-form','cf-challenge-body',
                'cf-challenge-running','cf-chl-widget','ctp-checkbox','jklY6',
                'sdsJu6','cuBkB7',
            ];
            if (id === 'challenge-form' || id === 'cf-challenge-form') {
                const form = createEl(HTMLFormElement);
                form.id = id;
                this.body.appendChild(form);
                return form;
            }
            if (knownIds.includes(id)) {
                console.log(`[Document] getElementById('${id}') 未找到，自动创建`);
                const div = createEl(HTMLDivElement);
                div.id = id;
                this.body.appendChild(div);
                return div;
            }
            console.log(`[Document] getElementById('${id}') → Zombie`);
            return theZombie;
        }, 'getElementById');

        this.getElementsByTagName = nativize((tagName) => {
            const tag = tagName.toUpperCase();
            const result = [];
            traverseByTag(this.documentElement, tag, result);
            const Collection = this._windowContext.HTMLCollection || HTMLCollection || Array;
            return new Collection(result);
        }, 'getElementsByTagName');

        this.querySelector = nativize((selector) => {
            if (!selector) return theZombie;
            if (selector === 'body') return this.body;
            if (selector === 'head') return this.head;
            if (selector === 'html') return this.documentElement;
            if (selector.startsWith('#')) return this.getElementById(selector.slice(1));
            if (selector.startsWith('.')) {
                const result = [];
                const cls = selector.slice(1);
                const traverseByClass2 = (node) => {
                    if (node.classList && node.classList.contains && node.classList.contains(cls)) result.push(node);
                    if (node._children) node._children.forEach(traverseByClass2);
                };
                traverseByClass2(this.documentElement);
                if (result.length) return result[0];
            }
            if (this.documentElement && typeof this.documentElement.querySelector === 'function') {
                const found = this.documentElement.querySelector(selector);
                if (found) return found;
            }
            const tag = selector.toUpperCase();
            const els = this.getElementsByTagName(tag);
            if (els.length > 0) return els[0];
            console.log(`[Document] querySelector('${selector}') → Zombie`);
            return theZombie;
        }, 'querySelector');

        this.querySelectorAll = nativize((selector) => {
            const Collection = this._windowContext.HTMLCollection || HTMLCollection || Array;
            if (this.documentElement && typeof this.documentElement.querySelectorAll === 'function') {
                return new Collection(this.documentElement.querySelectorAll(selector));
            }
            return new Collection([]);
        }, 'querySelectorAll');

        this.getElementsByClassName = nativize((name) => {
            const result = [];
            traverseByClass(this.documentElement, String(name), result);
            const Collection = this._windowContext.HTMLCollection || HTMLCollection || Array;
            return new Collection(result);
        }, 'getElementsByClassName');

        this.createElement = nativize((tagName) => {
            const tag = tagName.toUpperCase();
            let el;
            switch (tag) {
                case 'DIV': el = createEl(HTMLDivElement); break;
                case 'SPAN': el = createEl(HTMLSpanElement); break;
                case 'A': el = createEl(HTMLAnchorElement); break;
                case 'FORM': el = createEl(HTMLFormElement); break;
                case 'INPUT': el = createEl(HTMLInputElement); break;
                case 'BUTTON': el = createEl(HTMLButtonElement); break;
                case 'IFRAME': el = createEl(HTMLIFrameElement); break;
                case 'SCRIPT': el = createEl(HTMLScriptElement); break;
                case 'IMG': el = createEl(HTMLImageElement); break;
                case 'CANVAS': el = createEl(HTMLCanvasElement); break;
                case 'BODY': el = createEl(HTMLBodyElement); break;
                case 'HEAD': el = createEl(HTMLHeadElement); break;
                case 'HTML': el = createEl(HTMLHtmlElement); break;
                case 'AUDIO': el = createEl(HTMLAudioElement); break;
                case 'VIDEO': el = createEl(HTMLVideoElement); break;
                default:
                    el = new HTMLElement(tag, this._windowContext);
                    el.ownerDocument = this;
                    break;
            }
            if (tag === 'SCRIPT') this.scripts.push(el);
            return el;
        }, 'createElement');

        this.createElementNS = nativize((ns, tagName) => {
            const el = this.createElement(tagName);
            el.namespaceURI = ns;
            return el;
        }, 'createElementNS');

        this.createTextNode = nativize((text) => {
            const t = new Element('text', this._windowContext);
            t.textContent = text;
            t.nodeType = 3;
            t.ownerDocument = this;
            return t;
        }, 'createTextNode');

        this.createDocumentFragment = nativize(() => {
            const frag = createEl(HTMLDivElement);
            frag.nodeType = 11;
            frag.tagName = null;
            return frag;
        }, 'createDocumentFragment');

        this.createEvent = nativize((type) => ({
            initEvent: (t, b, c) => { this.lastEvent = {type: t, bubbles: b, cancelable: c}; }
        }), 'createEvent');

        this._listeners = {};
        this.addEventListener = nativize((type, listener) => {
            if (!this._listeners[type]) this._listeners[type] = [];
            this._listeners[type].push(listener);
        }, 'addEventListener');

        this.removeEventListener = nativize((type, listener) => {
            if (this._listeners[type]) {
                const idx = this._listeners[type].indexOf(listener);
                if (idx >= 0) this._listeners[type].splice(idx, 1);
            }
        }, 'removeEventListener');

        this.dispatchEvent = nativize((event) => {
            const type = event.type;
            if (this._listeners[type]) this._listeners[type].forEach(fn => fn.call(this, event));
            return true;
        }, 'dispatchEvent');

        this.insertBefore = nativize((newNode, refNode) => {
            return this.body.appendChild(newNode);
        }, 'insertBefore');

        this.appendChild = nativize((child) => {
            return this.body.appendChild(child);
        }, 'appendChild');

        this.removeChild = nativize((child) => {
            // 简单模拟
            return child;
        }, 'removeChild');

        this.implementation = {createHTMLDocument: () => new Document(profile, windowContext), hasFeature: () => true};

        this._title = "";
        Object.defineProperty(this, 'title', {
            get: () => this._title, set: (val) => { this._title = String(val); }, enumerable: true, configurable: true
        });
        Object.defineProperty(this, 'location', {
            get: () => this._windowContext.location, enumerable: true, configurable: true
        });

        // ============================================================
        // 【核心修复】使用 Proxy 支持 Named Access (document.id)
        // ============================================================
        return new Proxy(this, {
            get: (target, prop, receiver) => {
                // 1. 优先返回自有属性
                if (prop in target) return Reflect.get(target, prop, receiver);

                // 2. 尝试 Named Access (ID 查找)
                // 只有字符串属性才进行查找，避免 Symbol 等干扰
                if (typeof prop === 'string' && prop !== 'then') {
                    // console.log(`[Document] Trying named access: ${prop}`); // 调试用
                    const el = target.getElementById(prop);
                    // 注意：getElementById 即使没找到也会返回 theZombie
                    // 所以这里永远返回一个 Element，彻底杜绝 undefined 导致的崩溃
                    return el;
                }

                // 3. 实在没有，返回 undefined (但由于上面 getElementById 兜底，几乎不会到这)
                return undefined;
            }
        });
    }

    get currentScript() { return this._currentScript; }
    open() { return this; }
    close() {}
    write(html) {}
    clear() {}
}

module.exports = Document;
