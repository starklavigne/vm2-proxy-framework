const Crypto = require('./Crypto');
const EventTarget = require('./EventTarget');
const pureIframeDebug = process.env.PURE_IFRAME_DEBUG === '1';

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

const querySelectorWithin = (root, selector) => {
    if (!selector) return theZombie;
    const shouldLog = !String(selector).startsWith('#cf-chl-widget-');
    const selectors = String(selector).split(',').map((part) => part.trim()).filter(Boolean);
    for (const sel of selectors) {
        if (sel.startsWith('#') && !/[\s>+~]/.test(sel)) {
            const id = sel.slice(1);
            const local = walkElements(root, (node) => node.id === id);
            if (local) {
                if (shouldLog) console.log(`[Element] querySelector('${selector}') → ${local.tagName || 'node'}${local.id ? '#' + local.id : ''}`);
                return local;
            }
            const byId = root.ownerDocument && root.ownerDocument.getElementById
                ? root.ownerDocument.getElementById(id)
                : null;
            if (byId && byId !== theZombie) {
                if (shouldLog) console.log(`[Element] querySelector('${selector}') → ${byId.tagName || 'node'}${byId.id ? '#' + byId.id : ''}`);
                return byId;
            }
        }
        const parts = sel.split(/\s+/);
        const last = parts[parts.length - 1];
        const found = walkElements(root, (node) => matchesSimpleSelector(node, last));
        if (found) {
            if (shouldLog) console.log(`[Element] querySelector('${selector}') → ${found.tagName || 'node'}${found.id ? '#' + found.id : ''}`);
            return found;
        }
    }
    if (shouldLog) console.log(`[Element] querySelector('${selector}') → Zombie`);
    return theZombie;
};

const querySelectorAllWithin = (root, selector) => {
    const selectors = String(selector || '').split(',').map((part) => part.trim()).filter(Boolean);
    if (!selectors.length) return [];
    return collectElements(root, (node) => selectors.some((sel) => matchesSimpleSelector(node, sel.split(/\s+/).pop())));
};

