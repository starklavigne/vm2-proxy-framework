// =============================================================================
// JsdomRunner — node:vm + jsdom 宿主，替代 vm2 + 手搓 DOM。
//
// 状态：脚手架。核心（jsdom 窗口 + navigator/screen/chrome 指纹覆盖 + 真实
//       crypto.subtle + 复用 NetworkPlugin 的 fetch/XHR/cookie/dump）已可冒烟；
//       challenge 专用的外链脚本加载 / 事件注入仍需联机迭代（见 loadExternalScript）。
//
// 为什么换：vm2 已停维护且有逃逸，手搓 DOM 永远在“缺什么补什么”且自相矛盾
//          （比如两套 Navigator）。jsdom 提供自洽的 DOM/CSSOM，止血这类不一致，
//          让 challenge 能跑到底，从而能在 dumps 里看清它到底算了什么。
// =============================================================================
const fs = require('fs');
const Crypto = require('../env/Crypto');
const useNetworkPlugin = require('../plugins/NetworkPlugin');

function tryRequire(name) {
    try {
        return require(name);
    } catch (e) {
        return null;
    }
}

class JsdomRunner {
    constructor(profile, opts = {}) {
        const {JSDOM, VirtualConsole} = require('jsdom'); // 延迟 require，未装时给出清晰报错
        this.profile = profile;
        this.opts = opts;

        // jsdom 会把 timer/事件回调里抛出的异常吞掉，只发到 VirtualConsole 的 'jsdomError'。
        // orchestrate 的 body 组装就在 setTimeout 回调里，这是看见“被吞错误”的唯一窗口。
        const vc = new VirtualConsole();
        vc.sendTo(console, {omitJSDOMErrors: true});
        vc.on('jsdomError', (e) => {
            console.log('[jsdomError]', e && e.message);
            const stack = e && e.detail && e.detail.stack;
            if (stack) console.log(String(stack).split('\n').slice(0, 8).join('\n'));
        });
        this.virtualConsole = vc;

        const url = opts.url || 'https://www.sciencedirect.com/';
        const html = opts.html || '<!DOCTYPE html><html><head></head><body></body></html>';
        this.dom = new JSDOM(html, {
            url,
            referrer: opts.referrer || url,
            contentType: 'text/html',
            pretendToBeVisual: true,
            virtualConsole: vc,
            // 'outside-only'：我们自己 eval challenge 代码；页面里的 <script> 不自动跑，
            // 由 loadExternalScript 受控抓取+执行（复用 cookieJar，便于 dump 对账）。
            runScripts: 'outside-only',
        });
        this.window = this.dom.window;
        this.applyEnv();
    }

