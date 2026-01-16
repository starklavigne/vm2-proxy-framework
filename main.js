// =============================================================================
// Main Entry - VM2 Proxy Framework
// =============================================================================
const path = require('path');
const {URL} = require('url');
const {TextEncoder, TextDecoder} = require('util');

// Core Modules
const ProxyFactory = require('./src/core/ProxyFactory');
const VMRunner = require('./src/runner/VMRunner');
const profile = require('./src/config/browserProfile');
const cfConfig = require('./src/config/cfConfig'); // 独立的 CF 配置

// Utils
const {nativize} = require('./src/utils/tools');

// Plugins (Features)
const useAsyncPlugin = require('./src/plugins/AsyncPlugin');
const useBrowserPlugin = require('./src/plugins/BrowserPlugin');
const useNetworkPlugin = require('./src/plugins/NetworkPlugin');

// Env Objects
const Crypto = require('./src/env/Crypto');
const EventTarget = require('./src/env/EventTarget');
const Media = require('./src/env/Media');
const Window = require('./src/env/Window');
const Document = require('./src/env/Document');
const HTMLNodes = require('./src/env/HTMLNode');

// =============================================================================
// 1. VM & Context Setup
// =============================================================================
const runner = new VMRunner();
const context = runner.vm.sandbox;
const proxyFactory = new ProxyFactory({enableLog: true});

// 基础环境注入
context.TextEncoder = TextEncoder;
context.TextDecoder = TextDecoder;
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
rawWindow.TextEncoder = TextEncoder;
rawWindow.TextDecoder = TextDecoder;

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
    const clsName = `HTML${tagName.charAt(0).toUpperCase() + tagName.slice(1).toLowerCase()}Element`;
    if (context[clsName]) return new context[clsName]();
    return new context.HTMLElement(tagName);
}, 'createElement');
rawDocument.contains = nativize((node) => (node === rawDocument.documentElement || node === rawDocument.body), 'contains');

// 智能 currentScript (获取 ray ID)
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

// Location 设置
const targetUrl = "https://www.sciencedirect.com/journal/phytochemistry-letters/issues?__cf_chl_tk=.OsjsaDOkWliTeNQOf7nokkouVLo2hfCBAImALUHHVg-1754468250-1.0.1.1-zwYm2xWq.YoRBK5Xk67cv.lC6IrWV9iFRgOBZ4q4mmw";
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
useNetworkPlugin(context, rawWindow, profile);

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
context.AudioContext = Media.AudioContext;
context.OfflineAudioContext = Media.OfflineAudioContext;
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
const proxyConfig = proxyFactory.create({
    ...cfConfig, // 载入配置
    cOgUHash: urlObj.hash === '' && urlObj.href.indexOf('#') !== -1 ? '#' : urlObj.hash,
    cOgUQuery: urlObj.search === '' && urlObj.href.slice(0, urlObj.href.length - urlObj.hash.length).indexOf('?') !== -1 ? '?' : urlObj.search
}, "_cf_chl_opt");

rawWindow._cf_chl_opt = proxyConfig;
rawWindow.__cf_chl_opt = proxyConfig;
context._cf_chl_opt = proxyConfig;
context.__cf_chl_opt = proxyConfig;

// 创建全局 Proxy
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
context.EventTarget = EventTarget;
context.Window = Window;

// 清理环境
delete context.global;
delete context.process;
delete context.Buffer;

// 启动脚本
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

setInterval(() => {
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