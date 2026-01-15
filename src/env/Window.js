const Navigator = require('./Navigator');
const Screen = require('./Screen');
const Performance = require('./Performance');
const Crypto = require('./Crypto');
// 【引入】
const {XMLHttpRequest, Headers, FormData} = require('./NetworkMock');

class Window {
    constructor(context, profile = {}) {
        // ... (基础 globals 数组代码保持不变) ...
        const globals = [
            'Object', 'Function', 'Array', 'String', 'Number', 'Boolean', 'RegExp', 'Date', 'Math', 'JSON', 'Promise', 'Symbol', 'Reflect', 'Proxy', 'WeakMap', 'WeakSet', 'Map', 'Set', 'DataView', 'ArrayBuffer',
            'Uint8Array', 'Int8Array', 'Uint16Array', 'Int16Array', 'Uint32Array', 'Int32Array', 'Float32Array', 'Float64Array', 'Uint8ClampedArray',
            'Error', 'TypeError', 'EvalError', 'RangeError', 'ReferenceError', 'SyntaxError', 'URIError',
            'console', 'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'encodeURI', 'decodeURI', 'encodeURIComponent', 'decodeURIComponent', 'escape', 'unescape'
        ];

        globals.forEach(prop => {
            if (context[prop]) this[prop] = context[prop];
        });

        this.window = null; // 占位，由 main.js 注入 proxy
        this.self = null;
        this.globalThis = null;
        this.top = null;
        this.parent = null;
        this.frames = null;

        this.navigator = new Navigator(profile);
        this.clientInformation = this.navigator;
        this.screen = new Screen(profile);
        this.performance = new Performance();
        this.crypto = new Crypto();

        this.document = context.document || null;

        // 【关键】注册 Network 相关类
        this.XMLHttpRequest = XMLHttpRequest;
        this.Headers = Headers;
        this.FormData = FormData;

        // atob / btoa 实现 (保持你上次更新的正确代码)
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
        this.atob = (input) => {
            let str = String(input).replace(/=+$/, '');
            let output = '';
            if (str.length % 4 == 1) throw new Error("'atob' failed: The string to be decoded is not correctly encoded.");
            for (let bc = 0, bs = 0, buffer, i = 0; buffer = str.charAt(i++); ~buffer && (bs = bc % 4 ? bs * 64 + buffer : buffer, bc++ % 4) ? output += String.fromCharCode(255 & bs >> (-2 * bc & 6)) : 0) {
                buffer = chars.indexOf(buffer);
            }
            return output;
        };

        this.btoa = (input) => {
            let str = String(input);
            let output = '';
            for (let block = 0, charCode, i = 0, map = chars; str.charAt(i | 0) || (map = '=', i % 1); output += map.charAt(63 & block >> 8 - i % 1 * 8)) {
                charCode = str.charCodeAt(i += 3 / 4);
                if (charCode > 0xFF) throw new Error("'btoa' failed");
                block = block << 8 | charCode;
            }
            return output;
        };

        this.chrome = {
            runtime: {},
            loadTimes: () => ({}),
            csi: () => ({}),
            app: {isInstalled: false}
        };

        this.history = {
            length: 1, state: null, scrollRestoration: 'auto',
            back: () => {
            }, forward: () => {
            }, go: () => {
            },
            pushState: (state) => {
                this.history.state = state;
            },
            replaceState: (state) => {
                this.history.state = state;
            }
        };

        this.location = {
            href: "https://challenges.cloudflare.com/",
            origin: "https://challenges.cloudflare.com",
            protocol: "https:",
            host: "challenges.cloudflare.com",
            hostname: "challenges.cloudflare.com",
            port: "",
            pathname: "/",
            search: "",
            hash: "",
            reload: () => {
            },
            replace: () => {
            },
            toString: () => "https://challenges.cloudflare.com/"
        };

        const createStorage = () => {
            let data = {};
            return {
                getItem: (k) => data[k] || null,
                setItem: (k, v) => data[k] = String(v),
                removeItem: (k) => delete data[k],
                clear: () => data = {},
                key: (i) => Object.keys(data)[i] || null,
                get length() {
                    return Object.keys(data).length;
                }
            };
        };
        this.localStorage = createStorage();
        this.sessionStorage = createStorage();

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

        // 定时器系统
        this._timerIdCounter = 0;
        this._timers = new Map();

        this.setTimeout = (callback, delay, ...args) => {
            const id = ++this._timerIdCounter;
            const timer = setTimeout(() => {
                try {
                    if (typeof callback === 'string') { /* eval */
                    } else callback.apply(this, args);
                } catch (e) {
                    console.error('[Window] setTimeout callback error:', e);
                } finally {
                    this._timers.delete(id);
                }
            }, delay);
            this._timers.set(id, timer);
            return id;
        };

        this.clearTimeout = (id) => {
            const timer = this._timers.get(id);
            if (timer) {
                clearTimeout(timer);
                this._timers.delete(id);
            }
        };

        this.setInterval = (callback, delay, ...args) => {
            const id = ++this._timerIdCounter;
            const timer = setInterval(() => {
                try {
                    if (typeof callback === 'function') callback.apply(this, args);
                } catch (e) {
                    console.error('[Window] setInterval error:', e);
                }
            }, delay);
            this._timers.set(id, timer);
            return id;
        };

        this.clearInterval = (id) => {
            const timer = this._timers.get(id);
            if (timer) {
                clearInterval(timer);
                this._timers.delete(id);
            }
        };

        this.fetch = () => Promise.resolve({
            ok: true, status: 200, text: () => Promise.resolve(''),
            json: () => Promise.resolve({}), headers: {get: () => null}
        });

        this.Image = class Image {
            constructor() {
                if (context.document && context.document.createElement) return context.document.createElement('img');
                return {};
            }
        };

        this.attachEvent = null;
        this.detachEvent = null;
        this.matchMedia = () => ({
            matches: false, addListener: () => {
            }, removeListener: () => {
            }
        });
        this.getComputedStyle = (el) => el.style || {getPropertyValue: () => ''};
        this.requestAnimationFrame = (cb) => this.setTimeout(cb, 16);
        this.cancelAnimationFrame = (id) => this.clearTimeout(id);
    }

    get document() {
        return this._document;
    }

    set document(val) {
        this._document = val;
    }
}

module.exports = Window;