    applyEnv() {
        const window = this.window;
        const profile = this.profile;
        const define = (obj, key, value) => {
            try {
                Object.defineProperty(obj, key, {get: () => value, configurable: true});
            } catch (e) { /* 只读且不可配置，跳过 */ }
        };

        // --- navigator 指纹覆盖（jsdom navigator 大多只读，用 getter 覆盖）---
        const nav = window.navigator;
        const navProps = {
            userAgent: profile.userAgent,
            appVersion: profile.userAgent.replace('Mozilla/', ''),
            platform: profile.platform || 'Win32',
            language: profile.language || 'zh-CN',
            languages: Object.freeze(['zh-CN', 'zh', 'en-US', 'en']),
            hardwareConcurrency: profile.hardwareConcurrency || 8,
            deviceMemory: 8,
            maxTouchPoints: 0,
            webdriver: false,
            vendor: 'Google Inc.',
            pdfViewerEnabled: true,
        };
        for (const [k, v] of Object.entries(navProps)) define(nav, k, v);

        // --- screen / 视口 ---
        const sw = profile.screenWidth || 1920;
        const sh = profile.screenHeight || 1080;
        define(window.screen, 'width', sw);
        define(window.screen, 'height', sh);
        define(window.screen, 'availWidth', sw);
        define(window.screen, 'availHeight', sh - 40);
        define(window.screen, 'colorDepth', 24);
        define(window.screen, 'pixelDepth', 24);
        try { window.innerWidth = sw; window.innerHeight = sh; } catch (e) {}
        try { window.outerWidth = sw; window.outerHeight = sh; } catch (e) {}
        try { window.devicePixelRatio = 1; } catch (e) {}

        // --- chrome 对象（Chrome 必有）---
        window.chrome = {runtime: {}, app: {isInstalled: false}, csi: () => ({}), loadTimes: () => ({})};

        // --- 真实 crypto（subtle 接 Node webcrypto，不再是全 0）---
        try {
            Object.defineProperty(window, 'crypto', {value: new Crypto(), configurable: true});
        } catch (e) {
            window.crypto = new Crypto();
        }

        // jsdom 的 window realm 不带 TextEncoder/TextDecoder，而 challenge 必用它们。
        const {TextEncoder, TextDecoder} = require('util');
        if (!window.TextEncoder) window.TextEncoder = TextEncoder;
        if (!window.TextDecoder) window.TextDecoder = TextDecoder;

        // --- 复用 NetworkPlugin：给 window 装 fetch/XMLHttpRequest + cookieJar + dump ---
        // 注意 jsdom 里 window 同时充当 context 和 rawWindow。
        useNetworkPlugin(window, window, profile, {dumpDir: this.opts.dumpDir});

        // --- 真实指纹后端（native，装不上就退回 jsdom/stub）---
        this.installCanvasBackend();
        this.installWebGLBackend();
        this.installAudioBackend();

        // --- Web Worker shim：jsdom 不实现 Worker，而 orchestrate 把 PoW/指纹
        //     offload 到 `new Worker(URL.createObjectURL(new Blob([src])))` 并 await
        //     worker.onmessage 才发 ov1。没有 Worker → 那个 await 永不返回 → ov1 只 open 不 send。---
        this.installWorkerShim();

        // --- 补 jsdom 缺失但真 Chrome 必有的构造器（CF 指纹会读它们的 .prototype）---
        this.installMissingConstructors();
    }

    installMissingConstructors() {
        const window = this.window;
        const {nativize} = require('../utils/tools');
        const def = (name, ctor) => {
            if (typeof window[name] !== 'undefined') return false;
            window[name] = nativize(ctor, name);
            return true;
        };
        const added = [];

        // 1) 纯指纹用构造器：不抛、有 .prototype 即可（真 Chrome 都有，补上是靠近不是偏离）
        const benign = [
            'OffscreenCanvas', 'OffscreenCanvasRenderingContext2D',
            'WebGLRenderingContext', 'WebGL2RenderingContext', 'WebGLProgram', 'WebGLShader',
            'WebGLBuffer', 'WebGLFramebuffer', 'WebGLRenderbuffer', 'WebGLTexture', 'WebGLUniformLocation',
            'Animation', 'RTCPeerConnection', 'RTCDataChannel', 'RTCRtpSender',
            'MediaSource', 'MediaRecorder', 'MediaStream', 'Notification',
            'BroadcastChannel', 'PointerEvent', 'Touch', 'TouchEvent',
            'FontFace', 'TextMetrics', 'Path2D', 'ImageBitmap', 'VisualViewport',
            'GamepadEvent', 'DeviceMotionEvent', 'DeviceOrientationEvent',
        ];
        for (const name of benign) {
            if (def(name, function () {})) added.push(name);
        }

        // 2) 功能型 Observer：可能被 new+observe，给 no-op 实现而非抛错
        const observer = (name) => def(name, class {
            constructor(cb) { this._cb = cb; }
            observe() {}
            unobserve() {}
            disconnect() {}
            takeRecords() { return []; }
        });
        ['IntersectionObserver', 'ResizeObserver', 'PerformanceObserver', 'ReportingObserver'].forEach((n) => { if (observer(n)) added.push(n); });

        // 3) ReadableStream stub（故意无 prototype.pipeTo）+ BigInt
        //
        // 设计要点：zJ() 做多项检测，其中一项是 ReadableStream.prototype.pipeTo !== undefined。
        //   - 若我们用真实 Node.js ReadableStream（有 pipeTo）→ zJ 返回 false（不是 bot）
        //     → zg non-bot 路径 → gWHLX 首次为 false → 直接 return → ov1 XHR 永不触发。
        //   - 若提供无 pipeTo 的 stub → zJ 检测 pipeTo===undefined → 返回 true（bot 路径）
        //     → zg bot 分支调 HOFt5(error_info) → ov1 XHR 触发 ✓
        //
        // ReadableStream 必须存在（否则 zJ 读 prototype 时直接崩溃而非走检测链），
        // 只是 prototype.pipeTo 不定义，让检测返回 true 走已知路径。
        if (def('ReadableStream', function ReadableStream(source) {
            if (source && typeof source.start === 'function') {
                const ctrl = { enqueue() {}, close() {}, error() {}, desiredSize: 1 };
                try { source.start(ctrl); } catch (e) {}
            }
        })) added.push('ReadableStream');
        // WritableStream / TransformStream 作为 no-op stub（CF 不检测 pipeTo 以外的方法）
        if (def('WritableStream', function WritableStream() {})) added.push('WritableStream');
        if (def('TransformStream', function TransformStream() {})) added.push('TransformStream');
        // BigInt 是 Node.js 全局，但 jsdom window 不一定暴露
        if (typeof BigInt === 'function' && def('BigInt', BigInt)) added.push('BigInt');

        // 4) ImageData 需要可 new（canvas getImageData 也返回它）
        if (def('ImageData', class ImageData {
            constructor(a, b, c) {
                if (a && a.length !== undefined) { this.data = a; this.width = b; this.height = c || (b ? a.length / 4 / b : 0); }
                else { this.width = a || 0; this.height = b || 0; this.data = new Uint8ClampedArray((a || 0) * (b || 0) * 4); }
            }
        })) added.push('ImageData');

        if (added.length) console.log(`[jsdom] 补构造器 ${added.length} 个: ${added.slice(0, 8).join(', ')}${added.length > 8 ? '…' : ''}`);
    }

