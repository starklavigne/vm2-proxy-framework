const ProxyFactory = require('./src/core/ProxyFactory');
const VMRunner = require('./src/runner/VMRunner');
const Crypto = require('./src/env/Crypto');
const EventTarget = require('./src/env/EventTarget');
const Media = require('./src/env/Media');
const Window = require('./src/env/Window');
const Document = require('./src/env/Document');
const HTMLNodes = require('./src/env/HTMLNode');
const profile = require('./src/config/browserProfile');
const path = require('path');

const runner = new VMRunner();
const context = runner.vm.sandbox;
const proxyFactory = new ProxyFactory({enableLog: true});

// 1. Native Mask
const nativize = (func, name) => {
    if (typeof func !== 'function') func = () => {
    };
    const funcName = name || func.name || '';
    const nativeString = `function ${funcName}() { [native code] }`;
    Object.defineProperty(func, 'toString', {
        value: () => nativeString,
        writable: true,
        configurable: true,
        enumerable: false
    });
    if (func.prototype) Object.defineProperty(func.prototype.constructor, 'name', {
        value: funcName,
        writable: false,
        configurable: true
    });
    return func;
};
Object.defineProperty(Function.prototype.toString, 'toString', {value: () => "function toString() { [native code] }"});

// 2. Core Classes
class CSSStyleDeclaration {
    constructor() {
        this.length = 0;
        this._values = {};
    }

    getPropertyValue(n) {
        return this._values[n] || "";
    }

    setProperty(n, v) {
        this._values[n] = v;
    }

    removeProperty(n) {
        delete this._values[n];
    }

    item(i) {
        return "";
    }
}

context.CSSStyleDeclaration = nativize(CSSStyleDeclaration, 'CSSStyleDeclaration');

class Plugin {
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
}

context.Plugin = nativize(Plugin, 'Plugin');

class PluginArray {
    constructor() {
        this._plugins = [
            new Plugin("PDF Viewer", "Portable Document Format", "internal-pdf-viewer"),
            new Plugin("Chrome PDF Viewer", "Portable Document Format", "internal-pdf-viewer"),
            new Plugin("Chromium PDF Viewer", "Portable Document Format", "internal-pdf-viewer"),
            new Plugin("Microsoft Edge PDF Viewer", "Portable Document Format", "internal-pdf-viewer"),
            new Plugin("WebKit built-in PDF", "Portable Document Format", "internal-pdf-viewer")
        ];
        this.length = this._plugins.length;
        this._plugins.forEach((p, i) => this[i] = p);
    }

    item(i) {
        return this._plugins[i];
    }

    namedItem(n) {
        return this._plugins.find(p => p.name === n);
    }

    refresh() {
    }

    [Symbol.iterator]() {
        return this._plugins.values();
    }
}

context.PluginArray = nativize(PluginArray, 'PluginArray');

class MimeTypeArray {
    constructor() {
        this.length = 2;
        this[0] = {type: "application/pdf"};
        this[1] = {type: "text/pdf"};
    }

    item(i) {
        return this[i];
    }

    namedItem() {
        return null;
    }
}

context.MimeTypeArray = nativize(MimeTypeArray, 'MimeTypeArray');

class Storage {
    constructor() {
        this._store = new Map();
    }

    get length() {
        return this._store.size;
    }

    clear() {
        this._store.clear();
    }

    getItem(k) {
        return this._store.has(String(k)) ? this._store.get(String(k)) : null;
    }

    key(i) {
        return Array.from(this._store.keys())[i] || null;
    }

    removeItem(k) {
        this._store.delete(String(k));
    }

    setItem(k, v) {
        this._store.set(String(k), String(v));
    }
}

context.Storage = nativize(Storage, 'Storage');

// 3. Environment
Object.setPrototypeOf(Window.prototype, EventTarget.prototype);
Object.setPrototypeOf(Document.prototype, EventTarget.prototype);

context.Document = nativize(Document, 'Document');
context.HTMLDocument = context.Document;

const rawWindow = new Window(context, profile);
rawWindow.crypto = new Crypto();
rawWindow.localStorage = new Storage();
rawWindow.sessionStorage = new Storage();

const rawDocument = new Document(profile, rawWindow);
const libDoc = new (require('./src/env/Document'))(profile, rawWindow);
for (const key in libDoc) {
    if (key === 'location') continue;
    try {
        if (typeof libDoc[key] === 'function') {
            rawDocument[key] = nativize(libDoc[key].bind(rawDocument), key);
        } else {
            rawDocument[key] = libDoc[key];
        }
    } catch (e) {
    }
}

