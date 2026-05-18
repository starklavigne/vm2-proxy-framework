// debug.js - 深度调试脚本，追踪CF脚本执行流程
const path = require('path');
const {URL} = require('url');
const {TextEncoder, TextDecoder} = require('util');
const fetch = require('node-fetch');

const ProxyFactory = require('./src/core/ProxyFactory');
const VMRunner = require('./src/runner/VMRunner');
const profile = require('./src/config/browserProfile');
const cfConfig = require('./src/config/cfConfig');
const {nativize, cookieJar} = require('./src/utils/tools');
const useAsyncPlugin = require('./src/plugins/AsyncPlugin');
const useBrowserPlugin = require('./src/plugins/BrowserPlugin');
const EventTarget = require('./src/env/EventTarget');
const Window = require('./src/env/Window');
const Document = require('./src/env/Document');
const HTMLNodes = require('./src/env/HTMLNode');
const DOMCollections = require('./src/env/DOMCollection');
const NetworkMocks = require('./src/env/NetworkMock');
const Crypto = require('./src/env/Crypto');
const Media = require('./src/env/Media');

// ===================== 全局错误监控 =====================
process.on('unhandledRejection', (error) => {
    console.log(`[!!] Promise rejection: ${error && error.message}`);
    if (error && error.stack) console.log(error.stack.split('\n').slice(0,5).join('\n'));
});
process.on('uncaughtException', (error) => {
    console.log(`[!!] Uncaught exception: ${error && error.message}`);
});

// ===================== 相同的环境搭建 =====================
const runner = new VMRunner();
const context = runner.vm.sandbox;
const proxyFactory = new ProxyFactory({enableLog: false}); // 关闭日志避免噪音

context.console = console;
context.TextEncoder = TextEncoder;
context.TextDecoder = TextDecoder;
const vmTimeOrigin = Number(cfConfig.cITimeS || Math.floor(Date.now() / 1000)) * 1000;
const hostTimeOrigin = Date.now();
context.Date = nativize(class DateShim extends Date {
    constructor(...args) { super(...(args.length ? args : [DateShim.now()])); }
    static now() { return vmTimeOrigin + (Date.now() - hostTimeOrigin); }
    static parse(value) { return Date.parse(value); }
    static UTC(...args) { return Date.UTC(...args); }
}, 'Date');