    installWorkerShim() {
        const window = this.window;
        const {TextEncoder, TextDecoder} = require('util');
        const reg = new Map();
        const blobSrc = new WeakMap();
        let seq = 0;

        // 在 new Blob([src]) 时同步抓取字符串源（worker 源就是字符串），
        // 避免依赖 jsdom Blob 的异步 .text()。保留原型，instanceof Blob 仍成立。
        try {
            const NativeBlob = window.Blob;
            if (NativeBlob && !NativeBlob.__cfWrapped) {
                const PatchedBlob = function Blob(parts, options) {
                    const b = new NativeBlob(parts || [], options);
                    try {
                        const src = (parts || []).map((p) => (typeof p === 'string' ? p : '')).join('');
                        if (src) blobSrc.set(b, src);
                    } catch (e) {}
                    return b;
                };
                PatchedBlob.prototype = NativeBlob.prototype;
                PatchedBlob.__cfWrapped = true;
                window.Blob = PatchedBlob;
            }
        } catch (e) {
            console.log('[Worker shim] 包装 Blob 失败:', e.message);
        }

        // Blob URL 注册表：createObjectURL 存 blob，Worker 启动时取回源码
        try {
            window.URL.createObjectURL = (obj) => {
                const id = `blob:${window.location.origin}/cfw-${++seq}`;
                reg.set(id, obj);
                return id;
            };
            window.URL.revokeObjectURL = (id) => { reg.delete(id); };
            if (window.webkitURL) { window.webkitURL.createObjectURL = window.URL.createObjectURL; }
        } catch (e) {
            console.log('[Worker shim] 覆盖 createObjectURL 失败:', e.message);
        }

        const hostWindow = window;

        class CFWorker {
            constructor(url) {
                this.onmessage = null;
                this.onerror = null;
                this.onmessageerror = null;
                this._toWorker = [];
                this._ready = false;
                this._scope = null;
                this._listeners = [];
                const blob = reg.get(String(url));
                const boot = (src) => this._boot(String(src || ''));
                const sync = blob && blobSrc.get(blob);
                if (sync) {
                    boot(sync);
                } else if (blob && typeof blob.text === 'function') {
                    blob.text().then(boot).catch((e) => this._emitError(e));
                } else if (typeof url === 'string' && url.startsWith('data:')) {
                    try { boot(decodeURIComponent(url.slice(url.indexOf(',') + 1))); }
                    catch (e) { this._emitError(e); }
                } else {
                    this._emitError(new Error('Worker: 找不到源 ' + url));
                }
            }

            _boot(src) {
                const worker = this;
                const scope = {
                    onmessage: null,
                    onerror: null,
                    // worker → 主线程
                    postMessage(data) {
                        const ev = {data, type: 'message'};
                        setTimeout(() => { if (typeof worker.onmessage === 'function') { try { worker.onmessage(ev); } catch (e) {} } }, 0);
                    },
                    addEventListener(t, f) { if (t === 'message' && typeof f === 'function') worker._listeners.push(f); },
                    removeEventListener() {},
                    importScripts() {},
                    close() { worker._ready = false; },
                    crypto: hostWindow.crypto,
                    TextEncoder, TextDecoder,
                    atob: (s) => Buffer.from(String(s), 'base64').toString('binary'),
                    btoa: (s) => Buffer.from(String(s), 'binary').toString('base64'),
                    setTimeout, clearTimeout, setInterval, clearInterval,
                    Math, JSON, Date, Promise, Array, Object, String, Number,
                    Uint8Array, Int8Array, Uint16Array, Int16Array, Uint32Array, Int32Array,
                    Float32Array, Float64Array, Uint8ClampedArray, ArrayBuffer, DataView,
                    parseInt, parseFloat, isNaN, isFinite,
                };
                scope.self = scope;
                scope.globalThis = scope;
                try {
                    // worker 源在 host realm 跑（自包含 math/crypto，无 window/document）
                    const fn = new Function('self', `with(self){ ${src}\n }`);
                    fn(scope);
                } catch (e) {
                    this._emitError(e);
                    return;
                }
                this._scope = scope;
                this._ready = true;
                const q = this._toWorker; this._toWorker = [];
                q.forEach((d) => this._deliverToWorker(d));
            }

            _deliverToWorker(data) {
                if (!this._scope) return;
                const ev = {data, type: 'message'};
                if (typeof this._scope.onmessage === 'function') { try { this._scope.onmessage(ev); } catch (e) { this._emitError(e); } }
                this._listeners.forEach((f) => { try { f(ev); } catch (e) {} });
            }

            postMessage(data) {
                if (this._ready) this._deliverToWorker(data);
                else this._toWorker.push(data);
            }

            terminate() { this._ready = false; this._scope = null; }
            addEventListener(t, f) { if (t === 'message') this.onmessage = f; else if (t === 'error') this.onerror = f; }
            removeEventListener() {}
            _emitError(e) {
                console.log('[Worker shim] worker 源执行错误:', e && e.message);
                if (typeof this.onerror === 'function') { try { this.onerror({message: e && e.message, error: e}); } catch (e2) {} }
            }
        }

        window.Worker = CFWorker;
        console.log('[jsdom] Worker shim 已装（同实例 postMessage 桥接 + 真实 crypto）');
    }