const ensureQueryableNode = (node) => {
    if (!node || (typeof node !== 'object' && typeof node !== 'function')) return node;
    if (typeof node.querySelector !== 'function') {
        node.querySelector = function (selector) {
            return querySelectorWithin(this, selector);
        };
    }
    if (typeof node.querySelectorAll !== 'function') {
        node.querySelectorAll = function (selector) {
            return querySelectorAllWithin(this, selector);
        };
    }
    return node;
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

const createLocationLike = (href = 'about:blank') => {
    let current = String(href || 'about:blank');
    const update = (value) => {
        current = String(value || 'about:blank');
        try {
            const parsed = new URL(current, 'https://www.sciencedirect.com/');
            location.href = parsed.href;
            location.origin = parsed.origin;
            location.protocol = parsed.protocol;
            location.host = parsed.host;
            location.hostname = parsed.hostname;
            location.pathname = parsed.pathname;
            location.search = parsed.search;
            location.hash = parsed.hash;
        } catch (_) {
            location.href = current;
            location.origin = 'null';
            location.protocol = '';
            location.host = '';
            location.hostname = '';
            location.pathname = current;
            location.search = '';
            location.hash = '';
        }
    };
    const location = {
        href: current,
        origin: 'null',
        protocol: '',
        host: '',
        hostname: '',
        pathname: current,
        search: '',
        hash: '',
        assign: (value) => update(value),
        replace: (value) => update(value),
        reload: () => {},
        toString: () => location.href,
    };
    update(current);
    return location;
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
        this.innerHTML = '';
        this.outerHTML = '';
        this.textContent = '';
        this.value = '';
        this._listeners = {};
        this.contentWindow = {
            eval: nativize(() => undefined, 'eval'),
            postMessage: nativize(() => {}, 'postMessage'),
            document: this,
            location: createLocationLike('about:blank'),
        };
        this.contentDocument = this;
    }

    addEventListener() {}
    removeEventListener() {}
    dispatchEvent() { return true; }
    insertBefore() { return this; }
    appendChild(child) { return child; }
    removeChild(child) { return child; }
    replaceChild(n) { return n; }
    getAttribute() { return null; }
    setAttribute() {}
    querySelector() { return this; }
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

const zombieNoop = function () { return zombieNoop; };
Object.defineProperty(zombieNoop, 'toString', {
    value: () => '',
    writable: true,
    configurable: true,
    enumerable: false
});
const theZombie = new Proxy(new ZombieElement(), {
    get(target, prop, receiver) {
        if (prop in target || typeof prop === 'symbol') {
            return Reflect.get(target, prop, receiver);
        }
        return zombieNoop;
    },
    set(target, prop, value) {
        target[prop] = value;
        return true;
    }
});

// ==========================================
// 4. Element 基类
// ==========================================
class Element extends EventTarget {
    constructor(tagName = 'DIV', context = null) {
        super();
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
        this.shadowRoot = null;
        this.contentWindow = {
            eval: nativize((source) => {
                if (context && typeof context.eval === 'function') return context.eval(String(source));
                return undefined;
            }, 'eval'),
            postMessage: nativize(() => {}, 'postMessage'),
        };
        this.contentDocument = null;
    }

    get parentNode() { return ensureQueryableNode(this._parentNode || theZombie); }
    set parentNode(node) { this._parentNode = ensureQueryableNode(node); }
    get isConnected() {
        let node = this;
        while (node && node !== theZombie) {
            if (node.nodeType === 9) return true;
            node = node.parentNode;
        }
        return false;
    }

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
    get attributes() {
        return Object.keys(this._attributes).map((name) => ({name, value: this._attributes[name]}));
    }
    get firstChild() { return this._children[0] || theZombie; }
    get lastChild() { return this._children[this._children.length - 1] || theZombie; }
    get parentElement() { return this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : theZombie; }
    get firstElementChild() { return this._children.find((node) => node.nodeType === 1) || theZombie; }
    get lastElementChild() {
        for (let i = this._children.length - 1; i >= 0; i--) {
            if (this._children[i].nodeType === 1) return this._children[i];
        }
        return theZombie;
    }

    get nextSibling() {
        if (!this._parentNode || this._parentNode === theZombie || !Array.isArray(this._parentNode._children)) return theZombie;
        const idx = this._parentNode._children.indexOf(this);
        return idx >= 0 ? (this._parentNode._children[idx + 1] || theZombie) : theZombie;
    }

    get previousSibling() {
        if (!this._parentNode || this._parentNode === theZombie || !Array.isArray(this._parentNode._children)) return theZombie;
        const idx = this._parentNode._children.indexOf(this);
        return idx > 0 ? this._parentNode._children[idx - 1] : theZombie;
    }

    get nextElementSibling() {
        let node = this.nextSibling;
        while (node && node.nodeType !== 1) node = node.nextSibling;
        return node || theZombie;
    }

    get previousElementSibling() {
        let node = this.previousSibling;
        while (node && node.nodeType !== 1) node = node.previousSibling;
        return node || theZombie;
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
            if (typeof child._registerFrame === 'function') child._registerFrame();
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

    getElementById(id) {
        const wanted = String(id);
        return walkElements(this, (node) => node.id === wanted) || null;
    }

    querySelector(selector) {
        return querySelectorWithin(this, selector);
    }

    querySelectorAll(selector) {
        return querySelectorAllWithin(this, selector);
    }

    append(...nodes) {
        nodes.forEach((node) => {
            if (typeof node === 'string') node = createElementFromHTML(node, this._context) || node;
            if (node && typeof node !== 'string') this.appendChild(node);
        });
    }

    prepend(...nodes) {
        nodes.reverse().forEach((node) => {
            if (typeof node === 'string') node = createElementFromHTML(node, this._context) || node;
            if (node && typeof node !== 'string') this.insertBefore(node, this.firstChild);
        });
    }

    before(...nodes) {
        if (!this.parentNode || this.parentNode === theZombie) return;
        nodes.forEach((node) => {
            if (typeof node === 'string') node = createElementFromHTML(node, this._context) || node;
            if (node && typeof node !== 'string') this.parentNode.insertBefore(node, this);
        });
    }

    after(...nodes) {
        if (!this.parentNode || this.parentNode === theZombie) return;
        const ref = this.nextSibling;
        nodes.forEach((node) => {
            if (typeof node === 'string') node = createElementFromHTML(node, this._context) || node;
            if (node && typeof node !== 'string') this.parentNode.insertBefore(node, ref);
        });
    }

    insertAdjacentElement(position, element) {
        const pos = String(position || '').toLowerCase();
        if (pos === 'beforebegin') return this.before(element), element;
        if (pos === 'afterbegin') return this.insertBefore(element, this.firstChild), element;
        if (pos === 'beforeend') return this.appendChild(element);
        if (pos === 'afterend') return this.after(element), element;
        return element;
    }

    insertAdjacentHTML(position, html) {
        const element = createElementFromHTML(String(html || ''), this._context);
        if (element) this.insertAdjacentElement(position, element);
    }

    insertAdjacentText(position, text) {
        const node = this.ownerDocument && this.ownerDocument.createTextNode
            ? this.ownerDocument.createTextNode(String(text))
            : createElementFromHTML(`<span>${String(text)}</span>`, this._context);
        if (node) this.insertAdjacentElement(position, node);
    }

    matches(selector) { return matchesSimpleSelector(this, selector); }
    closest(selector) {
        let node = this;
        while (node && node !== theZombie) {
            if (node.matches && node.matches(selector)) return node;
            node = node.parentNode;
        }
        return null;
    }
    getRootNode() { return this.ownerDocument || this; }
    attachShadow(init = {}) {
        const root = new Element('#shadow-root', this._context);
        root.nodeType = 11;
        root.tagName = null;
        root.host = this;
        root.parentNode = this;
        root.mode = init && init.mode || 'open';
        root.ownerDocument = this.ownerDocument;
        root.getElementById = nativize((id) => {
            const wanted = String(id);
            return walkElements(root, (node) => node.id === wanted) || null;
        }, 'getElementById');
        root.querySelector = nativize((selector) => querySelectorWithin(root, selector), 'querySelector');
        root.querySelectorAll = nativize((selector) => querySelectorAllWithin(root, selector), 'querySelectorAll');
        this.shadowRoot = root;
        return root;
    }
    cloneNode(deep = false) {
        const cloned = new Element(this.tagName, this._context);
        Object.entries(this._attributes).forEach(([key, value]) => cloned.setAttribute(key, value));
        cloned.textContent = this.textContent || '';
        if (deep) this._children.forEach((child) => cloned.appendChild(child.cloneNode ? child.cloneNode(true) : child));
        return cloned;
    }
    scrollIntoView() {}
    getAttributeNode(name) {
        const value = this.getAttribute(name);
        return value == null ? null : {name, value};
    }

    getBoundingClientRect() {
        const width = Number.parseFloat(this.style.width || this.getAttribute('width') || (this.tagName === 'IFRAME' ? 300 : 0)) || 0;
        const height = Number.parseFloat(this.style.height || this.getAttribute('height') || (this.tagName === 'IFRAME' ? 65 : 0)) || 0;
        return {top:0, left:0, right:width, bottom:height, width, height, x:0, y:0};
    }
    getClientRects() { return [this.getBoundingClientRect()]; }

    focus() {}
    blur() {}
    click() {}
}

['appendChild', 'removeChild', 'remove', 'insertBefore', 'replaceChild', 'getAttribute', 'setAttribute',
 'removeAttribute', 'hasAttribute', 'getAttributeNode', 'getElementsByTagName', 'getElementsByClassName',
 'getElementById',
 'querySelector', 'querySelectorAll', 'contains', 'append', 'prepend', 'before', 'after',
 'insertAdjacentElement', 'insertAdjacentHTML', 'insertAdjacentText', 'matches', 'closest',
	 'getRootNode', 'attachShadow', 'cloneNode', 'scrollIntoView'].forEach(method => {
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
        this._parentWindow = c || {};
        this._src = 'about:blank';
        this._name = '';
        this.contentWindow = null;
        this.contentDocument = null;
        this._initFrame();
        this._registerFrame();
    }

    _registerFrame() {
        const parentWindow = this._parentWindow;
        if (!parentWindow || !this.contentWindow || this._frameRegistered) return;
        const frameIndex = Number(parentWindow.length || 0);
        parentWindow[frameIndex] = this.contentWindow;
        parentWindow.length = frameIndex + 1;
        if (this._name) parentWindow[this._name] = this.contentWindow;
        this._frameRegistered = true;
    }

    _initFrame() {
        const parentWindow = this._parentWindow || {};
        const iframe = this;
        const frameDoc = new Element('#document', parentWindow);
        frameDoc.nodeType = 9;
        frameDoc.tagName = null;
        frameDoc.readyState = 'complete';
        frameDoc.domain = 'challenges.cloudflare.com';
        frameDoc.cookie = '';
        frameDoc.defaultView = null;
        frameDoc.ownerDocument = frameDoc;
        frameDoc._children = [];
        frameDoc._listeners = {};

        const html = new HTMLHtmlElement(parentWindow);
        const head = new HTMLHeadElement(parentWindow);
        const body = new HTMLBodyElement(parentWindow);
        html.ownerDocument = frameDoc;
        head.ownerDocument = frameDoc;
        body.ownerDocument = frameDoc;
        frameDoc.documentElement = html;
        frameDoc.head = head;
        frameDoc.body = body;
        frameDoc._children.push(html);
        html.appendChild(head);
        html.appendChild(body);
        frameDoc.scripts = [];
        frameDoc.currentScript = theZombie;

        const findById = (node, id) => {
            if (node && node.id === id) return node;
            const children = node && node._children ? node._children : [];
            for (const child of children) {
                const found = findById(child, id);
                if (found) return found;
            }
            return null;
        };
        frameDoc.createElement = nativize((tag) => {
            const upper = String(tag || 'div').toUpperCase();
            let el;
            if (upper === 'IFRAME') el = new HTMLIFrameElement(parentWindow);
            else if (upper === 'SCRIPT') el = new HTMLScriptElement(parentWindow);
            else if (upper === 'INPUT') el = new HTMLInputElement(parentWindow);
            else if (upper === 'BUTTON') el = new HTMLButtonElement(parentWindow);
            else if (upper === 'A') el = new HTMLAnchorElement(parentWindow);
            else if (upper === 'SPAN') el = new HTMLSpanElement(parentWindow);
            else if (upper === 'FORM') el = new HTMLFormElement(parentWindow);
            else el = new HTMLElement(upper, parentWindow);
            el.ownerDocument = frameDoc;
            if (upper === 'SCRIPT') frameDoc.scripts.push(el);
            return el;
        }, 'createElement');
        frameDoc.createTextNode = nativize((text) => {
            const node = new Element('text', parentWindow);
            node.nodeType = 3;
            node.textContent = String(text || '');
            node.ownerDocument = frameDoc;
            return node;
        }, 'createTextNode');
        frameDoc.createDocumentFragment = nativize(() => {
            const frag = new Element('#document-fragment', parentWindow);
            frag.nodeType = 11;
            frag.tagName = null;
            frag.ownerDocument = frameDoc;
            return frag;
        }, 'createDocumentFragment');
        frameDoc.getElementById = nativize((id) => findById(frameDoc.documentElement, String(id)) || theZombie, 'getElementById');
        frameDoc.querySelector = nativize((selector) => frameDoc.documentElement.querySelector(selector), 'querySelector');
        frameDoc.querySelectorAll = nativize((selector) => frameDoc.documentElement.querySelectorAll(selector), 'querySelectorAll');
        frameDoc.getElementsByTagName = nativize((tag) => frameDoc.documentElement.getElementsByTagName(tag), 'getElementsByTagName');
        frameDoc.open = nativize(() => frameDoc, 'open');
        frameDoc.close = nativize(() => {}, 'close');
        frameDoc.write = nativize((htmlText) => { frameDoc.body.innerHTML = String(htmlText || ''); }, 'write');
        frameDoc.addEventListener = nativize((type, cb) => EventTarget.prototype.addEventListener.call(frameDoc, type, cb), 'addEventListener');
        frameDoc.removeEventListener = nativize((type, cb) => EventTarget.prototype.removeEventListener.call(frameDoc, type, cb), 'removeEventListener');
        frameDoc.dispatchEvent = nativize((evt) => EventTarget.prototype.dispatchEvent.call(frameDoc, evt), 'dispatchEvent');

        const location = createLocationLike(this._src);
        const frameWindow = {
            window: null,
            self: null,
            globalThis: null,
            top: parentWindow.top || parentWindow,
            parent: parentWindow,
            frames: null,
            length: 0,
            frameElement: iframe,
            document: frameDoc,
            location,
            navigator: parentWindow.navigator || {},
            performance: parentWindow.performance || {now: () => Date.now()},
            console: parentWindow.console || console,
            name: this._name,
            closed: false,
            origin: location.origin,
            onmessage: null,
            onload: null,
            _listeners: {},
        };
        frameWindow.window = frameWindow.self = frameWindow.globalThis = frameWindow.frames = frameWindow;
        frameWindow.eval = nativize((source) => {
            if (parentWindow && typeof parentWindow.eval === 'function') return parentWindow.eval(String(source));
            return Function(String(source))();
        }, 'eval');
        frameWindow.Function = parentWindow.Function || Function;
        frameWindow.contentWindow = frameWindow;
        frameWindow.contentDocument = frameDoc;
        frameWindow.defaultView = frameWindow;
        frameWindow.parentWindow = parentWindow;
        frameWindow.opener = null;
        frameDoc.defaultView = frameWindow;
        frameDoc.parentWindow = frameWindow;
        frameDoc.contentWindow = frameWindow;
        frameDoc.eval = frameWindow.eval;
        const turnstileWidgetId = () => {
            const id = String(iframe.id || iframe._attributes.id || '');
            return id.startsWith('cf-chl-widget-') ? id.slice('cf-chl-widget-'.length) : '';
        };
        const postTurnstileParentMessage = (data) => {
            const widgetId = data && data.widgetId || turnstileWidgetId();
            if (!widgetId || !parentWindow || typeof parentWindow.dispatchEvent !== 'function') return;
            if (pureIframeDebug) {
                console.log(`[TurnstileFrame] -> parent event=${data && data.event} widget=${widgetId} origin=${frameWindow.location && frameWindow.location.origin}`);
            }
            const evt = {
                type: 'message',
                isTrusted: true,
                data: Object.assign({source: 'cloudflare-challenge', widgetId}, data),
                origin: frameWindow.location && frameWindow.location.origin || 'https://challenges.cloudflare.com',
                source: frameWindow,
                ports: [],
            };
            try {
                parentWindow.dispatchEvent(evt);
            } catch (e) {
                if (pureIframeDebug) console.log(`[TurnstileFrame] parent dispatch error: ${e && e.message}`);
                if (pureIframeDebug && e && e.stack) console.log(`[TurnstileFrame] parent dispatch stack: ${String(e.stack)}`);
                if (data && data.event === 'requestExtraParams' && !frameWindow._turnstileFallbackExtraParamsSent) {
                    frameWindow._turnstileFallbackExtraParamsSent = true;
                    setTimeout(() => {
                        frameWindow.postMessage({
                            source: 'cloudflare-challenge',
                            widgetId,
                            event: 'extraParams',
                            action: '',
                            appearance: 'always',
                            ch: '',
                            cData: '',
                            chlPageData: '',
                            execution: 'render',
                            language: 'auto',
                            rcV: '',
                            retry: 'auto',
                            url: parentWindow.location && parentWindow.location.href || '',
                            wPr: {
                                watchcatSeq: 1,
                                pi: {},
                            },
                        }, '*');
                    }, 0);
                }
            }
            try {
                if (typeof parentWindow.onmessage === 'function') parentWindow.onmessage(evt);
            } catch (e) {
                if (pureIframeDebug) console.log(`[TurnstileFrame] parent onmessage error: ${e && e.message}`);
            }
        };
        for (const key of [
            'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame',
            'MessageChannel', 'MessagePort', 'URL', 'URLSearchParams', 'Blob', 'FileReader', 'XMLHttpRequest',
            'fetch', 'Headers', 'FormData', 'Event', 'MessageEvent', 'CustomEvent'
        ]) {
            if (parentWindow[key]) frameWindow[key] = parentWindow[key];
        }
        frameWindow.addEventListener = nativize((type, cb) => EventTarget.prototype.addEventListener.call(frameWindow, type, cb), 'addEventListener');
        frameWindow.removeEventListener = nativize((type, cb) => EventTarget.prototype.removeEventListener.call(frameWindow, type, cb), 'removeEventListener');
        frameWindow.dispatchEvent = nativize((evt) => EventTarget.prototype.dispatchEvent.call(frameWindow, evt), 'dispatchEvent');
        frameWindow.postMessage = nativize((data, targetOrigin = '*', transfer = []) => {
            setTimeout(() => {
                if (data && data.source === 'cloudflare-challenge') {
                    if (pureIframeDebug) console.log(`[TurnstileFrame] <- parent event=${data.event} widget=${data.widgetId || turnstileWidgetId()} seq=${data.seq || ''}`);
                    if (data.event === 'meow') {
                        postTurnstileParentMessage({event: 'food', seq: data.seq});
                        if (pureIframeDebug && data.seq === 1) console.log(`[TurnstileFrame] extraParams flag before=${String(frameWindow._turnstileExtraParamsRequested)}`);
                        if (!frameWindow._turnstileExtraParamsRequested) {
                            if (pureIframeDebug) console.log('[TurnstileFrame] schedule requestExtraParams after first meow');
                            setTimeout(() => {
                                frameWindow._turnstileExtraParamsRequested = true;
                                postTurnstileParentMessage({event: 'requestExtraParams'});
                            }, 0);
                        }
                    } else if (data.event === 'init') {
                        if (!frameWindow._turnstileExtraParamsRequested) {
                            frameWindow._turnstileExtraParamsRequested = true;
                            postTurnstileParentMessage({event: 'requestExtraParams'});
                        }
                    } else if (data.event === 'extraParams') {
                        postTurnstileParentMessage({event: 'food', seq: data.wPr && data.wPr.watchcatSeq || 1});
                        if (!frameWindow._turnstileCompleteSent) {
                            frameWindow._turnstileCompleteSent = true;
                            setTimeout(() => {
                                postTurnstileParentMessage({
                                    event: 'complete',
                                    token: `pure-turnstile-${turnstileWidgetId()}-${Date.now()}`,
                                    sToken: '',
                                    chlId: '',
                                });
                            }, 0);
                        }
                    } else if (data.event === 'execute') {
                        postTurnstileParentMessage({event: 'food', seq: data.seq || 1});
                    }
                }
                const evt = {
                    type: 'message',
                    isTrusted: true,
                    data,
                    origin: parentWindow.location && parentWindow.location.origin || 'https://www.sciencedirect.com',
                    source: parentWindow,
                    ports: Array.isArray(transfer) ? transfer : [],
                };
                frameWindow.dispatchEvent(evt);
            }, 0);
        }, 'postMessage');
        frameWindow.parent.postMessage = frameWindow.parent.postMessage || nativize((data, targetOrigin = '*', transfer = []) => {
            setTimeout(() => {
                const evt = {
                    type: 'message',
                    isTrusted: true,
                    data,
                    origin: location.origin,
                    source: frameWindow,
                    ports: Array.isArray(transfer) ? transfer : [],
                };
                if (typeof parentWindow.dispatchEvent === 'function') parentWindow.dispatchEvent(evt);
                if (typeof parentWindow.onmessage === 'function') parentWindow.onmessage(evt);
            }, 0);
        }, 'postMessage');

        this.contentWindow = frameWindow;
        this.contentDocument = frameDoc;
        this.eval = frameWindow.eval;
        this._postTurnstileParentMessage = postTurnstileParentMessage;
    }

    get src() { return this._src; }
    set src(value) {
        this._src = String(value || '');
        this._attributes.src = this._src;
        if (this.contentWindow && this.contentWindow.location) this.contentWindow.location.replace(this._src || 'about:blank');
        setTimeout(() => {
            const event = {type: 'load', target: this};
            this.dispatchEvent(event);
            if (typeof this.onload === 'function') this.onload(event);
            if (/\/turnstile\/f\//.test(this._src || '') && typeof this._postTurnstileParentMessage === 'function') {
                if (pureIframeDebug) console.log(`[TurnstileFrame] iframe load id=${this.id || this._attributes.id || ''} src=${this._src}`);
                this._postTurnstileParentMessage({
                    event: 'init',
                    mode: 'managed',
                    nextRcV: '',
                    kills: [],
                });
                setTimeout(() => {
                    this._postTurnstileParentMessage({event: 'requestExtraParams'});
                }, 20);
            }
        }, 0);
    }
    get name() { return this._name; }
    set name(value) {
        this._name = String(value || '');
        this._attributes.name = this._name;
        if (this.contentWindow) this.contentWindow.name = this._name;
        if (this._parentWindow && this._name) this._parentWindow[this._name] = this.contentWindow;
    }
    setAttribute(name, value) {
        name = String(name);
        if (name === 'src') {
            this.src = value;
            return;
        }
        if (name === 'name') {
            this.name = value;
            return;
        }
        super.setAttribute(name, value);
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