context.Plugin = nativize(class Plugin {
    constructor(n, d, f) { this.name = n; this.description = d; this.filename = f; this.length = 1; }
    item() {} namedItem() {}
}, 'Plugin');
context.PluginArray = nativize(require('./src/env/PluginArray').PluginArray, 'PluginArray');
context.MimeTypeArray = nativize(require('./src/env/MimeTypeArray'), 'MimeTypeArray');
context.HTMLCollection = nativize(DOMCollections.HTMLCollection, 'HTMLCollection');
context.NodeList = nativize(DOMCollections.NodeList, 'NodeList');
context.DOMCollection = nativize(DOMCollections.DOMCollection, 'DOMCollection');
context.URL = nativize(class URLShim extends URL {
    static createObjectURL() { return 'blob:https://www.sciencedirect.com/' + Math.random().toString(36).slice(2); }
    static revokeObjectURL() {}
}, 'URL');
context.URLSearchParams = URLSearchParams;
context.BigInt = BigInt;
context.Blob = nativize(NetworkMocks.Blob || globalThis.Blob, 'Blob');
context.FileReader = nativize(NetworkMocks.FileReader, 'FileReader');
context.ReadableStream = globalThis.ReadableStream;
context.Worker = nativize(class Worker {
    constructor(url) { this.url = String(url || ''); this.onmessage = null; this.onerror = null; }
    postMessage() {} terminate() {} addEventListener() {} removeEventListener() {} dispatchEvent() { return true; }
}, 'Worker');
context.Event = nativize(class Event {
    constructor(type, init = {}) { this.type = String(type); this.bubbles = !!init.bubbles; this.cancelable = !!init.cancelable; this.defaultPrevented = false; this.isTrusted = false; }
    preventDefault() { this.defaultPrevented = true; } stopPropagation() {}
}, 'Event');
context.MouseEvent = nativize(class MouseEvent extends context.Event {}, 'MouseEvent');
context.KeyboardEvent = nativize(class KeyboardEvent extends context.Event {}, 'KeyboardEvent');
context.CustomEvent = nativize(class CustomEvent extends context.Event {
    constructor(type, init = {}) { super(type, init); this.detail = init.detail ?? null; }
}, 'CustomEvent');
context.DOMException = nativize(class DOMException extends Error {
    constructor(message = '', name = 'Error') { super(message); this.name = name; this.code = 0; }
}, 'DOMException');
context.MutationObserver = nativize(class MutationObserver {
    constructor(callback) { this.callback = callback; this.records = []; }
    observe() {} disconnect() {} takeRecords() { const r = this.records; this.records = []; return r; }
}, 'MutationObserver');
context.AbortSignal = nativize(class AbortSignal extends EventTarget {
    constructor() { super(); this.aborted = false; this.reason = undefined; }
    throwIfAborted() { if (this.aborted) throw this.reason || new context.DOMException('signal is aborted', 'AbortError'); }
}, 'AbortSignal');
context.AbortController = nativize(class AbortController {
    constructor() { this.signal = new context.AbortSignal(); }
    abort(reason) {
        if (this.signal.aborted) return;
        this.signal.aborted = true;
        this.signal.reason = reason || new context.DOMException('signal is aborted', 'AbortError');
        this.signal.dispatchEvent({type: 'abort'});
    }
}, 'AbortController');
context.CSS = { supports: nativize(() => true, 'supports'), escape: nativize((v) => String(v).replace(/[^a-zA-Z0-9_-]/g, '\\$&'), 'escape') };
context.Storage = nativize(class Storage {
    constructor() { this.map = new Map(); }
    get length() { return this.map.size; }
    getItem(k) { return this.map.get(String(k)) ?? null; }
    setItem(k, v) { this.map.set(String(k), String(v)); }
    removeItem(k) { this.map.delete(String(k)); }
    clear() { this.map.clear(); }
    key(i) { return Array.from(this.map.keys())[i]; }
}, 'Storage');
context.CSSStyleDeclaration = nativize(require('./src/env/CSSStyleDeclaration'), 'CSSStyleDeclaration');

Object.setPrototypeOf(Window.prototype, EventTarget.prototype);
Object.setPrototypeOf(Document.prototype, EventTarget.prototype);
context.Document = nativize(Document, 'Document');

const rawWindow = new Window(context, profile);
rawWindow.crypto = new Crypto();
rawWindow.localStorage = new context.Storage();
rawWindow.sessionStorage = new context.Storage();
rawWindow.console = console;
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
rawWindow.DOMException = context.DOMException;
rawWindow.MutationObserver = context.MutationObserver;
rawWindow.AbortSignal = context.AbortSignal;
rawWindow.AbortController = context.AbortController;
rawWindow.CSS = context.CSS;
rawWindow.isSecureContext = true;

const rawDocument = new Document(profile, rawWindow);
const libDoc = new (require('./src/env/Document'))(profile, rawWindow);
for (const key in libDoc) {
    if (key === 'location') continue;
    if (typeof libDoc[key] === 'function') rawDocument[key] = nativize(libDoc[key].bind(rawDocument), key);
    else rawDocument[key] = libDoc[key];
}

rawDocument.createElement = nativize((tag) => {
    const tagName = tag.toUpperCase();
    const clsName = `HTML${tagName.charAt(0).toUpperCase() + tagName.slice(1).toLowerCase()}Element`;
    if (context[clsName]) return new context[clsName](rawWindow);
    return new context.HTMLElement(tagName, rawWindow);
}, 'createElement');
rawDocument.contains = nativize((node) => (node === rawDocument.documentElement || node === rawDocument.body), 'contains');

Object.defineProperty(rawDocument, 'currentScript', {
    get: () => {
        const scripts = rawDocument.getElementsByTagName('script');
        if (scripts && scripts.length) {
            for (let i = 0; i < scripts.length; i++) {
                if ((scripts[i].src || '').includes('orchestrate')) return scripts[i];
            }
        }
        return null;
    }, enumerable: true, configurable: true
});

rawWindow.document = rawDocument;