    installCanvasBackend() {
        const canvasLib = tryRequire('canvas');
        if (!canvasLib || typeof canvasLib.createCanvas !== 'function') {
            console.log('[jsdom] canvas 未就绪 → Canvas2D 退回 jsdom stub（canvas 指纹不真）');
            return;
        }
        const window = this.window;
        const proto = window.HTMLCanvasElement && window.HTMLCanvasElement.prototype;
        if (!proto) return;
        // 用 node-canvas 后端真渲染：getContext('2d') / toDataURL 走 Cairo。
        // 注意 Cairo≠Skia，hash 不会等于真 Chrome，但是真实、稳定、自洽的值。
        const backing = new WeakMap();
        const ensure = (el) => {
            let c = backing.get(el);
            if (!c) {
                c = canvasLib.createCanvas(Number(el.width) || 300, Number(el.height) || 150);
                backing.set(el, c);
            }
            return c;
        };
        proto.getContext = function (type, ...rest) {
            if (type === '2d') return ensure(this).getContext('2d', ...rest);
            return null; // WebGL 走 installWebGLBackend
        };
        proto.toDataURL = function (...args) { return ensure(this).toDataURL(...args); };
        console.log('[jsdom] Canvas2D 后端: node-canvas (Cairo)');
    }

    installWebGLBackend() {
        const glLib = tryRequire('gl');
        if (typeof glLib !== 'function') {
            console.log('[jsdom] gl 未就绪 → WebGL 退回 stub（WebGL 指纹不真）');
            return;
        }
        const window = this.window;
        const proto = window.HTMLCanvasElement && window.HTMLCanvasElement.prototype;
        if (!proto) return;
        const prevGetContext = proto.getContext;
        proto.getContext = function (type, ...rest) {
            if (type === 'webgl' || type === 'experimental-webgl' || type === 'webgl2') {
                return glLib(Number(this.width) || 300, Number(this.height) || 150, {preserveDrawingBuffer: true});
            }
            return prevGetContext ? prevGetContext.call(this, type, ...rest) : null;
        };
        console.log('[jsdom] WebGL 后端: headless-gl');
    }