// 覆盖 createElement
rawDocument.createElement = nativize((tag) => {
    const tagName = tag.toUpperCase();
    const clsName = `HTML${tagName.charAt(0).toUpperCase() + tagName.slice(1).toLowerCase()}Element`;
    if (context[clsName]) return new context[clsName]();
    return new context.HTMLElement(tagName);
}, 'createElement');

// 【核心修复】添加 contains 方法到 Document
rawDocument.contains = nativize((node) => {
    // 文档始终包含其 html/body
    if (node === rawDocument.documentElement || node === rawDocument.body) return true;
    return rawDocument.documentElement.contains(node);
}, 'contains');

// 【核心修复】添加 activeElement
Object.defineProperty(rawDocument, 'activeElement', {
    get: () => rawDocument.body || null, // 默认聚焦 body
    enumerable: true,
    configurable: true
});

rawWindow.document = rawDocument;

const targetUrl = "https://www.sciencedirect.com/journal/phytochemistry-letters/issues?__cf_chl_tk=.OsjsaDOkWliTeNQOf7nokkouVLo2hfCBAImALUHHVg-1754468250-1.0.1.1-zwYm2xWq.YoRBK5Xk67cv.lC6IrWV9iFRgOBZ4q4mmw";
const urlObj = new URL(targetUrl);
rawWindow.location = {
    href: targetUrl, protocol: urlObj.protocol, host: urlObj.host, hostname: urlObj.hostname,
    pathname: urlObj.pathname, search: urlObj.search, hash: urlObj.hash, origin: urlObj.origin,
    reload: nativize(() => {
    }, 'reload'), replace: nativize(() => {
    }, 'replace'), assign: nativize(() => {
    }, 'assign'),
    toString: function () {
        return this.href;
    }
};

