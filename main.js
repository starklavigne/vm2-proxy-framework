const ProxyFactory = require('./src/core/ProxyFactory');
const VMRunner = require('./src/runner/VMRunner');
const Window = require('./src/env/Window');
const Document = require('./src/env/Document');
const Crypto = require('./src/env/Crypto');
const HTMLNodes = require('./src/env/HTMLNode');
const EventTarget = require('./src/env/EventTarget');
const profile = require('./src/config/browserProfile');
const path = require('path');

const runner = new VMRunner();
const context = runner.vm.sandbox;
const proxyFactory = new ProxyFactory({enableLog: true});

// ============================================
// 【核心武器 1】增强版原生函数伪装
// ============================================
const nativize = (func, name) => {
    if (typeof func !== 'function') func = () => {};
    const funcName = name || func.name || '';
    const nativeString = `function ${funcName}() { [native code] }`;

    // 1. 伪造 toString
    Object.defineProperty(func, 'toString', {
        value: function() { return nativeString; },
        writable: true, configurable: true, enumerable: false
    });
    // 隐藏 toString 自身的 toString
    Object.defineProperty(func.toString, 'toString', {
        value: function() { return "function toString() { [native code] }"; }
    });

    // 2. 伪造 name 属性 (使其不可写，更像原生)
    Object.defineProperty(func, 'name', {
        value: funcName,
        writable: false, enumerable: false, configurable: true
    });

    return func;
};

// 拦截全局 Function.toString
const originalFnToString = Function.prototype.toString;
Function.prototype.toString = function() {
    if (this.hasOwnProperty('toString')) return this.toString();
    return originalFnToString.call(this);
};
Object.defineProperty(Function.prototype.toString, 'toString', {
    value: function() { return "function toString() { [native code] }"; }
});

// ============================================
// 【核心武器 2】Trusted Types Polyfill (Chrome 必查)
// ============================================
const TrustedTypes = {
    createPolicy: nativize((name, rules) => ({
        name,
        createHTML: (s) => s,
        createScript: (s) => s,
        createScriptURL: (s) => s
    }), 'createPolicy'),
    defaultPolicy: null,
    getAttributeType: nativize(() => null, 'getAttributeType'),
    isHTML: nativize(() => false, 'isHTML'),
    isScript: nativize(() => false, 'isScript'),
    isScriptURL: nativize(() => false, 'isScriptURL'),
    addEventListener: nativize(() => {}, 'addEventListener'),
    removeEventListener: nativize(() => {}, 'removeEventListener'),
    dispatchEvent: nativize(() => true, 'dispatchEvent'),
};
// 挂载到全局
context.trustedTypes = TrustedTypes;
context.TrustedTypePolicyFactory = nativize(function TrustedTypePolicyFactory(){}, 'TrustedTypePolicyFactory');