    installAudioBackend() {
        const audioLib = tryRequire('web-audio-api');
        if (!audioLib || !audioLib.AudioContext) {
            console.log('[jsdom] web-audio-api 未就绪 → AudioContext 退回 stub（audio 指纹不真）');
            return;
        }
        this.window.AudioContext = audioLib.AudioContext;
        this.window.webkitAudioContext = audioLib.AudioContext;
        console.log('[jsdom] AudioContext 后端: web-audio-api');
    }

    // 在 jsdom 窗口上下文里执行一段代码
    run(code) {
        return this.window.eval(String(code));
    }

    runFile(filePath) {
        return this.run(fs.readFileSync(filePath, 'utf8'));
    }

    // -------------------------------------------------------------------------
    // challenge 驱动用的 DOM 管道（策略留在 main.jsdom.js，这里只做 DOM 接线）
    // -------------------------------------------------------------------------

    // 拦截 <script src=...> 的插入。jsdom runScripts:'outside-only' 不会自动拉外链脚本，
    // 由回调去 fetch+eval（复用 cookieJar，便于 dump 对账）。
    hookScriptInsertion(onScript) {
        const Node = this.window.Node;
        const wrap = (name) => {
            const orig = Node.prototype[name];
            if (!orig || orig.__cfHooked) return;
            const hooked = function (node, ...rest) {
                const ret = orig.call(this, node, ...rest);
                try {
                    const isScript = node && node.tagName === 'SCRIPT' &&
                        (node.src || (node.getAttribute && node.getAttribute('src')));
                    if (isScript) onScript(node);
                } catch (e) { /* 不要因为观察逻辑影响主流程 */ }
                return ret;
            };
            hooked.__cfHooked = true;
            Node.prototype[name] = hooked;
        };
        wrap('appendChild');
        wrap('insertBefore');
    }

    // orchestrate 脚本常读 document.currentScript.src 解析自己的 ray；eval 执行时
    // jsdom 的 currentScript 是 null，这里允许在执行外链脚本期间临时指定。
    setCurrentScript(el) {
        try {
            Object.defineProperty(this.window.document, 'currentScript', {
                value: el || null, configurable: true,
            });
        } catch (e) { /* 不可配置就算了 */ }
    }

    // 把 cfCookies.json 形态的 cookie 灌进 jsdom（供 document.cookie 读）和
    // 我们自己的 cookieJar（供 NetworkPlugin 出网带上）。
    loadCookies(cookies, cookieJar) {
        if (!Array.isArray(cookies)) return 0;
        const url = this.window.location.href;
        let n = 0;
        for (const c of cookies) {
            if (!c || !c.name) continue;
            const value = c.value || '';
            try { this.dom.cookieJar.setCookieSync(`${c.name}=${value}; Path=/`, url, {ignoreError: true}); } catch (e) {}
            if (cookieJar && cookieJar.cookies) cookieJar.cookies.set(c.name, value);
            n++;
        }
        return n;
    }
}

module.exports = JsdomRunner;