const targetUrl = "https://www.sciencedirect.com/journal/phytochemistry-letters/issues?__cf_chl_tk=.OsjsaDOkWliTeNQOf7nokkouVLo2hfCBAImALUHHVg-1754468250-1.0.1.1-zwYm2xWq.YoRBK5Xk67cv.lC6IrWV9iFRgOBZ4q4mmw";
const urlObj = new URL(targetUrl);
rawWindow.location = {
    href: targetUrl, protocol: urlObj.protocol, host: urlObj.host, hostname: urlObj.hostname,
    pathname: urlObj.pathname, search: urlObj.search, hash: urlObj.hash, origin: urlObj.origin,
    reload: () => {}, replace: () => {}, assign: () => {}, toString: function() { return this.href; }
};

useAsyncPlugin(context, rawWindow);
useBrowserPlugin(context, rawWindow, profile);

// ===================== 自定义网络拦截（调试用）=====================
let xhrCallCount = 0;
const realFetch = fetch;

context.XMLHttpRequest = nativize(class XMLHttpRequest extends EventTarget {
    constructor() {
        super();
        this.readyState = 0;
        this.status = 0;
        this.statusText = '';
        this.response = '';
        this.responseText = '';
        this.responseType = '';
        this.responseURL = '';
        this.onreadystatechange = null;
        this.onload = null;
        this.onerror = null;
        this.ontimeout = null;
        this.withCredentials = false;
        this._headers = {};
        this._url = '';
        this._method = 'GET';
        this._id = ++xhrCallCount;
    }

    open(method, url) {
        this._method = method;
        this._url = url;
        if (this._url && this._url.startsWith('/')) {
            const base = new URL(context.location.href);
            this._url = `${base.origin}${this._url}`;
        }
        this.readyState = 1;
        console.log(`\n[XHR#${this._id}] open ${method} ${this._url}`);
        if (this.onreadystatechange) this.onreadystatechange();
    }

    setRequestHeader(k, v) {
        this._headers[k] = v;
    }

    send(body) {
        console.log(`[XHR#${this._id}] send -> body length: ${body ? String(body).length : 0}`);
        if (body && String(body).length < 200) {
            console.log(`[XHR#${this._id}] body: ${String(body).substring(0, 200)}`);
        }

        const headers = {
            ...this._headers,
            'User-Agent': profile.userAgent,
            'Referer': context.location.href,
        };
        const cookieStr = cookieJar.getCookieString(this._url);
        if (cookieStr) headers['Cookie'] = cookieStr;

        realFetch(this._url, {
            method: this._method,
            headers,
            body: body || undefined,
            redirect: 'manual',
        }).then(async (resp) => {
            this.status = resp.status;
            this.statusText = resp.statusText || '';
            this.responseURL = resp.url || this._url;
            const text = await resp.text();
            this.responseText = text;
            this.response = text;
            this.readyState = 4;
            console.log(`[XHR#${this._id}] response ${resp.status}: ${text.substring(0, 150)}`);

            // 保存 cookie
            const setCookie = resp.headers.raw ? resp.headers.raw()['set-cookie'] : null;
            if (setCookie) {
                cookieJar.setCookie(setCookie);
                console.log(`[XHR#${this._id}] set-cookie updated`);
            }

            if (this.onreadystatechange) this.onreadystatechange();
            if (this.onload) this.onload();
            this.dispatchEvent({type: 'load'});
        }).catch((err) => {
            console.log(`[XHR#${this._id}] ERROR: ${err.message}`);
            this.status = 0;
            this.readyState = 4;
            if (this.onerror) this.onerror(err);
            this.dispatchEvent({type: 'error'});
        });
    }

    getAllResponseHeaders() { return ''; }
    getResponseHeader(k) { return null; }
    abort() { console.log(`[XHR#${this._id}] aborted`); }
}, 'XMLHttpRequest');
rawWindow.XMLHttpRequest = context.XMLHttpRequest;