const proxyConfig = proxyFactory.create({
    cvId: '3', cZone: 'www.sciencedirect.com', cType: 'interactive', cRay: '96ad19251be61fa9',
    cH: 'C2vNFLGrpOxUmMykCmGLeBZYUaoJ651au1AlXVa4AVQ-1754468250-1.2.1.1-CIRTrcfylW2BtG_z5CWRvfkeCgUxN8gSgqKYzcWCgsCe5cIdnVl8JGA0EG2tO4ZW',
    cUPMDTk: "\/journal\/phytochemistry-letters\/issues?__cf_chl_tk=.OsjsaDOkWliTeNQOf7nokkouVLo2hfCBAImALUHHVg-1754468250-1.0.1.1-zwYm2xWq.YoRBK5Xk67cv.lC6IrWV9iFRgOBZ4q4mmw",
    cFPWv: 'b', cITimeS: '1754468250', cTplC: 1, cTplV: 5, cTplB: 'cf',
    fa: "\/journal\/phytochemistry-letters\/issues?__cf_chl_f_tk=.OsjsaDOkWliTeNQOf7nokkouVLo2hfCBAImALUHHVg-1754468250-1.0.1.1-zwYm2xWq.YoRBK5Xk67cv.lC6IrWV9iFRgOBZ4q4mmw",
    md: 'BIIQ8IRiM7CZcwMqsWFQd4vD4OYeDzLHhl46QkrIFhI-1754468250-1.2.1.1-ykJOyNAmWoWcVi2sANRIdqb8GLbrcldomK8GDYsPcfZgmn7cxcwTtpw9RbmR1bSHrzwrLx2s2TjMkzP7l68IapufRfsJQ3J74z0Pj5klSvrz3cI2ATKCru8Yay2lYYGJM1QFkNEVheI1YKEh38hySnT2ldkQqwyWfHlAWjj4Jsxtc2PH7njzjmtZkKvcc8yhHFsuA956ASS6jbuv.2qc0SG55izAK6zsiafsFL_ye2z2Rh7zaw4AfkKPVXvxlbjFMhlJdlcZZc1wLm0a9dzT4lMYRqPpCPh.YlAViyGYHF22AluXWFe7s3d2TZcj3KEV6VjZdg5GB.SFFaJmtcuNyRhkBQVLTgamySqFJtbpih7pyGjktIWfApoSQaWCDgWs3apK.hDRbisE780kE0dQGdbu2uoIrJok0xEtoOq0dBC2wy3u77JXT4tUkrURrv3tMvXdrYgM.Ija0frJbAYMSMGuoCURSAaIMMMio18y.tbfSB1Id1xlbbdGmwFV0.nMN.zp.U8coR3HD9cKaxk0jM__m4UGImA5milKzI9vwEtotmsAg8O.MdN4qyXn_LzyihcDNPAZwWuSn_QxmfYUjbwZkoFqqkX4S2._sstjjQ61Ci2hreffDkcMQzBaBmwbIIe447ej7SYogA792DoJvHAD0oixD8hOahPqn92ue6qRJ7zil7_UsVpEpcfctAU4xtMBRqqhQTv0IfAVQ4j6T127_Q4QbLCL9gpyV0Fw2pQ.YGWDJNtOTyhwFV.Pvpu.2dJ5PxZIpASISSYI_2Z4X2.XuMBE2z.BTYpzQmszwFN63fbkt70Kfgfj1uX7OSR8Y0UF6EHqU0fkI9dbdv4mlXW6zUH9vNFESo2kT7JEwtH6mM77rcsx37frR.uUx_1eTWcTCFUO8iosGmc.LrkLtshiUWAHGLmYoAna9GmlTwXJWaxQIr54jMq0q1Bu7Tjn4CW3pXVJkSnHmvVLLQkuqp2atBmdLPYQ4OwmGDtMRlD7TCN7_sntcpUntPwsa8pi1dr_Cyz.RtCn_eKl54CL3Uv_3Xn3rDzc1dm39XlOnOlniVndNq9ZI4cVQ6RWqNJ6FmxSpJjskIL3THCxoxW6pM_SL2Fg.MGKYPXIVzHipxQ',
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

// Performance
const perfStart = Date.now();
context.performance = {
    timeOrigin: perfStart,
    now: nativize(() => Date.now() - perfStart, 'now'),
    timing: {navigationStart: perfStart},
    getEntries: nativize(() => [], 'getEntries')
};

context.navigator = {
    userAgent: profile.userAgent, appCodeName: "Mozilla", appName: "Netscape",
    appVersion: profile.userAgent.replace('Mozilla/', ''), platform: "MacIntel",
    product: "Gecko", vendor: "Google Inc.", language: "zh-CN", languages: ["zh-CN", "zh", "en"],
    cookieEnabled: true, onLine: true, hardwareConcurrency: 8, webdriver: false, maxTouchPoints: 0,
    plugins: new PluginArray(), mimeTypes: new MimeTypeArray(),
    permissions: {query: nativize(async () => ({state: 'granted'}), 'query')},
    connection: {effectiveType: '4g', rtt: 50, downlink: 10, saveData: false}
};

context.chrome = {runtime: {id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'}, app: {isInstalled: false}};
context.screen = {width: 1920, height: 1080, availWidth: 1920, availHeight: 1040, colorDepth: 24, pixelDepth: 24};

Object.assign(context, HTMLNodes);
context.EventTarget = EventTarget;
context.Window = Window;

// 4. API
class MessagePort extends EventTarget {
    constructor() {
        super();
        this.otherPort = null;
    }

    postMessage(data) {
        if (!this.otherPort) return;
        process.nextTick(() => {
            const event = {data, ports: [], target: this.otherPort, type: 'message'};
            if (typeof this.otherPort.onmessage === 'function') this.otherPort.onmessage(event);
            this.otherPort.dispatchEvent(event);
        });
    }
}

context.MessageChannel = nativize(class MessageChannel {
    constructor() {
        this.port1 = new MessagePort();
        this.port2 = new MessagePort();
        this.port1.otherPort = this.port2;
        this.port2.otherPort = this.port1;
    }
}, 'MessageChannel');
context.MessagePort = MessagePort;

context.trustedTypes = {
    createPolicy: nativize((n, r) => ({
        createHTML: s => s,
        createScript: s => s,
        createScriptURL: s => s
    }), 'createPolicy'),
    defaultPolicy: null,
    getAttributeType: nativize(() => null, 'getAttributeType'),
    isHTML: nativize(() => false, 'isHTML'),
    isScript: nativize(() => false, 'isScript'),
    isScriptURL: nativize(() => false, 'isScriptURL'),
    addEventListener: nativize(() => {
    }, 'addEventListener'),
    removeEventListener: nativize(() => {
    }, 'removeEventListener'),
    dispatchEvent: nativize(() => true, 'dispatchEvent')
};

context.matchMedia = nativize((query) => ({
    matches: true, media: query, onchange: null,
    addListener: nativize(() => {
    }, 'addListener'), removeListener: nativize(() => {
    }, 'removeListener'),
    addEventListener: nativize(() => {
    }, 'addEventListener'), removeEventListener: nativize(() => {
    }, 'removeEventListener'),
    dispatchEvent: nativize(() => true, 'dispatchEvent')
}), 'matchMedia');

context.getComputedStyle = nativize((element) => {
    const style = new CSSStyleDeclaration();
    style.setProperty('display', 'block');
    style.setProperty('visibility', 'visible');
    style.setProperty('opacity', '1');
    return style;
}, 'getComputedStyle');

context.addEventListener = nativize(rawWindow.addEventListener.bind(rawWindow), 'addEventListener');
context.removeEventListener = nativize(rawWindow.removeEventListener.bind(rawWindow), 'removeEventListener');
context.dispatchEvent = nativize(rawWindow.dispatchEvent.bind(rawWindow), 'dispatchEvent');
context.attachEvent = nativize(() => {
}, 'attachEvent');
context.detachEvent = nativize(() => {
}, 'detachEvent');
context.alert = nativize(() => {
}, 'alert');

const timerMap = new Map();
let timerIdCounter = 1;
context.setTimeout = nativize((cb, delay, ...args) => {
    const id = timerIdCounter++;
    const timer = setTimeout(() => {
        timerMap.delete(id);
        cb(...args);
    }, delay);
    timerMap.set(id, timer);
    return id;
}, 'setTimeout');
context.clearTimeout = nativize((id) => {
    const timer = timerMap.get(id);
    if (timer) {
        clearTimeout(timer);
        timerMap.delete(id);
    }
}, 'clearTimeout');
context.setInterval = nativize(setInterval, 'setInterval');
context.clearInterval = nativize(clearInterval, 'clearInterval');
context.requestAnimationFrame = nativize((cb) => context.setTimeout(() => cb(context.performance.now()), 16), 'requestAnimationFrame');
context.cancelAnimationFrame = nativize((id) => context.clearTimeout(id), 'cancelAnimationFrame');
context.queueMicrotask = nativize((cb) => Promise.resolve().then(cb), 'queueMicrotask');

context.atob = nativize((input) => Buffer.from(String(input), 'base64').toString('binary'), 'atob');
context.btoa = nativize((input) => Buffer.from(String(input), 'binary').toString('base64'), 'btoa');

context.CanvasRenderingContext2D = Media.CanvasRenderingContext2D;
context.WebGLRenderingContext = Media.WebGLRenderingContext;
context.AudioContext = Media.AudioContext;
context.OfflineAudioContext = Media.OfflineAudioContext;

context.HTMLCanvasElement = class HTMLCanvasElement extends HTMLNodes.HTMLCanvasElement {
    constructor(ctx) {
        super(ctx);
    }

    getContext(type) {
        if (type === '2d') return new context.CanvasRenderingContext2D(this);
        if (type.includes('webgl')) return new context.WebGLRenderingContext(this);
        return null;
    }
};
context.HTMLCanvasElement = nativize(context.HTMLCanvasElement, 'HTMLCanvasElement');
context.Image = class Image extends HTMLNodes.HTMLImageElement {
    constructor() {
        super(context);
        return rawDocument.createElement('img');
    }
};

context.fetch = nativize(async (url, options) => {
    console.log(`\n>>> [Network] Fetch: ${url}`);
    return {ok: true, status: 200, json: async () => ({}), text: async () => "", headers: {get: () => null}};
}, 'fetch');
context.XMLHttpRequest = class XMLHttpRequest extends EventTarget {
    constructor() {
        super();
        this.readyState = 0;
        this.status = 200;
        this.onreadystatechange = null;
    }

    open(method, url) {
        console.log(`\n>>> [Network] XHR Open: ${method} ${url}`);
        this.readyState = 1;
    }

    setRequestHeader() {
    }

    send(body) {
        console.log(`>>> [Network] XHR Send: ${body ? body.substring(0, 50) : 'null'}...`);
        this.readyState = 4;
        context.setTimeout(() => {
            if (this.onreadystatechange) this.onreadystatechange();
            this.dispatchEvent({type: 'load'});
        }, 50);
    }

    getAllResponseHeaders() {
        return "";
    }
};
nativize(context.XMLHttpRequest, 'XMLHttpRequest');

// Cleanup
delete context.global;
delete context.process;
delete context.Buffer;
delete context.setImmediate;
delete context.clearImmediate;

const initScript = `
(function () {
    var a = document.createElement('script');
    a.src = '/cdn-cgi/challenge-platform/h/b/orchestrate/chl_page/v1?ray=96ad19251be61fa9';
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
const targetFile = path.join(__dirname, 'target/target.js');
runner.runFile(targetFile);

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
            const input = inputs[i];
            const name = input.getAttribute('name');
            const val = input.getAttribute('value');
            console.log(name)
            // if (name === 'cf_challenge_response' || name === 'cf-turnstile-response') {
            //     console.log("\n🚀🚀🚀 成功拿到 Token !!! 🚀🚀🚀");
            //     console.log(val);
            //     process.exit(0);
            // }
        }
    }
}, 2000);