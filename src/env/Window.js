const Navigator = require('./Navigator');
const Screen = require('./Screen');
const Performance = require('./Performance');
const Crypto = require('./Crypto');
const {XMLHttpRequest, Headers, FormData} = require('./NetworkMock');
const {theZombie} = require('./HTMLNode');
// 引入 nativize
const { nativize } = require('../utils/tools');

class Window {
    constructor(context, profile = {}) {
        this._context = context;
        // 全局对象注入
        const globals = [
            'Object', 'Function', 'Array', 'String', 'Number', 'Boolean', 'RegExp', 'Date', 'Math', 'JSON', 'Promise', 'Symbol', 'Reflect', 'Proxy', 'WeakMap', 'WeakSet', 'Map', 'Set', 'DataView', 'ArrayBuffer',
            'Uint8Array', 'Int8Array', 'Uint16Array', 'Int16Array', 'Uint32Array', 'Int32Array', 'Float32Array', 'Float64Array', 'Uint8ClampedArray',
            'Error', 'TypeError', 'EvalError', 'RangeError', 'ReferenceError', 'SyntaxError', 'URIError',
            'console', 'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'encodeURI', 'decodeURI', 'encodeURIComponent', 'decodeURIComponent', 'escape', 'unescape'
        ];
        globals.forEach(prop => {
            if (context[prop]) this[prop] = context[prop];
        });

        // 基础环境
        this.window = this; // 这里的 this 稍后会被 Proxy 覆盖
        this.self = this;
        this.globalThis = this;
        this.top = this;
        this.parent = this;
        this.frames = this;

        this.navigator = new Navigator(profile, context);
        this.clientInformation = this.navigator;
        this.screen = new Screen(profile);
        this.performance = new Performance();
        this.crypto = new Crypto();
        this.document = context.document || null;

        // Network
        this.XMLHttpRequest = XMLHttpRequest;
        this.Headers = Headers;
        this.FormData = FormData;

        // Base64
        this.atob = nativize((input) => Buffer.from(String(input), 'base64').toString('binary'), 'atob');
        this.btoa = nativize((input) => Buffer.from(String(input), 'binary').toString('base64'), 'btoa');

        // Chrome specific
        this.chrome = {
            runtime: {},
            loadTimes: () => ({}),
            csi: () => ({}),
            app: {isInstalled: false}
        };

        // History & Location
        this.history = {
            length: 1, state: null, scrollRestoration: 'auto',
            back: () => {}, forward: () => {}, go: () => {},
            pushState: (state) => { this.history.state = state; },
            replaceState: (state) => { this.history.state = state; }
        };
        this.location = context.location || {
            href: "https://challenges.cloudflare.com/",
            origin: "https://challenges.cloudflare.com",
            protocol: "https:",
            host: "challenges.cloudflare.com",
            hostname: "challenges.cloudflare.com",
            reload: () => {}, replace: () => {}, toString: () => "https://challenges.cloudflare.com/"
        };

        // Storage
        const createStorage = () => ({
            getItem: (k) => null, setItem: (k,v) => {}, removeItem: (k) => {}, clear: () => {}, key: (i) => null, length: 0
        });
        this.localStorage = createStorage();
        this.sessionStorage = createStorage();

        // Events
        this._listeners = {};
        this.onerror = null;
        this.onload = null;
        this.onclick = null;
        this.onmessage = null;
        this.onunhandledrejection = null;
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

        // Timers
        this.setTimeout = nativize((cb, d, ...args) => setTimeout(cb, d, ...args), 'setTimeout');
        this.clearTimeout = nativize((id) => clearTimeout(id), 'clearTimeout');
        this.setInterval = nativize((cb, d, ...args) => setInterval(cb, d, ...args), 'setInterval');
        this.clearInterval = nativize((id) => clearInterval(id), 'clearInterval');

        this.fetch = nativize(() => Promise.resolve({
            ok: true, status: 200, text: () => Promise.resolve(''),
            json: () => Promise.resolve({}), headers: {get: () => null}
        }), 'fetch');

        this.Image = nativize(class Image {
            constructor() {
                // 模拟 new Image() 返回 HTMLImageElement
                if (context.document && context.document.createElement) return context.document.createElement('img');
                return {};
            }
        }, 'Image');

        this.matchMedia = nativize(() => ({
            matches: false, addListener: () => {}, removeListener: () => {}
        }), 'matchMedia');

        this.getComputedStyle = nativize((el) => el.style || {getPropertyValue: () => ''}, 'getComputedStyle');
        this.requestAnimationFrame = nativize((cb) => setTimeout(cb, 16), 'requestAnimationFrame');
        this.cancelAnimationFrame = nativize((id) => clearTimeout(id), 'cancelAnimationFrame');

        // ============================================================
        // 【核心修复】Window Proxy 模拟全局作用域查找
        // ============================================================
        return new Proxy(this, {
            get: (target, prop, receiver) => {
                // 1. 优先 Window 自身属性
                if (prop in target) return Reflect.get(target, prop, receiver);

                // 2. vm2 顶层 this/sandbox 与 window 不是同一个对象，先同步读取 sandbox 顶层属性
                if (typeof prop === 'string' && target._context && prop in target._context) {
                    return target._context[prop];
                }

                // 3. 尝试从 Document 查找真实 ID (window.id 特性)
                if (typeof prop === 'string' && target.document && target.document.getElementById) {
                    const el = target.document.getElementById(prop);
                    if (el && el !== theZombie && prop !== 'then' && prop !== 'toJSON') {
                        return el;
                    }
                }

                return undefined;
            },
            set: (target, prop, value, receiver) => {
                if (typeof prop === 'string' && target._context) {
                    target._context[prop] = value;
                }
                return Reflect.set(target, prop, value, receiver);
            }
        });
    }
}

module.exports = Window;