// 调试 fetch
context.fetch = nativize(async (url, options = {}) => {
    let finalUrl = url instanceof Request ? url.url : String(url);
    if (finalUrl.startsWith('/')) {
        const base = new URL(context.location.href);
        finalUrl = `${base.origin}${finalUrl}`;
    }
    console.log(`\n[Fetch] ${(options.method || 'GET')} ${finalUrl}`);
    if (options.body) {
        const bodyStr = typeof options.body === 'string' ? options.body : '[binary]';
        console.log(`[Fetch] body: ${bodyStr.substring(0, 150)}`);
    }

    const cookieStr = cookieJar.getCookieString(finalUrl);
    const headers = {...(options.headers || {}), 'User-Agent': profile.userAgent, 'Referer': context.location.href};
    if (cookieStr) headers['Cookie'] = cookieStr;

    try {
        const resp = await realFetch(finalUrl, {...options, headers, redirect: 'manual'});
        const text = await resp.text();
        console.log(`[Fetch] response ${resp.status}: ${text.substring(0, 150)}`);

        const setCookie = resp.headers.raw ? resp.headers.raw()['set-cookie'] : null;
        if (setCookie) cookieJar.setCookie(setCookie);

        return {
            ok: resp.ok, status: resp.status, statusText: resp.statusText, url: resp.url,
            headers: { get: (n) => resp.headers.get(n) },
            text: async () => text,
            json: async () => { try { return JSON.parse(text); } catch(e) { return {}; } }
        };
    } catch (e) {
        console.log(`[Fetch] ERROR: ${e.message}`);
        throw e;
    }
}, 'fetch');
rawWindow.fetch = context.fetch;

// Headers 和 FormData
context.Headers = nativize(NetworkMocks.Headers || class Headers {
    constructor(init) { this._map = new Map(); if (init) { for (const k in init) this._map.set(k.toLowerCase(), String(init[k])); } }
    get(k) { return this._map.get(k.toLowerCase()) || null; }
    set(k, v) { this._map.set(k.toLowerCase(), String(v)); }
    append(k, v) { this._map.set(k.toLowerCase(), String(v)); }
    has(k) { return this._map.has(k.toLowerCase()); }
}, 'Headers');
context.FormData = nativize(NetworkMocks.FormData, 'FormData');
rawWindow.Headers = context.Headers;
rawWindow.FormData = context.FormData;

[
    'navigator', 'clientInformation', 'screen', 'performance', 'chrome',
    'innerWidth', 'innerHeight', 'outerWidth', 'outerHeight', 'devicePixelRatio',
    'isSecureContext', 'URL', 'URLSearchParams', 'BigInt', 'Blob', 'FileReader',
    'ReadableStream', 'Worker', 'CSS', 'Event', 'MouseEvent', 'KeyboardEvent',
    'CustomEvent', 'DOMException', 'MutationObserver', 'AbortSignal', 'AbortController',
    'MessageChannel', 'MessagePort', 'XMLHttpRequest', 'Headers', 'FormData',
    'fetch', 'atob', 'btoa', 'eval', 'Function'
].forEach((key) => {
    if (rawWindow[key] !== undefined) context[key] = rawWindow[key];
});

context.matchMedia = nativize((q) => ({ matches: false, media: q, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {} }), 'matchMedia');
context.getComputedStyle = nativize(() => {
    const s = new context.CSSStyleDeclaration();
    s.setProperty('display', 'block');
    return s;
}, 'getComputedStyle');
context.addEventListener = nativize(rawWindow.addEventListener.bind(rawWindow), 'addEventListener');
context.removeEventListener = nativize(rawWindow.removeEventListener.bind(rawWindow), 'removeEventListener');
context.dispatchEvent = nativize(rawWindow.dispatchEvent.bind(rawWindow), 'dispatchEvent');

context.WebGLRenderingContext = Media.WebGLRenderingContext;
context.AudioContext = Media.AudioContext;
context.OfflineAudioContext = Media.OfflineAudioContext;
context.HTMLCanvasElement = class HTMLCanvasElement extends HTMLNodes.HTMLCanvasElement {
    constructor(ctx) { super(ctx); }
    getContext(t) {
        return t === '2d' ? new context.CanvasRenderingContext2D(this) : new context.WebGLRenderingContext(this);
    }
};
context.Image = class Image extends HTMLNodes.HTMLImageElement {
    constructor() { super(context); return rawDocument.createElement('img'); }
};