// ============================================
// 【核心武器 3】MessageChannel (完善版)
// ============================================
class MessagePort extends EventTarget {
    constructor() {
        super();
        this.otherPort = null;
        this.onmessage = null;
    }
    postMessage(data) {
        if (!this.otherPort) return;
        // 必须使用 setTimeout 模拟微任务，打破同步死锁
        context.setTimeout(() => {
            const event = { data, ports: [], target: this.otherPort, type: 'message' };
            if (typeof this.otherPort.onmessage === 'function') {
                this.otherPort.onmessage(event);
            }
            this.otherPort.dispatchEvent(event);
        }, 0);
    }
    start() {}
    close() {}
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

// ============================================
// 环境构建
// ============================================

// 修正原型链
Object.setPrototypeOf(Window.prototype, EventTarget.prototype);

const rawWindow = new Window(context, profile);
const rawDocument = new Document(profile, rawWindow);
rawWindow.document = rawDocument;

// URL 配置
const targetUrl = "https://www.sciencedirect.com/journal/phytochemistry-letters/issues?__cf_chl_tk=.OsjsaDOkWliTeNQOf7nokkouVLo2hfCBAImALUHHVg-1754468250-1.0.1.1-zwYm2xWq.YoRBK5Xk67cv.lC6IrWV9iFRgOBZ4q4mmw";
const urlObj = new URL(targetUrl);
rawWindow.location.href = targetUrl;
rawWindow.location.protocol = urlObj.protocol;
rawWindow.location.host = urlObj.host;
rawWindow.location.hostname = urlObj.hostname;
rawWindow.location.pathname = urlObj.pathname;
rawWindow.location.search = urlObj.search;
rawWindow.location.hash = urlObj.hash;
rawWindow.location.origin = urlObj.origin;

rawWindow.crypto = new Crypto();

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
context.performance = rawWindow.performance;

// Navigator 深度伪装
context.navigator = {
    userAgent: profile.userAgent,
    appCodeName: "Mozilla",
    appName: "Netscape",
    appVersion: profile.userAgent.replace('Mozilla/', ''),
    platform: "MacIntel",
    product: "Gecko",
    vendor: "Google Inc.",
    language: "zh-CN",
    languages: ["zh-CN", "zh", "en"],
    cookieEnabled: true,
    onLine: true,
    hardwareConcurrency: 8,
    webdriver: false,
    plugins: [1, 2, 3],
    mimeTypes: [1, 2],
    permissions: { query: nativize(async () => ({ state: 'granted' }), 'query') },
    maxTouchPoints: 0,
    connection: { effectiveType: '4g', rtt: 50, downlink: 10, saveData: false } // Network Info API
};

// Chrome 对象
context.chrome = {
    runtime: { id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' },
    app: { isInstalled: false, InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' }, RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' } }
};

context.screen = { width: 1920, height: 1080, availWidth: 1920, availHeight: 1040, colorDepth: 24, pixelDepth: 24 };

Object.assign(context, HTMLNodes);

// 方法挂载
context.addEventListener = nativize(rawWindow.addEventListener.bind(rawWindow), 'addEventListener');
context.removeEventListener = nativize(rawWindow.removeEventListener.bind(rawWindow), 'removeEventListener');
context.dispatchEvent = nativize(rawWindow.dispatchEvent.bind(rawWindow), 'dispatchEvent');
context.attachEvent = nativize(() => {}, 'attachEvent');
context.detachEvent = nativize(() => {}, 'detachEvent');

context.alert = nativize(() => {}, 'alert');
context.prompt = nativize(() => {}, 'prompt');
context.confirm = nativize(() => true, 'confirm');

// Timer Fix
const timerMap = new Map();
let timerIdCounter = 1;
context.setTimeout = nativize((cb, delay, ...args) => {
    const id = timerIdCounter++;
    const timer = setTimeout(() => { timerMap.delete(id); cb(...args); }, delay);
    timerMap.set(id, timer);
    return id;
}, 'setTimeout');
context.clearTimeout = nativize((id) => {
    const timer = timerMap.get(id);
    if (timer) { clearTimeout(timer); timerMap.delete(id); }
}, 'clearTimeout');
context.setInterval = nativize(setInterval, 'setInterval');
context.clearInterval = nativize(clearInterval, 'clearInterval');

// 微任务
context.queueMicrotask = nativize((cb) => Promise.resolve().then(cb), 'queueMicrotask');

context.atob = nativize((input) => Buffer.from(String(input), 'base64').toString('binary'), 'atob');
context.btoa = nativize((input) => Buffer.from(String(input), 'binary').toString('base64'), 'btoa');

context.Image = class Image extends HTMLNodes.HTMLImageElement {
    constructor() { super(context); return rawDocument.createElement('img'); }
};

// RAF
context.requestAnimationFrame = nativize((callback) => {
    return context.setTimeout(() => { callback(performance.now()); }, 16);
}, 'requestAnimationFrame');
context.cancelAnimationFrame = nativize((id) => context.clearTimeout(id), 'cancelAnimationFrame');
context.webkitRequestAnimationFrame = context.requestAnimationFrame;

// Network (Auto-Allow)
context.fetch = nativize(async (url, options) => {
    console.log(`\n>>> [Network] Fetch: ${url}`);
    return {
        ok: true, status: 200,
        json: async () => ({}),
        text: async () => "",
        headers: { get: () => null }
    };
}, 'fetch');

context.XMLHttpRequest = class XMLHttpRequest extends EventTarget {
    constructor() {
        super();
        this.readyState = 0;
        this.status = 200;
        this.onreadystatechange = null;
        this.withCredentials = false;
    }
    open(method, url) {
        console.log(`\n>>> [Network] XHR Open: ${method} ${url}`);
        this.readyState = 1;
    }
    setRequestHeader(k, v) {}
    send(body) {
        console.log(`>>> [Network] XHR Send: ${body ? body.substring(0, 50) : 'null'}...`);
        this.readyState = 4;
        context.setTimeout(() => {
            if (this.onreadystatechange) this.onreadystatechange();
            this.dispatchEvent({ type: 'load' });
        }, 50);
    }
    getAllResponseHeaders() { return ""; }
};
nativize(context.XMLHttpRequest, 'XMLHttpRequest');

// --- 注入配置与脚本 ---
const cfConfig = {
    cvId: '3',
    cZone: 'www.sciencedirect.com',
    cType: 'interactive',
    cRay: '96ad19251be61fa9',
    cH: 'C2vNFLGrpOxUmMykCmGLeBZYUaoJ651au1AlXVa4AVQ-1754468250-1.2.1.1-CIRTrcfylW2BtG_z5CWRvfkeCgUxN8gSgqKYzcWCgsCe5cIdnVl8JGA0EG2tO4ZW',
    cUPMDTk: "\/journal\/phytochemistry-letters\/issues?__cf_chl_tk=.OsjsaDOkWliTeNQOf7nokkouVLo2hfCBAImALUHHVg-1754468250-1.0.1.1-zwYm2xWq.YoRBK5Xk67cv.lC6IrWV9iFRgOBZ4q4mmw",
    cFPWv: 'b',
    cITimeS: '1754468250',
    cTplC: 1,
    cTplV: 5,
    cTplB: 'cf',
    fa: "\/journal\/phytochemistry-letters\/issues?__cf_chl_f_tk=.OsjsaDOkWliTeNQOf7nokkouVLo2hfCBAImALUHHVg-1754468250-1.0.1.1-zwYm2xWq.YoRBK5Xk67cv.lC6IrWV9iFRgOBZ4q4mmw",
    md: 'BIIQ8IRiM7CZcwMqsWFQd4vD4OYeDzLHhl46QkrIFhI-1754468250-1.2.1.1-ykJOyNAmWoWcVi2sANRIdqb8GLbrcldomK8GDYsPcfZgmn7cxcwTtpw9RbmR1bSHrzwrLx2s2TjMkzP7l68IapufRfsJQ3J74z0Pj5klSvrz3cI2ATKCru8Yay2lYYGJM1QFkNEVheI1YKEh38hySnT2ldkQqwyWfHlAWjj4Jsxtc2PH7njzjmtZkKvcc8yhHFsuA956ASS6jbuv.2qc0SG55izAK6zsiafsFL_ye2z2Rh7zaw4AfkKPVXvxlbjFMhlJdlcZZc1wLm0a9dzT4lMYRqPpCPh.YlAViyGYHF22AluXWFe7s3d2TZcj3KEV6VjZdg5GB.SFFaJmtcuNyRhkBQVLTgamySqFJtbpih7pyGjktIWfApoSQaWCDgWs3apK.hDRbisE780kE0dQGdbu2uoIrJok0xEtoOq0dBC2wy3u77JXT4tUkrURrv3tMvXdrYgM.Ija0frJbAYMSMGuoCURSAaIMMMio18y.tbfSB1Id1xlbbdGmwFV0.nMN.zp.U8coR3HD9cKaxk0jM__m4UGImA5milKzI9vwEtotmsAg8O.MdN4qyXn_LzyihcDNPAZwWuSn_QxmfYUjbwZkoFqqkX4S2._sstjjQ61Ci2hreffDkcMQzBaBmwbIIe447ej7SYogA792DoJvHAD0oixD8hOahPqn92ue6qRJ7zil7_UsVpEpcfctAU4xtMBRqqhQTv0IfAVQ4j6T127_Q4QbLCL9gpyV0Fw2pQ.YGWDJNtOTyhwFV.Pvpu.2dJ5PxZIpASISSYI_2Z4X2.XuMBE2z.BTYpzQmszwFN63fbkt70Kfgfj1uX7OSR8Y0UF6EHqU0fkI9dbdv4mlXW6zUH9vNFESo2kT7JEwtH6mM77rcsx37frR.uUx_1eTWcTCFUO8iosGmc.LrkLtshiUWAHGLmYoAna9GmlTwXJWaxQIr54jMq0q1Bu7Tjn4CW3pXVJkSnHmvVLLQkuqp2atBmdLPYQ4OwmGDtMRlD7TCN7_sntcpUntPwsa8pi1dr_Cyz.RtCn_eKl54CL3Uv_3Xn3rDzc1dm39XlOnOlniVndNq9ZI4cVQ6RWqNJ6FmxSpJjskIL3THCxoxW6pM_SL2Fg.MGKYPXIVzHipxQ',
};

const proxyConfig = proxyFactory.create(cfConfig, "_cf_chl_opt");
rawWindow._cf_chl_opt = proxyConfig;
rawWindow.__cf_chl_opt = proxyConfig;
context._cf_chl_opt = proxyConfig;
context.__cf_chl_opt = proxyConfig;

const initScript = `
(function () {
    var a = document.createElement('script');
    a.src = '/cdn-cgi/challenge-platform/h/b/orchestrate/chl_page/v1?ray=96ad19251be61fa9';
    window._cf_chl_opt.cOgUHash = location.hash === '' && location.href.indexOf('#') !== -1 ? '#' : location.hash;
    window._cf_chl_opt.cOgUQuery = location.search === '' && location.href.slice(0, location.href.length - window._cf_chl_opt.cOgUHash.length).indexOf('?') !== -1 ? '?' : location.search;
    if (window.history && window.history.replaceState) {
        var ogU = location.pathname + window._cf_chl_opt.cOgUQuery + window._cf_chl_opt.cOgUHash;
        history.replaceState(null, null, "\\/journal\\/phytochemistry-letters\\/issues?__cf_chl_rt_tk=.OsjsaDOkWliTeNQOf7nokkouVLo2hfCBAImALUHHVg-1754468250-1.0.1.1-zwYm2xWq.YoRBK5Xk67cv.lC6IrWV9iFRgOBZ4q4mmw" + window._cf_chl_opt.cOgUHash);
        a.onload = function () {
            history.replaceState(null, null, ogU);
        }
    }
    document.getElementsByTagName('head')[0].appendChild(a);
}());
`;

console.log("正在执行初始化脚本...");
runner.vm.run(initScript);

console.log("正在执行 Target...");
const targetFile = path.join(__dirname, 'target/target.js');
runner.runFile(targetFile);

setTimeout(() => {
    console.log(">>> [系统] 触发 DOMContentLoaded");
    proxyDocument.dispatchEvent({ type: 'DOMContentLoaded', isTrusted: true });
}, 100);

setTimeout(() => {
    console.log(">>> [系统] 触发 window.load");
    proxyWindow.dispatchEvent({ type: 'load', isTrusted: true });
}, 500);

setInterval(() => {
    const inputs = rawDocument.getElementsByTagName('input');
    if (inputs && inputs.length > 0) {
        console.log(">>> [监控] Input 数量:", inputs.length);
        for (let i = 0; i < inputs.length; i++) {
            const input = inputs[i];
            const name = input.name || input.getAttribute('name');
            const val = input.value || input.getAttribute('value');
            if (name === 'cf_challenge_response' || name === 'cf-turnstile-response') {
                console.log("\n🚀🚀🚀 成功拿到 Token !!! 🚀🚀🚀");
                console.log(val);
                process.exit(0);
            }
        }
    }
}, 2000);