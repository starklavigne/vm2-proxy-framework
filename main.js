// =============================================================================
// Main Entry - VM2 Proxy Framework
// =============================================================================
const path = require('path');
const fs = require('fs');
const {URL} = require('url');
const {TextEncoder, TextDecoder} = require('util');

// Core Modules
const ProxyFactory = require('./src/core/ProxyFactory');
const VMRunner = require('./src/runner/VMRunner');
const profile = require('./src/config/browserProfile');
const cfConfig = require('./src/config/cfConfig'); // 独立的 CF 配置

// Utils
const {nativize, cookieJar} = require('./src/utils/tools');

const pureTurnstileMode = process.env.PURE_TURNSTILE === '1';
const pureStateDebug = process.env.PURE_STATE_DEBUG === '1';

const challengeDumpDir = process.env.CHALLENGE_DUMP_DIR
    || path.resolve(__dirname, 'dumps/vm');
if (process.env.CLEAR_DUMP_DIR !== '0') {
    try { fs.rmSync(challengeDumpDir, {recursive: true, force: true}); } catch (e) {}
}
try {
    fs.mkdirSync(challengeDumpDir, {recursive: true});
    console.log(`[Dump] CF challenge dump dir: ${challengeDumpDir}`);
} catch (e) {
    console.log(`[Dump] 创建 dump 目录失败 ${challengeDumpDir}: ${e.message}`);
}

const importCookieFile = () => {
    const cookiePath = path.join(__dirname, 'src/config/cfCookies.json');
    if (!fs.existsSync(cookiePath)) return;
    try {
        const cookies = JSON.parse(fs.readFileSync(cookiePath, 'utf8'));
        if (!Array.isArray(cookies)) return;
        for (const cookie of cookies) {
            if (cookie && cookie.name) cookieJar.cookies.set(cookie.name, cookie.value || '');
        }
        console.log(`[Cookie] 已导入 ${cookies.length} 个浏览器 cookie: ${cookies.map(c => c.name).join(', ')}`);
    } catch (e) {
        console.log(`[Cookie] 导入浏览器 cookie 失败: ${e.message}`);
    }
};
if (pureTurnstileMode) {
    console.log('[Cookie] PURE_TURNSTILE=1，跳过浏览器 cookie 导入');
} else {
    importCookieFile();
}
const startupClearance = cookieJar.cookies && cookieJar.cookies.get('cf_clearance');
let reportedStartupClearance = false;

// Plugins (Features)
const useAsyncPlugin = require('./src/plugins/AsyncPlugin');
const useBrowserPlugin = require('./src/plugins/BrowserPlugin');
const useNetworkPlugin = require('./src/plugins/NetworkPlugin');

// Env Objects
const Crypto = require('./src/env/Crypto');
const EventTarget = require('./src/env/EventTarget');
const Media = require('./src/env/Media');
const AudioEnv = require('./src/env/AudioContext');
const WebRTC = require('./src/env/WebRTC');
const Window = require('./src/env/Window');
const Document = require('./src/env/Document');
const HTMLNodes = require('./src/env/HTMLNode');
const DOMCollections = require('./src/env/DOMCollection');
const NetworkMocks = require('./src/env/NetworkMock');

process.on('unhandledRejection', (error) => {
    const message = error && error.message ? error.message : String(error);
    if (message.includes('this[VH(...)] is not a function')) return;
    console.log(`[系统] 捕获未处理 Promise 异常: ${message}`);
});

process.on('uncaughtException', (error) => {
    const message = error && error.message ? error.message : String(error);
    if (message.includes('this[VH(...)] is not a function')) return;
    console.log(`[系统] 捕获未处理异常: ${message}`);
});

// =============================================================================
// 1. VM & Context Setup
// =============================================================================
const runner = new VMRunner();
const context = runner.vm.sandbox;
const proxyFactory = new ProxyFactory({enableLog: true});