const proxyConfig = proxyFactory.create({
    ...cfConfig,
    cOgUHash: urlObj.hash === '' && urlObj.href.indexOf('#') !== -1 ? '#' : urlObj.hash,
    cOgUQuery: urlObj.search === '' && urlObj.href.slice(0, urlObj.href.length - urlObj.hash.length).indexOf('?') !== -1 ? '?' : urlObj.search
}, "_cf_chl_opt");

rawWindow._cf_chl_opt = proxyConfig;
rawWindow.__cf_chl_opt = proxyConfig;
context._cf_chl_opt = proxyConfig;
context.__cf_chl_opt = proxyConfig;

const proxyWindow = proxyFactory.create(rawWindow, "window");
const proxyDocument = proxyFactory.create(rawDocument, "document");

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

delete context.global;
delete context.process;
delete context.Buffer;

// ===================== 执行脚本 =====================
const initScript = `
(function () {
    var a = document.createElement('script');
    a.src = '/cdn-cgi/challenge-platform/h/b/orchestrate/chl_page/v1?ray=${cfConfig.cRay}';
    if (window.history && window.history.replaceState) {
        var ogU = location.pathname + window._cf_chl_opt.cOgUQuery + window._cf_chl_opt.cOgUHash;
        history.replaceState(null, null, "\\/journal\\/phytochemistry-letters\\/issues?__cf_chl_rt_tk=.OsjsaDOkWliTeNQOf7nokkouVLo2hfCBAImALUHHVg-1754468250-1.0.1.1-zwYm2xWq.YoRBK5Xk67cv.lC6IrWV9iFRgOBZ4q4mmw" + window._cf_chl_opt.cOgUHash);
        a.onload = function () { history.replaceState(null, null, ogU); }
    }
    document.head.appendChild(a);
}());
`;

console.log("[DEBUG] 执行初始化脚本...");
runner.vm.run(initScript);

console.log("[DEBUG] 执行 Target 脚本...");
try {
    runner.runFile(path.join(__dirname, 'target/target.js'));
    console.log("[DEBUG] Target 脚本执行完毕（同步部分）");
} catch(e) {
    console.log("[DEBUG] Target 执行错误:", e.message);
    if (e.stack) console.log(e.stack.split('\n').slice(0,8).join('\n'));
}

// 触发 DOM 事件
setTimeout(() => {
    console.log("\n[DEBUG] 触发 DOMContentLoaded...");
    proxyDocument.dispatchEvent({type: 'DOMContentLoaded', isTrusted: true});
}, 100);

setTimeout(() => {
    console.log("\n[DEBUG] 触发 window.load...");
    proxyWindow.dispatchEvent({type: 'load', isTrusted: true});
}, 500);

// 监控 DOM 变化（检查 input 里是否写入了 token）
setInterval(() => {
    const inputs = rawDocument.getElementsByTagName('input');
    if (inputs && inputs.length > 0) {
        for (let i = 0; i < inputs.length; i++) {
            const name = inputs[i].getAttribute('name');
            const val = inputs[i].getAttribute('value');
            console.log(`[POLL] input[${i}] name=${name} value=${val ? val.substring(0,30) + '...' : '(empty)'}`);
            if ((name === 'cf_challenge_response' || name === 'cf-turnstile-response') && val) {
                console.log("\n🚀 拿到 Token:", val);
                process.exit(0);
            }
        }
    } else {
        console.log("[POLL] DOM 中没有 input 元素");
    }
}, 3000);

// 10秒后打印 DOM 状态
setTimeout(() => {
    console.log("\n[DEBUG] 10秒后 DOM 状态:");
    console.log("  document.body.innerHTML length:", rawDocument.body ? (rawDocument.body.innerHTML || '').length : 0);
    const scripts = rawDocument.getElementsByTagName('script');
    if (scripts) {
        console.log(`  script 元素数量: ${scripts.length}`);
        for (let i = 0; i < Math.min(scripts.length, 5); i++) {
            console.log(`  script[${i}] src=${scripts[i].src || '(inline)'}`);
        }
    }
}, 10000);

// 30秒超时
setTimeout(() => {
    console.log("\n[DEBUG] 30秒超时，退出");
    process.exit(1);
}, 30000);