// 基础环境注入
context.console = console;
[
    'Object', 'Function', 'Array', 'String', 'Number', 'Boolean', 'RegExp',
    'Math', 'JSON', 'Promise', 'Symbol', 'Reflect', 'Proxy', 'WeakMap',
    'WeakSet', 'Map', 'Set', 'DataView', 'ArrayBuffer', 'Uint8Array',
    'Int8Array', 'Uint16Array', 'Int16Array', 'Uint32Array', 'Int32Array',
    'Float32Array', 'Float64Array', 'Uint8ClampedArray', 'Error', 'TypeError',
    'EvalError', 'RangeError', 'ReferenceError', 'SyntaxError', 'URIError',
    'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'encodeURI', 'decodeURI',
    'encodeURIComponent', 'decodeURIComponent', 'escape', 'unescape'
].forEach((key) => {
    context[key] = globalThis[key];
});
context.TextEncoder = TextEncoder;
context.TextDecoder = TextDecoder;
const vmTimeOrigin = Number(cfConfig.cITimeS || Math.floor(Date.now() / 1000)) * 1000;
const hostTimeOrigin = Date.now();
context.Date = nativize(class DateShim extends Date {
    constructor(...args) {
        super(...(args.length ? args : [DateShim.now()]));
    }

    static now() {
        return vmTimeOrigin + (Date.now() - hostTimeOrigin);
    }

    static parse(value) {
        return Date.parse(value);
    }

    static UTC(...args) {
        return Date.UTC(...args);
    }
}, 'Date');
// 注入基础模拟类
context.Plugin = nativize(require('./src/plugins/BrowserPlugin').Plugin || class Plugin {
    constructor(n, d, f) {
        this.name = n;
        this.description = d;
        this.filename = f;
        this.length = 1;
    }

    item() {
    }

    namedItem() {
    }
}, 'Plugin'); // 临时补丁，确保 BrowserPlugin 类定义完整
context.PluginArray = nativize(require('./src/env/PluginArray').PluginArray, 'PluginArray');
context.MimeTypeArray = nativize(require('./src/env/MimeTypeArray'), 'MimeTypeArray');
context.HTMLCollection = nativize(DOMCollections.HTMLCollection, 'HTMLCollection');
context.NodeList = nativize(DOMCollections.NodeList, 'NodeList');
context.DOMCollection = nativize(DOMCollections.DOMCollection, 'DOMCollection');
context.URL = nativize(class URLShim extends URL {
    static createObjectURL() {
        return 'blob:https://www.sciencedirect.com/' + Math.random().toString(36).slice(2);
    }

    static revokeObjectURL() {}
}, 'URL');
context.URLSearchParams = URLSearchParams;
context.BigInt = BigInt;
context.Blob = nativize(NetworkMocks.Blob || globalThis.Blob, 'Blob');
context.FileReader = nativize(NetworkMocks.FileReader, 'FileReader');
context.ReadableStream = globalThis.ReadableStream;
context.Worker = nativize(class Worker {
    constructor(url) {
        this.url = String(url || '');
        this.onmessage = null;
        this.onerror = null;
    }
    postMessage() {}
    terminate() {}
    addEventListener() {}
    removeEventListener() {}
    dispatchEvent() { return true; }
}, 'Worker');
context.Event = nativize(class Event {
    constructor(type, init = {}) {
        this.type = String(type);
        this.bubbles = !!init.bubbles;
        this.cancelable = !!init.cancelable;
        this.defaultPrevented = false;
        this.isTrusted = false;
    }
    preventDefault() { this.defaultPrevented = true; }
    stopPropagation() {}
}, 'Event');
context.MouseEvent = nativize(class MouseEvent extends context.Event {}, 'MouseEvent');
context.KeyboardEvent = nativize(class KeyboardEvent extends context.Event {}, 'KeyboardEvent');
context.CustomEvent = nativize(class CustomEvent extends context.Event {
    constructor(type, init = {}) {
        super(type, init);
        this.detail = init.detail ?? null;
    }
}, 'CustomEvent');
context.MessageEvent = nativize(class MessageEvent extends context.Event {
    constructor(type, init = {}) {
        super(type, init);
        this.data = init.data;
        this.origin = init.origin || '';
        this.lastEventId = init.lastEventId || '';
        this.source = init.source || null;
        this.ports = init.ports || [];
    }
}, 'MessageEvent');
context.DOMException = nativize(class DOMException extends Error {
    constructor(message = '', name = 'Error') {
        super(message);
        this.name = name;
        this.code = 0;
    }
}, 'DOMException');
context.MutationObserver = nativize(class MutationObserver {
    constructor(callback) {
        this.callback = callback;
        this.records = [];
    }
    observe() {}
    disconnect() {}
    takeRecords() {
        const records = this.records;
        this.records = [];
        return records;
    }
}, 'MutationObserver');
context.AbortSignal = nativize(class AbortSignal extends EventTarget {
    constructor() {
        super();
        this.aborted = false;
        this.reason = undefined;
    }
    throwIfAborted() {
        if (this.aborted) throw this.reason || new context.DOMException('signal is aborted', 'AbortError');
    }
}, 'AbortSignal');
context.AbortController = nativize(class AbortController {
    constructor() {
        this.signal = new context.AbortSignal();
    }
    abort(reason) {
        if (this.signal.aborted) return;
        this.signal.aborted = true;
        this.signal.reason = reason || new context.DOMException('signal is aborted', 'AbortError');
        this.signal.dispatchEvent({type: 'abort'});
    }
}, 'AbortController');
context.CSS = {
    supports: nativize(() => true, 'supports'),
    escape: nativize((value) => String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&'), 'escape')
};
context.Storage = nativize(class Storage {
    constructor() {
        this.map = new Map();
    }

    get length() {
        return this.map.size;
    }

    getItem(k) {
        return this.map.get(String(k));
    }

    setItem(k, v) {
        this.map.set(String(k), String(v));
    }

    removeItem(k) {
        this.map.delete(String(k));
    }

    clear() {
        this.map.clear();
    }

    key(i) {
        return Array.from(this.map.keys())[i];
    }
}, 'Storage');
context.CSSStyleDeclaration = nativize(require('./src/env/CSSStyleDeclaration'), 'CSSStyleDeclaration');
context.Node = nativize(class Node extends EventTarget {
    constructor() {
        super();
        this.parentNode = null;
        this.childNodes = [];
    }
    appendChild(node) {
        if (node) {
            node.parentNode = this;
            this.childNodes.push(node);
        }
        return node;
    }
    removeChild(node) {
        const idx = this.childNodes.indexOf(node);
        if (idx >= 0) this.childNodes.splice(idx, 1);
        if (node) node.parentNode = null;
        return node;
    }
    contains(node) {
        return node === this || this.childNodes.some(child => child === node || (child.contains && child.contains(node)));
    }
}, 'Node');
Object.assign(context.Node, {
    ELEMENT_NODE: 1,
    ATTRIBUTE_NODE: 2,
    TEXT_NODE: 3,
    DOCUMENT_NODE: 9,
    DOCUMENT_FRAGMENT_NODE: 11
});
context.DOMParser = nativize(class DOMParser {
    parseFromString(markup = '', type = 'text/html') {
        const doc = new Document(profile, rawWindow);
        doc.contentType = String(type || 'text/html');
        doc.body.innerHTML = String(markup || '');
        return doc;
    }
}, 'DOMParser');
context.Request = nativize(class Request {
    constructor(input, init = {}) {
        this.url = String(input && input.url ? input.url : input || '');
        this.method = String(init.method || (input && input.method) || 'GET').toUpperCase();
        this.headers = new context.Headers(init.headers || (input && input.headers) || {});
        this.body = init.body || null;
        this.credentials = init.credentials || 'same-origin';
        this.mode = init.mode || 'cors';
        this.redirect = init.redirect || 'follow';
    }
    clone() { return new context.Request(this, {headers: this.headers, body: this.body}); }
}, 'Request');
context.Response = nativize(class Response {
    constructor(body = '', init = {}) {
        this._body = body == null ? '' : body;
        this.status = init.status || 200;
        this.statusText = init.statusText || 'OK';
        this.ok = this.status >= 200 && this.status < 300;
        this.headers = new context.Headers(init.headers || {});
        this.url = init.url || '';
        this.redirected = false;
        this.type = 'basic';
    }
    text() { return Promise.resolve(String(this._body)); }
    json() { return this.text().then(text => text ? JSON.parse(text) : {}); }
    arrayBuffer() { return Promise.resolve(Buffer.from(String(this._body)).buffer); }
    blob() { return Promise.resolve(new context.Blob([String(this._body)])); }
    clone() { return new context.Response(this._body, {status: this.status, statusText: this.statusText, headers: this.headers, url: this.url}); }
}, 'Response');
context.Audio = nativize(function Audio(src = '') {
    const audio = new HTMLNodes.HTMLAudioElement(rawWindow);
    audio.src = String(src || '');
    audio.ownerDocument = rawWindow.document || null;
    return audio;
}, 'Audio');
context.AudioContext = nativize(AudioEnv.AudioContext, 'AudioContext');
context.OfflineAudioContext = nativize(AudioEnv.OfflineAudioContext, 'OfflineAudioContext');
context.webkitAudioContext = context.AudioContext;
context.webkitOfflineAudioContext = context.OfflineAudioContext;
context.RTCPeerConnection = nativize(WebRTC.RTCPeerConnection, 'RTCPeerConnection');
context.RTCSessionDescription = nativize(WebRTC.RTCSessionDescription, 'RTCSessionDescription');
context.RTCIceCandidate = nativize(WebRTC.RTCIceCandidate, 'RTCIceCandidate');
context.webkitRTCPeerConnection = context.RTCPeerConnection;

// =============================================================================
// 2. DOM/BOM Initialization
// =============================================================================
// 设置原型链
Object.setPrototypeOf(Window.prototype, EventTarget.prototype);
Object.setPrototypeOf(Document.prototype, EventTarget.prototype);
context.Document = nativize(Document, 'Document');

// 创建原始环境对象 (Raw Objects)
const rawWindow = new Window(context, profile);
rawWindow.crypto = new Crypto();
rawWindow.localStorage = new context.Storage();
rawWindow.sessionStorage = new context.Storage();
rawWindow.console = console;
[
    'Object', 'Function', 'Array', 'String', 'Number', 'Boolean', 'RegExp',
    'Math', 'JSON', 'Promise', 'Symbol', 'Reflect', 'Proxy', 'WeakMap',
    'WeakSet', 'Map', 'Set', 'DataView', 'ArrayBuffer', 'Uint8Array',
    'Int8Array', 'Uint16Array', 'Int16Array', 'Uint32Array', 'Int32Array',
    'Float32Array', 'Float64Array', 'Uint8ClampedArray', 'Error', 'TypeError',
    'EvalError', 'RangeError', 'ReferenceError', 'SyntaxError', 'URIError',
    'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'encodeURI', 'decodeURI',
    'encodeURIComponent', 'decodeURIComponent', 'escape', 'unescape'
].forEach((key) => {
    rawWindow[key] = context[key];
});
rawWindow.eval = nativize((source) => runner.vm.run(String(source)), 'eval');
rawWindow.Function = Function;
rawWindow.TextEncoder = TextEncoder;
rawWindow.TextDecoder = TextDecoder;
rawWindow.HTMLCollection = context.HTMLCollection;
rawWindow.NodeList = context.NodeList;
rawWindow.DOMCollection = context.DOMCollection;
rawWindow.URL = context.URL;
rawWindow.URLSearchParams = context.URLSearchParams;
rawWindow.BigInt = context.BigInt;
rawWindow.Blob = context.Blob;
rawWindow.FileReader = context.FileReader;
rawWindow.ReadableStream = context.ReadableStream;
rawWindow.Worker = context.Worker;
rawWindow.Event = context.Event;
rawWindow.MouseEvent = context.MouseEvent;
rawWindow.KeyboardEvent = context.KeyboardEvent;
rawWindow.CustomEvent = context.CustomEvent;
rawWindow.MessageEvent = context.MessageEvent;
rawWindow.DOMException = context.DOMException;
rawWindow.MutationObserver = context.MutationObserver;
rawWindow.AbortSignal = context.AbortSignal;
rawWindow.AbortController = context.AbortController;
rawWindow.CSS = context.CSS;
rawWindow.Node = context.Node;
rawWindow.DOMParser = context.DOMParser;
rawWindow.Request = context.Request;
rawWindow.Response = context.Response;
rawWindow.Audio = context.Audio;
rawWindow.AudioContext = context.AudioContext;
rawWindow.OfflineAudioContext = context.OfflineAudioContext;
rawWindow.webkitAudioContext = context.webkitAudioContext;
rawWindow.webkitOfflineAudioContext = context.webkitOfflineAudioContext;
rawWindow.RTCPeerConnection = context.RTCPeerConnection;
rawWindow.RTCSessionDescription = context.RTCSessionDescription;
rawWindow.RTCIceCandidate = context.RTCIceCandidate;
rawWindow.webkitRTCPeerConnection = context.webkitRTCPeerConnection;
rawWindow.isSecureContext = true;
rawWindow.postMessage = nativize((data, targetOrigin = '*', transfer = []) => {
    setTimeout(() => {
        const event = new context.MessageEvent('message', {
            data,
            origin: rawWindow.location && rawWindow.location.origin || 'https://www.sciencedirect.com',
            source: rawWindow,
            ports: Array.isArray(transfer) ? transfer : [],
        });
        rawWindow.dispatchEvent(event);
    }, 0);
}, 'postMessage');

const rawDocument = new Document(profile, rawWindow);

// 混入 Document 方法 (Mixin)
const libDoc = new (require('./src/env/Document'))(profile, rawWindow);
for (const key in libDoc) {
    if (key === 'location') continue;
    if (typeof libDoc[key] === 'function') rawDocument[key] = nativize(libDoc[key].bind(rawDocument), key);
    else rawDocument[key] = libDoc[key];
}

// 关键 DOM 修复
rawDocument.createElement = nativize((tag) => {
    const tagName = tag.toUpperCase();
    if (tagName !== 'SCRIPT') console.log(`[DOM] createElement('${tag}')`);
    const specialClassNames = {
        IFRAME: 'HTMLIFrameElement',
        CANVAS: 'HTMLCanvasElement',
    };
    const clsName = specialClassNames[tagName] || `HTML${tagName.charAt(0).toUpperCase() + tagName.slice(1).toLowerCase()}Element`;
    if (context[clsName]) return new context[clsName](rawWindow);
    return new context.HTMLElement(tagName, rawWindow);
}, 'createElement');
const findRawElementById = (root, id, tagName = null) => {
    if (!root || (typeof root !== 'object' && typeof root !== 'function')) return null;
    if (root.id === id && (!tagName || root.tagName === tagName)) return root;
    if (root.shadowRoot) {
        const foundInShadow = findRawElementById(root.shadowRoot, id, tagName);
        if (foundInShadow) return foundInShadow;
    }
    const children = Array.isArray(root._children) ? root._children : (root.childNodes || []);
    for (const child of Array.from(children)) {
        const found = findRawElementById(child, id, tagName);
        if (found) return found;
    }
    return null;
};
rawDocument.getElementById = nativize((id) => {
    const wanted = String(id);
    const found = findRawElementById(rawDocument.documentElement, wanted);
    if (found) return found;
    if (/^cf-chl-widget-.+-fr$/.test(wanted)) {
        const baseId = wanted.slice(0, -3);
        const frame = findRawElementById(rawDocument.documentElement, baseId, 'IFRAME') ||
            findRawElementById(rawDocument.documentElement, baseId);
        if (frame) return frame;
    }
    const knownIds = ['challenge-form', 'cf-challenge-form', 'cf-challenge-body',
        'cf-challenge-running', 'cf-chl-widget', 'ctp-checkbox', 'jklY6',
        'sdsJu6', 'cuBkB7'];
    if (wanted === 'challenge-form' || wanted === 'cf-challenge-form') {
        const form = rawDocument.createElement('form');
        form.id = wanted;
        rawDocument.body.appendChild(form);
        return form;
    }
    if (knownIds.includes(wanted)) {
        console.log(`[Document] getElementById('${wanted}') 未找到，自动创建`);
        const div = rawDocument.createElement('div');
        div.id = wanted;
        rawDocument.body.appendChild(div);
        return div;
    }
    console.log(`[Document] getElementById('${wanted}') → Zombie`);
    return HTMLNodes.theZombie;
}, 'getElementById');
rawDocument.contains = nativize((node) => (node === rawDocument.documentElement || node === rawDocument.body), 'contains');
rawDocument.parentNode = null;
rawDocument.parentElement = null;
rawDocument.tagName = 'BODY';
rawDocument.nodeName = '#document';
rawDocument.previousSibling = null;
rawDocument.nextSibling = null;
rawDocument.previousElementSibling = null;
rawDocument.nextElementSibling = null;
const nodeFilter = {
    FILTER_ACCEPT: 1,
    FILTER_REJECT: 2,
    FILTER_SKIP: 3,
    SHOW_ALL: 0xFFFFFFFF,
    SHOW_ELEMENT: 0x1,
    SHOW_TEXT: 0x4,
};
context.NodeFilter = nodeFilter;
rawWindow.NodeFilter = nodeFilter;
rawDocument.createNodeIterator = nativize((root, whatToShow = nodeFilter.SHOW_ALL, filter = null) => {
    const nodes = [];
    const accepts = (node) => {
        if (!filter) return true;
        try {
            if (typeof filter === 'function') return filter(node) === nodeFilter.FILTER_ACCEPT;
            if (filter && typeof filter.acceptNode === 'function') return filter.acceptNode(node) === nodeFilter.FILTER_ACCEPT;
        } catch (e) {
            return false;
        }
        return true;
    };
    const visit = (node) => {
        if (!node || (typeof node !== 'object' && typeof node !== 'function')) return;
        if ((whatToShow & nodeFilter.SHOW_ELEMENT) && node.nodeType === 1 && accepts(node)) nodes.push(node);
        if ((whatToShow & nodeFilter.SHOW_TEXT) && node.nodeType === 3 && accepts(node)) nodes.push(node);
        const children = Array.isArray(node._children) ? node._children : (node.childNodes || []);
        for (const child of Array.from(children)) visit(child);
    };
    visit(root);
    if (process.env.PURE_IFRAME_DEBUG === '1') {
        console.log(`[NodeIterator] root=${root && (root.tagName || root.nodeType)} what=${whatToShow} filter=${filter ? typeof filter : 'none'} nodes=${nodes.length}`);
        console.log(`[NodeIterator] nodes=${nodes.map((node, idx) => {
            const parent = node && node.parentNode;
            return `${idx}:${node && (node.tagName || node.nodeType)}#${node && node.id || ''}->${parent === undefined ? 'undefined' : parent === null ? 'null' : (parent.tagName || parent.nodeType || 'object')}`;
        }).join(' | ')}`);
    }
    let index = 0;
    const iterator = {
        root,
        whatToShow,
        filter,
        referenceNode: root || null,
        currentNode: root || null,
        pointerBeforeReferenceNode: true,
        nextNode: nativize(() => {
            const node = nodes[index++] || null;
            if (node) {
                iterator.referenceNode = node;
                iterator.currentNode = node;
                iterator.pointerBeforeReferenceNode = false;
            }
            return node;
        }, 'nextNode'),
        previousNode: nativize(() => {
            index = Math.max(0, index - 1);
            const node = nodes[index] || null;
            if (node) {
                iterator.referenceNode = node;
                iterator.currentNode = node;
                iterator.pointerBeforeReferenceNode = true;
            }
            return node;
        }, 'previousNode'),
        detach: nativize(() => {}, 'detach'),
    };
    return iterator;
}, 'createNodeIterator');
const featurePolicy = {
    features: nativize(() => [], 'features'),
    allowedFeatures: nativize(() => [], 'allowedFeatures'),
    allowsFeature: nativize(() => false, 'allowsFeature'),
    getAllowlistForFeature: nativize(() => [], 'getAllowlistForFeature'),
};
rawDocument.featurePolicy = featurePolicy;
rawDocument.permissionsPolicy = featurePolicy;

// 智能 currentScript (获取 ray ID)
let activeExternalScript = null;
Object.defineProperty(rawDocument, 'currentScript', {
    get: () => {
        if (activeExternalScript) return activeExternalScript;
        const scripts = rawDocument.getElementsByTagName('script');
        if (scripts && scripts.length) {
            for (let i = 0; i < scripts.length; i++) {
                if ((scripts[i].src || '').includes('/turnstile/')) return scripts[i];
                if ((scripts[i].src || '').includes('orchestrate')) return scripts[i];
            }
        }
        return null;
    }, enumerable: true, configurable: true
});

rawWindow.document = rawDocument;

// Location 设置 — 从 cfConfig 动态构建 targetUrl，避免硬编码过期 token
const zone = String(cfConfig.cZone || '')
    .replace(/^https?:\/\//, '')
    .replace(/\/$/, '');
const targetUrl = cfConfig.cUPMDTk
    ? `https://${zone}${cfConfig.cUPMDTk}`
    : `https://${zone}/`;
const urlObj = new URL(targetUrl);
rawWindow.location = {
    href: targetUrl, protocol: urlObj.protocol, host: urlObj.host, hostname: urlObj.hostname,
    pathname: urlObj.pathname, search: urlObj.search, hash: urlObj.hash, origin: urlObj.origin,
    reload: () => {
    }, replace: () => {
    }, assign: () => {
    }, toString: function () {
        return this.href;
    }
};

// =============================================================================
// 3. Apply Plugins (Feature Injection)
// =============================================================================
// 应用插件，把它们挂载到 context 和 rawWindow 上
useAsyncPlugin(context, rawWindow);
useBrowserPlugin(context, rawWindow, profile);
useNetworkPlugin(context, rawWindow, profile, {dumpDir: challengeDumpDir});

// vm2 顶层 this 指向 sandbox，本项目的目标脚本会用 this/self 做全局对象。
// 所以除了 window，也要把核心 BOM 能力同步到 sandbox 顶层。
[
    'navigator', 'clientInformation', 'screen', 'performance', 'chrome',
    'innerWidth', 'innerHeight', 'outerWidth', 'outerHeight', 'devicePixelRatio',
    'isSecureContext', 'URL', 'URLSearchParams', 'BigInt', 'Blob', 'FileReader',
    'ReadableStream', 'Worker', 'CSS', 'Node', 'DOMParser', 'Event', 'MouseEvent', 'KeyboardEvent',
    'CustomEvent', 'DOMException', 'MutationObserver', 'AbortSignal', 'AbortController',
    'MessageChannel', 'MessagePort', 'XMLHttpRequest', 'Headers', 'FormData',
    'Request', 'Response', 'fetch', 'atob', 'btoa', 'eval', 'Function',
    'Audio', 'AudioContext', 'OfflineAudioContext', 'webkitAudioContext',
    'webkitOfflineAudioContext', 'RTCPeerConnection', 'RTCSessionDescription',
    'RTCIceCandidate', 'webkitRTCPeerConnection'
].forEach((key) => {
    if (rawWindow[key] !== undefined) context[key] = rawWindow[key];
});

// 补全剩余全局对象
context.matchMedia = nativize((q) => ({
    matches: true, media: q, addListener: () => {
    }, removeListener: () => {
    }
}), 'matchMedia');
context.getComputedStyle = nativize(() => {
    const s = new context.CSSStyleDeclaration();
    s.setProperty('display', 'block');
    return s;
}, 'getComputedStyle');
context.addEventListener = nativize(rawWindow.addEventListener.bind(rawWindow), 'addEventListener');
context.removeEventListener = nativize(rawWindow.removeEventListener.bind(rawWindow), 'removeEventListener');
context.dispatchEvent = nativize(rawWindow.dispatchEvent.bind(rawWindow), 'dispatchEvent');

// Media & Canvas Glue
context.WebGLRenderingContext = Media.WebGLRenderingContext;
context.HTMLCanvasElement = class HTMLCanvasElement extends HTMLNodes.HTMLCanvasElement {
    constructor(ctx) {
        super(ctx);
    }

    getContext(t) {
        return t === '2d' ? new context.CanvasRenderingContext2D(this) : new context.WebGLRenderingContext(this);
    }
};
context.Image = class Image extends HTMLNodes.HTMLImageElement {
    constructor() {
        super(context);
        return rawDocument.createElement('img');
    }
};

// =============================================================================
// 4. Proxy & Execution
// =============================================================================
// 注入 CF 配置 (从独立文件加载)
// 计算原始 URL 的 query/hash（去掉 __cf_chl_tk 参数后）
const ogUrl = new URL(targetUrl);
ogUrl.searchParams.delete('__cf_chl_tk');
ogUrl.searchParams.delete('__cf_chl_f_tk');
const cOgUQuery = ogUrl.search || '';
const cOgUHash  = ogUrl.hash  || '';

const proxyConfig = proxyFactory.create({
    ...cfConfig,
    cOgUHash,
    cOgUQuery,
}, "_cf_chl_opt");

rawWindow._cf_chl_opt = proxyConfig;
rawWindow.__cf_chl_opt = proxyConfig;
context._cf_chl_opt = proxyConfig;
context.__cf_chl_opt = proxyConfig;

// 创建全局 Proxy
const proxyWindow = proxyFactory.create(rawWindow, "window");
const proxyDocument = proxyFactory.create(rawDocument, "document");
rawDocument.parentNode = proxyDocument;

context.window = proxyWindow;
context.self = proxyWindow;
context.top = proxyWindow;
context.parent = proxyWindow;
context.globalThis = proxyWindow;
context.document = proxyDocument;
context.location = rawWindow.location;
context.history = rawWindow.history;
context.crypto = rawWindow.crypto;
context.localStorage = rawWindow.localStorage;
context.sessionStorage = rawWindow.sessionStorage;

Object.assign(context, HTMLNodes);
Object.assign(rawWindow, HTMLNodes);
rawWindow.Document = context.Document;
rawWindow.EventTarget = EventTarget;
rawWindow.Window = Window;
rawWindow.HTMLCollection = context.HTMLCollection;
rawWindow.NodeList = context.NodeList;
rawWindow.DOMCollection = context.DOMCollection;
context.EventTarget = EventTarget;
context.Window = Window;

proxyFactory.createFallbackElement = () => {
    const el = rawDocument.createElement('div');
    el.ownerDocument = rawDocument;
    el.style.width = '300px';
    el.style.height = '65px';
    el.style.display = 'block';
    if (!el.id) el.id = `cf-fallback-${Math.random().toString(36).slice(2)}`;
    if (rawDocument.body && typeof rawDocument.body.appendChild === 'function' && !rawDocument.body.contains(el)) {
        rawDocument.body.appendChild(el);
    }
    return el;
};

// 清理环境
delete context.global;
delete context.process;
delete context.Buffer;

// =============================================================================
// 4.5 动态脚本加载器 & Cookie 修复
// =============================================================================
const nodeFetch = require('node-fetch');

// 已加载/正在加载的脚本 URL，避免重复执行
// 预先标记 orchestrate 脚本（由 runner.runFile 直接执行，不需要再网络加载）
const orchestratePattern = /cdn-cgi\/challenge-platform\/h\/b\/orchestrate/;
const loadedScripts = new Set();

const isTurnstileScript = (url) => /challenges\.cloudflare\.com\/turnstile\//.test(String(url || ''));
let pendingTurnstileOnloadName = null;
let pendingTurnstileInitialOnloadCallback = null;
let pendingTurnstileStateSnapshot = null;
let pendingTurnstileOnloadSince = 0;
const invokedTurnstileOnloads = new WeakSet();
let turnstileRenderSeen = false;
let turnstileOnloadReplayCount = 0;
let turnstileOnloadLastReplay = 0;

const executeTurnstileInHostRealm = (source, finalUrl) => {
    const safeUrl = String(finalUrl || 'turnstile-host.js').replace(/[\r\n]/g, '');
    if (pureTurnstileMode && isTurnstileScript(finalUrl)) {
        const guardExpr = (label, expr, fallback) =>
            `(function(){try{return ${expr}}catch(e){console.log("[TurnstileGuard] ${label}: "+(e&&e.message));return ${fallback}}})()`;
        source = source
            .replace('"ht.atrs":o(document.body.parentNode)', `"ht.atrs":${guardExpr('ht.atrs', 'o(document.body.parentNode)', '[]')}`)
            .replace('ffp:ia(r.wrapper)', `ffp:${guardExpr('ffp', 'ia(r.wrapper)', '""')}`)
            .replace('pfp:oa(document,Fr,Dr)', `pfp:${guardExpr('pfp', 'oa(document,Fr,Dr)', '""')}`)
            .replace('wp:na(r.wrapper)', `wp:${guardExpr('wp', 'na(r.wrapper)', '""')}`)
            .replace('xp:aa(r.wrapper).slice(0,Wr)', `xp:${guardExpr('xp', 'aa(r.wrapper).slice(0,Wr)', '""')}`);
    }
    const hostIntrinsicNames = [
        'Object', 'Function', 'Array', 'String', 'Number', 'Boolean', 'RegExp',
        'Date', 'Math', 'JSON', 'Promise', 'Symbol', 'Reflect', 'Proxy',
        'WeakMap', 'WeakSet', 'Map', 'Set', 'DataView', 'ArrayBuffer',
        'Uint8Array', 'Int8Array', 'Uint16Array', 'Int16Array', 'Uint32Array',
        'Float32Array', 'Float64Array', 'Uint8ClampedArray',
        'Error', 'TypeError', 'EvalError', 'RangeError', 'ReferenceError',
        'SyntaxError', 'URIError', 'parseInt', 'parseFloat', 'isNaN', 'isFinite',
        'encodeURI', 'decodeURI', 'encodeURIComponent', 'decodeURIComponent',
        'escape', 'unescape', 'URLSearchParams', 'TextEncoder', 'TextDecoder'
    ];
    for (const name of hostIntrinsicNames) {
        if (globalThis[name]) rawWindow[name] = globalThis[name];
    }
    const wrapped = `
        var window = arguments[0];
        var self = window;
        var globalThis = window;
        var document = arguments[1];
        var location = arguments[2];
        var navigator = arguments[3];
        var process = undefined;
        var require = undefined;
        var module = undefined;
        var exports = undefined;
        var Buffer = undefined;
        var global = window;
        with (window) {
            ${source}
        }
        //# sourceURL=${safeUrl}
    `;
    const fn = new Function(wrapped);
    fn.call(proxyWindow, proxyWindow, proxyDocument, rawWindow.location, rawWindow.navigator);
};

const triggerScriptReady = (scriptEl, finalUrl, reason) => {
    if (reason) console.log(`[ScriptLoader] ${reason}`);
    const isTurnstile = isTurnstileScript(finalUrl);
    if (!(pureTurnstileMode && isTurnstile) && scriptEl && typeof scriptEl.onload === 'function') {
        try { scriptEl.onload(); } catch (e) {}
    }

    const onloadMatch = String(finalUrl || '').match(/[?&]onload=([^&]+)/);
    if (!onloadMatch) return;

    const cbName = decodeURIComponent(onloadMatch[1]);
    console.log(`[ScriptLoader] 触发 Turnstile onload 回调: ${cbName}`);
    if (isTurnstile) pendingTurnstileOnloadName = cbName;
    if (pureTurnstileMode && isTurnstile) {
        const cb = rawWindow[cbName] || context[cbName];
        pendingTurnstileInitialOnloadCallback = typeof cb === 'function' ? cb : null;
        pendingTurnstileOnloadSince = Date.now();
        pendingTurnstileStateSnapshot = new Map();
        for (const source of [rawWindow, context]) {
            for (const key of Reflect.ownKeys(source)) {
                if (typeof key !== 'string' || pendingTurnstileStateSnapshot.has(key)) continue;
                pendingTurnstileStateSnapshot.set(key, Object.prototype.hasOwnProperty.call(source, key) ? source[key] : undefined);
            }
        }
        console.log(`[ScriptLoader] PURE_TURNSTILE: 延后 onload，当前回调类型: ${typeof cb}`);
        return;
    }
    try {
        const cb = rawWindow[cbName] || context[cbName];
        console.log(`[ScriptLoader] onload 回调类型: ${typeof cb}`);
        if (typeof cb === 'function') {
            invokedTurnstileOnloads.add(cb);
            turnstileOnloadReplayCount++;
            turnstileOnloadLastReplay = Date.now();
            cb();
        }
        else console.log(`[ScriptLoader] onload 回调不存在: ${cbName}`);
    } catch (e) {
        console.log(`[ScriptLoader] 回调执行失败: ${e.message}`);
        if (e.stack) console.log(`[ScriptLoader] 回调 stack: ${String(e.stack).split('\n').slice(0, 10).join(' | ')}`);
    }
};

const installTurnstileProbe = () => {
    const ts = rawWindow.turnstile || context.turnstile;
    if (!ts || ts.__pureProbeInstalled) return;
    Object.defineProperty(ts, '__pureProbeInstalled', {value: true, configurable: true});
    const keys = Object.keys(ts).join(', ');
    console.log(`[TurnstileProbe] real API keys: ${keys}`);
    for (const name of ['render', 'execute', 'reset', 'remove', 'getResponse', 'ready']) {
        if (typeof ts[name] !== 'function') continue;
        const original = ts[name];
        ts[name] = function(...args) {
            const first = args[0];
            const second = args[1];
            const sitekey = second && second.sitekey;
            console.log(`[TurnstileProbe] ${name}(${first && first.tagName || typeof first}, sitekey=${sitekey || ''})`);
            try {
                if (name === 'render') turnstileRenderSeen = true;
                const ret = original.apply(this, args);
                console.log(`[TurnstileProbe] ${name} -> ${ret}`);
                return ret;
            } catch (e) {
                console.log(`[TurnstileProbe] ${name} throw: ${e.message}`);
                if (e.stack) console.log(`[TurnstileProbe] stack: ${String(e.stack).split('\n').slice(0, 8).join(' | ')}`);
                throw e;
            }
        };
    }
};

if (pureTurnstileMode) {
    const derivePureGlobalKeys = () => {
        const fallback = ['rLIi5', 'fAJq8', 'Bccyw0', 'UJYG7', 'RuXv0', 'qOQn5', 'GViAi4', 'Zrha9', 'dKdZ9'];
        try {
            const source = fs.readFileSync(path.join(__dirname, 'target/target.js'), 'utf8');
            const match = source.match(/['"](_cf_chl_opt;_cf_chl_state;[^'"]+)['"]\.split\(['"];\s*['"]\)/);
            if (!match) return fallback;
            return match[1]
                .split(';')
                .filter((key) => key && !key.startsWith('_cf_'))
                .filter((key) => key !== 'puQFi0' && key !== 'frameElement')
                .slice(0, 24);
        } catch (e) {
            return fallback;
        }
    };
    const pureGlobalKeys = derivePureGlobalKeys();
    const ownValue = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : undefined;
    const globalValue = (key) => {
        const rawVal = ownValue(rawWindow, key);
        if (rawVal !== undefined) return rawVal;
        return ownValue(context, key);
    };
    const dumpPureState = (label) => {
        const keys = pureGlobalKeys;
        const state = keys.map((key) => {
            const val = globalValue(key);
            const type = typeof val;
            const text = type === 'function' ? 'function' : type === 'object' && val ? (val.tagName || val.constructor && val.constructor.name || 'object') : String(val);
            return `${key}:${type}:${text}`;
        }).join(' | ');
        console.log(`[PureState:${label}] ${state}`);
    };
	    const onloadReplay = setInterval(() => {
	        if (turnstileRenderSeen || turnstileOnloadReplayCount >= 12) return;
	        if (!pendingTurnstileOnloadName) return;
	        if (ownValue(rawWindow, 'Bccyw0') === true || ownValue(context, 'Bccyw0') === true) {
	            if (turnstileOnloadReplayCount === 0) dumpPureState('skip-replay-already-initialized');
	            turnstileOnloadReplayCount = 12;
	            return;
        }
        const cb = globalValue(pendingTurnstileOnloadName);
        if (typeof cb !== 'function') return;
        if (invokedTurnstileOnloads.has(cb)) {
            turnstileOnloadReplayCount = 12;
            return;
        }
        const callbackReplaced = pendingTurnstileInitialOnloadCallback && cb !== pendingTurnstileInitialOnloadCallback;
        const hasChallengeState = callbackReplaced || pureGlobalKeys.some((key) => {
            if (key === pendingTurnstileOnloadName) return false;
            const val = globalValue(key);
            const oldVal = pendingTurnstileStateSnapshot && pendingTurnstileStateSnapshot.has(key)
                ? pendingTurnstileStateSnapshot.get(key)
                : undefined;
            return val !== oldVal && val !== undefined && val !== '' &&
                typeof val !== 'function' && typeof val !== 'boolean';
        });
        if (!hasChallengeState) {
            if (pendingTurnstileOnloadSince && Date.now() - pendingTurnstileOnloadSince > 8000) {
                dumpPureState('wait-challenge-state-timeout');
                console.log('[ScriptLoader] PURE_TURNSTILE: 等待挑战状态超时，停止 onload 重放等待');
                turnstileOnloadReplayCount = 12;
                return;
            }
            if (pureStateDebug && turnstileOnloadReplayCount === 0 && Date.now() - turnstileOnloadLastReplay > 1000) {
                dumpPureState('wait-challenge-state');
                turnstileOnloadLastReplay = Date.now();
            }
            return;
        }
        if (Date.now() - turnstileOnloadLastReplay < 1000) return;
        if (turnstileOnloadReplayCount === 0) {
            for (const key of ['fAJq8', 'Bccyw0', 'wzzNi2', 'TMvR3']) {
                delete rawWindow[key];
                delete context[key];
            }
        }
        dumpPureState(`before-replay-${turnstileOnloadReplayCount + 1}`);
        console.log(`[ScriptLoader] PURE_TURNSTILE: 重放 onload 回调 ${pendingTurnstileOnloadName}`);
        invokedTurnstileOnloads.add(cb);
        turnstileOnloadReplayCount++;
        turnstileOnloadLastReplay = Date.now();
        try {
            cb();
        } catch (e) {
            console.log(`[ScriptLoader] PURE_TURNSTILE onload 重放失败: ${e.message}`);
            if (e.stack) console.log(`[ScriptLoader] PURE_TURNSTILE onload stack: ${String(e.stack).split('\n').slice(0, 10).join(' | ')}`);
        }
        dumpPureState(`after-replay-${turnstileOnloadReplayCount}`);
    }, 250);
    onloadReplay.unref && onloadReplay.unref();
}

const tryExecuteLocalTurnstile = (scriptEl, finalUrl, reason) => {
    if (!pureTurnstileMode || !isTurnstileScript(finalUrl)) return false;
    const localTurnstilePath = path.join(__dirname, 'target/turnstile-api.js');
    if (!fs.existsSync(localTurnstilePath)) return false;
    try {
        const text = fs.readFileSync(localTurnstilePath, 'utf8');
        console.log(`[ScriptLoader] ${reason}，改用本地真实 Turnstile: ${localTurnstilePath}`);
        delete rawWindow.turnstile;
        delete context.turnstile;
        activeExternalScript = scriptEl || null;
        executeTurnstileInHostRealm(text, finalUrl);
        installTurnstileProbe();
        triggerScriptReady(scriptEl, finalUrl, 'PURE_TURNSTILE: 本地真实脚本执行完成');
        return true;
    } catch (e) {
        console.log(`[ScriptLoader] 本地 Turnstile 执行失败: ${e.message}`);
        if (e.stack) console.log(`[ScriptLoader] 本地 Turnstile stack: ${String(e.stack).split('\n').slice(0, 8).join(' | ')}`);
        return false;
    } finally {
        activeExternalScript = null;
    }
};

// 异步抓取并在 VM 中执行外链脚本
const loadExternalScript = (scriptEl) => {
    const src = scriptEl && (scriptEl.src || scriptEl.getAttribute('src'));
    if (!src || loadedScripts.has(src)) return;
    // orchestrate 脚本已经由 runner.runFile 执行过了，跳过网络加载
    if (orchestratePattern.test(src)) {
        console.log(`[ScriptLoader] 跳过（已本地执行）: ${src.substring(0, 80)}`);
        triggerScriptReady(scriptEl, src);
        return;
    }
    loadedScripts.add(src);

    let finalUrl = src;
    if (src.startsWith('/')) {
        finalUrl = `https://www.sciencedirect.com${src}`;
    }

    console.log(`[ScriptLoader] 加载: ${finalUrl.substring(0, 100)}`);

    nodeFetch(finalUrl, {
        headers: {
            'User-Agent': profile.userAgent,
            'Referer': context.location.href,
            'Accept': '*/*',
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        },
        redirect: 'follow',
        timeout: 15000,
    }).then(async (resp) => {
        const text = await resp.text();
        if (!resp.ok) {
            console.log(`[ScriptLoader] 响应 ${resp.status}，跳过执行: ${finalUrl.substring(0, 80)}`);
            if (isTurnstileScript(finalUrl)) {
                if (tryExecuteLocalTurnstile(scriptEl, finalUrl, `Turnstile 响应 ${resp.status}`)) return;
                triggerScriptReady(scriptEl, finalUrl, 'Turnstile 使用本地 mock 继续');
                return;
            }
            if (scriptEl.onerror) { try { scriptEl.onerror(); } catch(e){} }
            return;
        }
        console.log(`[ScriptLoader] 执行 ${text.length} 字节: ${finalUrl.substring(0, 80)}`);
        if (scriptEl) scriptEl.src = finalUrl;
        if (pureTurnstileMode && isTurnstileScript(finalUrl)) {
            try {
                console.log('[ScriptLoader] PURE_TURNSTILE: 尝试 host realm 执行 Turnstile...');
                delete rawWindow.turnstile;
                delete context.turnstile;
                activeExternalScript = scriptEl || null;
                executeTurnstileInHostRealm(text, finalUrl);
                installTurnstileProbe();
                triggerScriptReady(scriptEl, finalUrl, 'PURE_TURNSTILE: host realm 执行完成');
                return;
            } catch (e) {
                console.log(`[ScriptLoader] PURE_TURNSTILE host realm 失败: ${e.message}`);
                if (e.stack) {
                    console.log(`[ScriptLoader] PURE_TURNSTILE stack: ${String(e.stack).split('\n').slice(0, 10).join(' | ')}`);
                }
            } finally {
                activeExternalScript = null;
            }
        }
        try {
            activeExternalScript = scriptEl || null;
            runner.vm.run(text);
            triggerScriptReady(scriptEl, finalUrl);
        } catch(e) {
            if (e.message && e.message.includes('contextified')) {
                // vm2 沙箱限制：Turnstile 等脚本用了被 vm2 拦截的操作
                // 改用 window.eval（已绑定为 runner.vm.run）执行
                console.log(`[ScriptLoader] 尝试 eval 方式执行...`);
                try {
                    const evalFn = rawWindow.eval || ((s) => runner.vm.run(s));
                    evalFn(text);
                    triggerScriptReady(scriptEl, finalUrl);
                } catch(e2) {
                    console.log(`[ScriptLoader] eval 也失败: ${e2.message.substring(0, 100)}`);
                    if (isTurnstileScript(finalUrl) && e2.stack) {
                        console.log(`[ScriptLoader] Turnstile stack: ${String(e2.stack).split('\n').slice(0, 8).join(' | ')}`);
                    }
                    if (isTurnstileScript(finalUrl)) {
                        triggerScriptReady(scriptEl, finalUrl, 'Turnstile 真实脚本不可执行，使用本地 mock 继续');
                        return;
                    }
                    if (scriptEl.onerror) { try { scriptEl.onerror(); } catch(e3){} }
                }
            } else {
                console.log(`[ScriptLoader] 执行错误: ${e.message}`);
                if (isTurnstileScript(finalUrl) && e.stack) {
                    console.log(`[ScriptLoader] Turnstile stack: ${String(e.stack).split('\n').slice(0, 8).join(' | ')}`);
                }
                // 尝试触发 onload（让脚本流程继续）
                triggerScriptReady(scriptEl, finalUrl);
            }
        } finally {
            activeExternalScript = null;
        }
    }).catch((err) => {
        console.log(`[ScriptLoader] 网络错误: ${err.message}`);
        if (isTurnstileScript(finalUrl)) {
            if (tryExecuteLocalTurnstile(scriptEl, finalUrl, 'Turnstile 网络加载失败')) return;
            triggerScriptReady(scriptEl, finalUrl, 'Turnstile 网络加载失败，使用本地 mock 继续');
            return;
        }
        if (scriptEl.onerror) { try { scriptEl.onerror(); } catch(e){} }
    });
};

// Hook appendChild：拦截 script 元素的插入
const hookAppendChild = (element) => {
    const original = element.appendChild.bind(element);
    element.appendChild = nativize((child) => {
        const result = original(child);
        if (child && child.tagName === 'SCRIPT') {
            const src = child.src || child.getAttribute('src');
            if (src) {
                setImmediate(() => loadExternalScript(child));
            }
        }
        return result;
    }, 'appendChild');
};
hookAppendChild(rawDocument.head);
hookAppendChild(rawDocument.body);

// 同样 hook document 级别的 appendChild
const origDocAppend = rawDocument.appendChild.bind(rawDocument);
rawDocument.appendChild = nativize((child) => {
    const result = origDocAppend(child);
    if (child && child.tagName === 'SCRIPT') {
        const src = child.src || child.getAttribute('src');
        if (src) setImmediate(() => loadExternalScript(child));
    }
    return result;
}, 'appendChild');

// document.cookie 与 cookieJar 双向绑定
Object.defineProperty(rawDocument, 'cookie', {
    get: () => cookieJar.getCookieString(context.location.href),
    set: (val) => {
        if (!val) return;
        // 解析 set-cookie 格式字符串，写入 cookieJar
        const parts = String(val).split(';');
        const kv = parts[0].trim();
        const [k, ...rest] = kv.split('=');
        const key = k.trim();
        const value = rest.join('=').trim();
        if (key) {
            cookieJar.cookies.set(key, value);
        }
    },
    enumerable: true,
    configurable: true,
});

// 补全：IntersectionObserver, ResizeObserver
context.IntersectionObserver = nativize(class IntersectionObserver {
    constructor(cb, opts) { this._cb = cb; }
    observe(el) { setTimeout(() => { try { this._cb([{isIntersecting: true, target: el, intersectionRatio: 1}], this); } catch(e){} }, 50); }
    unobserve() {}
    disconnect() {}
    takeRecords() { return []; }
}, 'IntersectionObserver');
rawWindow.IntersectionObserver = context.IntersectionObserver;

context.ResizeObserver = nativize(class ResizeObserver {
    constructor(cb) { this._cb = cb; }
    observe(el) { setTimeout(() => { try { this._cb([{target: el, contentRect: {width:1280, height:720}}], this); } catch(e){} }, 50); }
    unobserve() {}
    disconnect() {}
}, 'ResizeObserver');
rawWindow.ResizeObserver = context.ResizeObserver;

// PerformanceObserver
context.PerformanceObserver = nativize(class PerformanceObserver {
    constructor(cb) { this._cb = cb; }
    observe() {}
    disconnect() {}
    takeRecords() { return []; }
    static get supportedEntryTypes() { return ['measure', 'mark', 'navigation', 'paint', 'resource']; }
}, 'PerformanceObserver');
rawWindow.PerformanceObserver = context.PerformanceObserver;

// =============================================================================
// 4.6 Turnstile Mock & 脚本加载钩子优化
// =============================================================================
// Turnstile API Mock：vm2 无法直接执行真实 Turnstile，用 mock 代替让流程继续
// 注意：mock 生成的 token 是占位符，需要真实 Turnstile 生成有效 token
const turnstileMock = {
    _widgets: new Map(),
    _widgetIdx: 0,
    render: nativize(function(container, params) {
        const wId = 'ts_widget_' + (turnstileMock._widgetIdx++);
        turnstileMock._widgets.set(wId, { container, params });
        console.log(`[Turnstile] render() called, widgetId=${wId}, sitekey=${params && params.sitekey}`);
        // 延迟500ms后尝试自动执行（模拟 managed/auto 模式）
        setTimeout(() => {
            try { turnstileMock.execute(wId); } catch(e) {}
        }, 500);
        return wId;
    }, 'render'),
    execute: nativize(function(widgetOrContainer, params) {
        const widget = turnstileMock._widgets.get(widgetOrContainer);
        const opts = widget ? widget.params : (params || {});
        console.log(`[Turnstile] execute() called`);
        // 如果有 callback，模拟调用（会生成占位 token，CF 服务器会拒绝）
        // 真正有效的 token 需要真实 Turnstile 与 CF 服务器交互
        if (typeof opts.callback === 'function') {
            setTimeout(() => {
                // 先尝试 auto-execute 路径
                console.log(`[Turnstile] 尝试触发 callback...`);
                try { opts.callback('TURNSTILE_PLACEHOLDER_TOKEN'); } catch(e) {}
            }, 200);
        }
    }, 'execute'),
    remove: nativize(function(widgetOrContainer) {
        turnstileMock._widgets.delete(widgetOrContainer);
    }, 'remove'),
    reset: nativize(function(widgetOrContainer) {}, 'reset'),
    getResponse: nativize(function(widgetOrContainer) { return ''; }, 'getResponse'),
    isExpired: nativize(function(widgetOrContainer) { return false; }, 'isExpired'),
    implicitRender: nativize(function() {}, 'implicitRender'),
};
rawWindow.turnstile = turnstileMock;
context.turnstile = turnstileMock;

// 从 cfConfig.fa 派生 __cf_chl_rt_tk URL（history.replaceState 用，纯装饰性）
const rtTkUrl = (cfConfig.fa || cfConfig.cUPMDTk || '')
    .replace('__cf_chl_f_tk=', '__cf_chl_rt_tk=')
    .replace('__cf_chl_tk=', '__cf_chl_rt_tk=');
const escapedRtTkUrl = rtTkUrl.replace(/\//g, '\\/');

// 启动脚本
const initScript = `
(function () {
    var a = document.createElement('script');
    a.src = '/cdn-cgi/challenge-platform/h/b/orchestrate/chl_page/v1?ray=${cfConfig.cRay}';
    if (window.history && window.history.replaceState) {
        var ogU = location.pathname + window._cf_chl_opt.cOgUQuery + window._cf_chl_opt.cOgUHash;
        history.replaceState(null, null, "${escapedRtTkUrl}" + window._cf_chl_opt.cOgUHash);
        a.onload = function () { history.replaceState(null, null, ogU); }
    }
    document.head.appendChild(a);
}());
`;

console.log("正在执行初始化脚本...");
runner.vm.run(initScript);

console.log("正在执行 Target...");
runner.runFile(path.join(__dirname, 'target/target.js'));

setTimeout(() => {
    console.log(">>> [系统] 触发 DOMContentLoaded");
    proxyDocument.dispatchEvent({type: 'DOMContentLoaded', isTrusted: true});
}, 100);
setTimeout(() => {
    console.log(">>> [系统] 触发 window.load");
    proxyWindow.dispatchEvent({type: 'load', isTrusted: true});
}, 500);

// 注入模拟鼠标/键盘事件，帮助 CF 指纹收集
setTimeout(() => {
    const mkMouseEvt = (type, x, y) => ({
        type, isTrusted: true, bubbles: true, cancelable: true,
        clientX: x, clientY: y, screenX: x+100, screenY: y+100,
        pageX: x, pageY: y, movementX: Math.random()*5|0, movementY: Math.random()*3|0,
        buttons: 0, button: 0, which: 0,
        timeStamp: Date.now(),
    });
    const moves = [[200,300],[210,305],[215,310],[220,315],[230,320],[240,325],[250,330]];
    let i = 0;
    const moveInterval = setInterval(() => {
        if (i < moves.length) {
            const [x, y] = moves[i++];
            proxyWindow.dispatchEvent(mkMouseEvt('mousemove', x, y));
            proxyDocument.dispatchEvent(mkMouseEvt('mousemove', x, y));
        } else {
            clearInterval(moveInterval);
            proxyWindow.dispatchEvent(mkMouseEvt('mousedown', 250, 330));
            proxyWindow.dispatchEvent(mkMouseEvt('mouseup', 250, 330));
            proxyWindow.dispatchEvent(mkMouseEvt('click', 250, 330));
        }
    }, 80);

    // visibility change (页面可见)
    proxyDocument.dispatchEvent({type: 'visibilitychange', isTrusted: true, bubbles: true});
    proxyWindow.dispatchEvent({type: 'focus', isTrusted: true, bubbles: false});
}, 800);

// 调试：每 5 秒打印一次 Fsrf1 状态
const debugInterval = setInterval(() => {
    try {
        const fsrf1Val = rawWindow._cf_chl_opt && rawWindow._cf_chl_opt.Fsrf1;
        const len = Array.isArray(fsrf1Val) ? fsrf1Val.length : 'non-array';
        console.log(`[Debug] Fsrf1 长度=${len}, 值=${JSON.stringify(fsrf1Val).substring(0,100)}`);
        const allInputs = rawDocument.getElementsByTagName('input');
        const allDivs = rawDocument.getElementsByTagName('div');
        const allScripts = rawDocument.getElementsByTagName('script');
        console.log(`[Debug] DOM inputs=${allInputs ? allInputs.length : 0}, divs=${allDivs ? allDivs.length : 0}, scripts=${allScripts ? allScripts.length : 0}`);
    } catch(e) {}
}, 5000);

setInterval(() => {
    const clearance = cookieJar.cookies && cookieJar.cookies.get('cf_clearance');
    if (clearance) {
        if (startupClearance && clearance === startupClearance) {
            if (!reportedStartupClearance) {
                console.log('[Cookie] cf_clearance 仍是启动时导入的旧值，继续等待本轮新 token');
                reportedStartupClearance = true;
            }
            return;
        }
        console.log("\n🚀🚀🚀 成功拿到 cf_clearance !!! 🚀🚀🚀");
        console.log(`cf_clearance=${clearance}`);
        process.exit(0);
    }

    const inputs = rawDocument.getElementsByTagName('input');
    if (inputs && inputs.length > 0) {
        for (let i = 0; i < inputs.length; i++) {
            const name = inputs[i].getAttribute('name');
            const val = inputs[i].getAttribute('value');
            if (name === 'cf_challenge_response' || name === 'cf-turnstile-response') {
                if (val) {
                    console.log("\n🚀🚀🚀 成功拿到 Token !!! 🚀🚀🚀");
                    console.log(val);
                    process.exit(0);
                }
            }
        }
    }
}, 2000);
