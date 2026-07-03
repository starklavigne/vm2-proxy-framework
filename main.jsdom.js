// =============================================================================
// main.jsdom.js — 用 JsdomRunner（node:vm + jsdom）驱动 CF challenge。
//
// 分层（沿用项目理念：Runner=环境，Main=唯一耦合点/编排）：
//   JsdomRunner  提供 jsdom 宿主 + 指纹覆盖 + 真实 crypto + 网络复用 + DOM 管道
//   本文件       负责编排：注入 _cf_chl_opt、预载 cookie、外链脚本加载、事件注入、监听 cf_clearance
//
// 与旧 vm2 main.js 的区别：不再需要 ProxyFactory / 手搓 DOM。DOM 由 jsdom 提供（自洽）。
//
// 联机才能验证的部分：target.js 里 XHR→/flow/ov1、turnstile 外链都要真出网；
// 本机沙箱到不了 CF，所以这里跑到“网络边界”就停，但能证明环境/管道已就位。
// =============================================================================
const path = require('path');
const fs = require('fs');
const {URL} = require('url');
const {fetchScript} = require('./src/utils/httpFetchScript');
const JsdomRunner = require('./src/runner/JsdomRunner');
const profile = require('./src/config/browserProfile');
const cfConfig = require('./src/config/cfConfig');
const {cookieJar} = require('./src/utils/tools');

const VERBOSE = process.env.JSDOM_VERBOSE === '1';

// ---- dump 目录 ----
const dumpDir = process.env.CHALLENGE_DUMP_DIR || path.resolve(__dirname, 'dumps/vm');
if (process.env.CLEAR_DUMP_DIR !== '0') {
    try { fs.rmSync(dumpDir, {recursive: true, force: true}); } catch (e) {}
}
console.log(`[Dump] CF challenge dump dir: ${dumpDir}`);

// ---- URL / zone ----
const zone = String(cfConfig.cZone || 'www.sciencedirect.com').replace(/^https?:\/\//, '').replace(/\/$/, '');
const targetUrl = cfConfig.cUPMDTk ? `https://${zone}${cfConfig.cUPMDTk}` : `https://${zone}/`;

// ---- challenge.html 作为初始 DOM（capture 脚本会写出）----
const htmlPath = path.join(__dirname, 'target/challenge.html');
const html = fs.existsSync(htmlPath) ? fs.readFileSync(htmlPath, 'utf8') : undefined;
if (!html) console.log('[jsdom] 警告：target/challenge.html 不存在，用空白 DOM（建议先跑 capture_challenge_playwright.py）');

const runner = new JsdomRunner(profile, {url: targetUrl, referrer: targetUrl, html, dumpDir});
const window = runner.window;

// ---- 预载 cookie（跳过旧 cf_clearance，以便监听本轮新值）----
try {
    const cookiePath = path.join(__dirname, 'src/config/cfCookies.json');
    if (fs.existsSync(cookiePath) && process.env.SKIP_COOKIES !== '1') {
        const all = JSON.parse(fs.readFileSync(cookiePath, 'utf8'));
        const usable = all.filter(c => c && c.name && c.name !== 'cf_clearance');
        const n = runner.loadCookies(usable, cookieJar);
        console.log(`[Cookie] 预载 ${n} 个（跳过 cf_clearance）: ${usable.map(c => c.name).join(', ')}`);
    }
} catch (e) {
    console.log('[Cookie] 预载失败:', e.message);
}

// ---- 注入 _cf_chl_opt（jsdom 不需要 ProxyFactory，直接挂普通对象）----
const ogUrl = new URL(targetUrl);
ogUrl.searchParams.delete('__cf_chl_tk');
ogUrl.searchParams.delete('__cf_chl_f_tk');
window._cf_chl_opt = window.__cf_chl_opt = Object.assign({}, cfConfig, {
    cOgUQuery: ogUrl.search || '',
    cOgUHash: ogUrl.hash || '',
});

// =============================================================================
// 外链 <script> 加载器
// =============================================================================
const orchestratePattern = /cdn-cgi\/challenge-platform\/.*orchestrate\/chl_page/;
const isTurnstile = (u) => /challenges\.cloudflare\.com\/turnstile\//.test(String(u || ''));
const loaded = new Set();

const triggerOnload = (el, url) => {
    if (el && typeof el.onload === 'function') { try { el.onload(); } catch (e) {} }
    const m = String(url || '').match(/[?&]onload=([^&]+)/);
    if (!m) return;
    const cbName = decodeURIComponent(m[1]);
    const cb = window[cbName];
    console.log(`[jsdom] turnstile onload 回调 ${cbName}: ${typeof cb}`);
    if (typeof cb === 'function') { try { cb(); } catch (e) { console.log('  回调错误:', e.message); } }
};

const loadExternalScript = (el) => {
    const src = el && (el.src || (el.getAttribute && el.getAttribute('src')));
    if (!src || loaded.has(src)) return;
    // orchestrate 脚本就是本地 target.js，已经直接 run 过了，跳过网络加载
    if (orchestratePattern.test(src)) {
        if (VERBOSE) console.log('[jsdom] 跳过 orchestrate（已本地执行）:', src.slice(0, 80));
        triggerOnload(el, src);
        return;
    }
    loaded.add(src);
    const finalUrl = src.startsWith('/') ? `https://${zone}${src}` : src;
    console.log('[jsdom] 加载外链脚本:', finalUrl.slice(0, 100));
    // Chrome 请求跨源 script 时的头部；对 challenges.cloudflare.com/turnstile/v0/ 尤其重要，
    // 缺 Origin/Sec-Fetch-* 时可能被边缘策略拒绝或走到降级路径。
    const crossSite = !finalUrl.startsWith(`https://${zone}`);
    const scriptHeaders = {
        'User-Agent': profile.userAgent,
        'Referer': window.location.href,
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Sec-Fetch-Dest': 'script',
        'Sec-Fetch-Mode': 'no-cors',
        'Sec-Fetch-Site': crossSite ? 'cross-site' : 'same-origin',
    };
    if (crossSite) scriptHeaders['Origin'] = `https://${zone}`;
    fetchScript(finalUrl, {
        headers: scriptHeaders,
        cookieJar,
        timeout: 15000,
    }).then((resp) => {
        const {status, body: text} = resp;
        if (status < 200 || status >= 300) {
            console.log(`[jsdom] 脚本响应 ${status} → 跳过执行: ${finalUrl.slice(0, 70)}`);
            if (isTurnstile(finalUrl)) triggerOnload(el, finalUrl); // 让流程继续
            else if (el.onerror) { try { el.onerror(); } catch (e) {} }
            return;
        }
        console.log(`[jsdom] 执行 ${text.length} 字节: ${finalUrl.slice(0, 70)}${resp.url !== finalUrl ? ` → ${resp.url.slice(-60)}` : ''}`);
        runner.setCurrentScript(el);
        try {
            runner.run(text);
        } catch (e) {
            console.log('[jsdom] 外链脚本执行错误:', e.message);
            if (e.stack && VERBOSE) console.log(String(e.stack).split('\n').slice(0, 6).join('\n'));
        } finally {
            runner.setCurrentScript(null);
        }
        triggerOnload(el, finalUrl);
        // === 诊断：turnstile.render 追踪 ===
        if (isTurnstile(finalUrl) && window.turnstile && typeof window.turnstile.render === 'function' && !window.turnstile._renderPatched) {
            const origRender = window.turnstile.render;
            window.turnstile.render = function (el, opts) {
                console.log('[turnstile] render() 被调用');
                console.log('  sitekey:', opts && opts.sitekey);
                console.log('  callback:', opts && typeof opts.callback);
                console.log('  opts keys:', opts && Object.keys(opts).join(', '));
                // 如果有 callback，模拟 Turnstile 即时成功（返回假 token）
                const widgetId = origRender.apply(this, arguments);
                console.log('  widgetId:', widgetId);
                return widgetId;
            };
            window.turnstile._renderPatched = true;
            console.log('[jsdom] turnstile.render 已追踪');
        }
    }).catch((err) => {
        console.log('[jsdom] 脚本网络错误:', err.message, '—', finalUrl.slice(0, 70));
        if (isTurnstile(finalUrl)) triggerOnload(el, finalUrl);
        else if (el.onerror) { try { el.onerror(); } catch (e) {} }
    });
};

runner.hookScriptInsertion((el) => setImmediate(() => loadExternalScript(el)));

// =============================================================================
// Turnstile iframe 拦截器
//
// Turnstile api.js 在 render() 时创建 <iframe src="challenges.cloudflare.com/cdn-cgi/
// challenge-platform/.../turnstile/f/av0/..."> 并 appendChild 到 DOM。
// 在真浏览器里这个 iframe 加载一个 ~240KB 的 HTML 页面，运行 PoW + 指纹后通过
// parent.postMessage 把 token 返回给 api.js 的 message listener。
//
// jsdom 不会自动导航 iframe。这里我们：
//   1) MutationObserver 监听 <iframe> 插入 DOM
//   2) 检测 src 指向 challenges.cloudflare.com turnstile
//   3) 出网抓取 iframe HTML，提取内联 <script>
//   4) 在当前 window 环境里 eval（相当于同源内联执行）
//   5) iframe 脚本里的 parent.postMessage 等效于 window.postMessage → api.js 收到
// =============================================================================
{
    const isTurnstileIframe = (src) => /challenges\.cloudflare\.com\/.*turnstile/.test(String(src || ''));
    const turnstileIframeLoaded = new Set();

    const handleIframeInsert = (iframe) => {
        const src = iframe.getAttribute && iframe.getAttribute('src');
        if (!src || !isTurnstileIframe(src) || turnstileIframeLoaded.has(src)) return;
        turnstileIframeLoaded.add(src);
        console.log('[jsdom][turnstile-iframe] 检测到 iframe:', src.slice(0, 120));

        // 出网抓 iframe HTML
        const iframeHeaders = {
            'User-Agent': profile.userAgent,
            'Referer': 'https://challenges.cloudflare.com/',
            'Sec-Fetch-Dest': 'iframe',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'same-origin',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        };
        fetchScript(src, {headers: iframeHeaders, cookieJar, timeout: 20000})
            .then((resp) => {
                if (resp.status < 200 || resp.status >= 300) {
                    console.log(`[jsdom][turnstile-iframe] 响应 ${resp.status} 跳过`);
                    return;
                }
                const html = resp.body;
                console.log(`[jsdom][turnstile-iframe] 抓到 ${html.length} 字节`);
                // 提取内联 script
                const scriptMatch = html.match(/<script[^>]*>([\s\S]+?)<\/script>/);
                if (!scriptMatch) {
                    console.log('[jsdom][turnstile-iframe] 未找到内联 script');
                    return;
                }
                const scriptBody = scriptMatch[1];
                console.log(`[jsdom][turnstile-iframe] 执行 ${scriptBody.length} 字节脚本（独立 iframe DOM）`);

                // ——————————————————————————————————————————————————————————————
                // 创建独立 jsdom 实例，模拟 Turnstile iframe 的自有 document。
                // 这样 iframe 脚本里的 document.body.appendChild / querySelector 都
                // 作用在自己的 DOM 上，不会踩到父 window.document。
                // parent.postMessage → 桥接到父 window 的 message event（api.js 在那里监听）。
                // ——————————————————————————————————————————————————————————————
                try {
                    const {JSDOM, VirtualConsole} = require('jsdom');
                    const iframeVc = new VirtualConsole();
                    iframeVc.sendTo(console, {omitJSDOMErrors: true});
                    iframeVc.on('jsdomError', (e) => {
                        console.log('[iframe-jsdomError]', e && e.message);
                        if (e && e.detail && e.detail.stack) console.log(String(e.detail.stack).split('\n').slice(0, 5).join('\n'));
                    });

                    // 用抓到的完整 HTML 初始化 iframe DOM（含 <style>、<body>）
                    const iframeHtmlNoScript = html.replace(/<script[^>]*>[\s\S]+?<\/script>/, '');
                    const iframeDom = new JSDOM(iframeHtmlNoScript, {
                        url: src,
                        referrer: 'https://challenges.cloudflare.com/',
                        contentType: 'text/html',
                        pretendToBeVisual: true,
                        virtualConsole: iframeVc,
                        runScripts: 'outside-only',
                    });
                    const iframeWindow = iframeDom.window;

                    // --- 给 iframe window 装上必要的全局 ---
                    const {TextEncoder, TextDecoder} = require('util');
                    if (!iframeWindow.TextEncoder) iframeWindow.TextEncoder = TextEncoder;
                    if (!iframeWindow.TextDecoder) iframeWindow.TextDecoder = TextDecoder;

                    // crypto（iframe 里的 PoW 需要 crypto.subtle）
                    const Crypto = require('./src/env/Crypto');
                    try {
                        Object.defineProperty(iframeWindow, 'crypto', {value: new Crypto(), configurable: true});
                    } catch (e) { iframeWindow.crypto = new Crypto(); }

                    // NetworkPlugin：让 iframe 内的 fetch/XHR 也走我们的真实网络
                    const useNetworkPlugin = require('./src/plugins/NetworkPlugin');
                    useNetworkPlugin(iframeWindow, iframeWindow, profile, {dumpDir: null});

                    // parent = 父 window（api.js 在父 window 上注册 message listener）
                    // iframe 脚本通过 parent.postMessage(data, '*') 发 token 回去
                    iframeWindow.parent = window;
                    iframeWindow.top = window;

                    // 从 iframe src URL 解析 origin
                    const iframeOrigin = (() => { try { return new URL(src).origin; } catch(e) { return 'https://challenges.cloudflare.com'; } })();
                    // 额外：让 iframe 内 postMessage 能触达父 window 的 listener
                    // jsdom 的 postMessage 只派给同 window 的 listener，需显式桥接
                    const origIframePostMessage = iframeWindow.postMessage;
                    iframeWindow.postMessage = function(data, targetOrigin) {
                        // 也在自身 dispatch（某些内部逻辑可能自发自收）
                        if (origIframePostMessage) {
                            try { origIframePostMessage.call(iframeWindow, data, targetOrigin || '*'); } catch(e) {}
                        }
                    };

                    // parent.postMessage bridge: 让 iframe 脚本执行 `parent.postMessage(msg, '*')` 时
                    // 真正派发到父 window 的 message listeners
                    // 由于 iframeWindow.parent = window，调用 parent.postMessage 就是 window.postMessage
                    // jsdom 的 window.postMessage 会自动 dispatch MessageEvent — 应该可以工作。
                    // 但需确保 event.origin 正确（应为 iframe 的 origin）。
                    // 包装一层：
                    const realParentPM = window.postMessage.bind(window);
                    const parentPMProxy = function(data, targetOrigin) {
                        // 直接在父 window 上 dispatch MessageEvent，origin 设为 iframe origin
                        try {
                            const MessageEvent = window.MessageEvent || window.Event;
                            const evt = new MessageEvent('message', {
                                data: data,
                                origin: iframeOrigin,
                                source: iframeWindow,
                            });
                            window.dispatchEvent(evt);
                        } catch (e) {
                            // fallback: 用 jsdom 原生 postMessage
                            try { realParentPM(data, targetOrigin || '*'); } catch(e2) {}
                        }
                    };
                    // 让 iframe 里 parent.postMessage 指向我们的 bridge
                    const parentProxy = {
                        postMessage: parentPMProxy,
                        window: window,
                        document: window.document,
                        location: window.location,
                        navigator: window.navigator,
                        // Turnstile 可能检查 parent === top
                        get parent() { return parentProxy; },
                        get top() { return parentProxy; },
                    };
                    try {
                        Object.defineProperty(iframeWindow, 'parent', {
                            get() { return parentProxy; },
                            configurable: true,
                        });
                    } catch (e) {
                        try { iframeWindow.parent = parentProxy; } catch(e2) {}
                    }
                    try {
                        Object.defineProperty(iframeWindow, 'top', {
                            get() { return parentProxy; },
                            configurable: true,
                        });
                    } catch (e) {
                        try { iframeWindow.top = parentProxy; } catch(e2) {}
                    }

                    // Worker shim（iframe 脚本可能有 PoW worker）
                    if (typeof iframeWindow.Worker === 'undefined') {
                        const blobSrc = new WeakMap();
                        const NativeBlob = iframeWindow.Blob;
                        if (NativeBlob) {
                            const PatchedBlob = function Blob(parts, options) {
                                const b = new NativeBlob(parts || [], options);
                                try { const s = (parts||[]).map(p => typeof p==='string'?p:'').join(''); if(s) blobSrc.set(b,s); } catch(e){}
                                return b;
                            };
                            PatchedBlob.prototype = NativeBlob.prototype;
                            iframeWindow.Blob = PatchedBlob;
                        }
                        iframeWindow.URL = iframeWindow.URL || {createObjectURL: () => 'blob:null', revokeObjectURL: () => {}};
                        const origCreateObjectURL = iframeWindow.URL.createObjectURL;
                        const blobUrls = new Map();
                        iframeWindow.URL.createObjectURL = function(blob) {
                            const u = 'blob:iframe-' + Math.random().toString(36).slice(2);
                            if (blobSrc && blobSrc.has(blob)) blobUrls.set(u, blobSrc.get(blob));
                            return u;
                        };
                        iframeWindow.URL.revokeObjectURL = function() {};
                        iframeWindow.Worker = class Worker {
                            constructor(urlOrBlob) {
                                this._src = blobUrls.get(urlOrBlob) || '';
                                this.onmessage = null;
                                this.onerror = null;
                            }
                            postMessage(data) {
                                if (!this._src) return;
                                setImmediate(() => {
                                    try {
                                        const vm = require('vm');
                                        const workerGlobal = {
                                            self: {}, postMessage: (d) => { if(this.onmessage) this.onmessage({data:d}); },
                                            crypto: require('crypto').webcrypto || require('crypto'),
                                            TextEncoder, TextDecoder,
                                            setTimeout, setInterval, clearTimeout, clearInterval,
                                            console,
                                        };
                                        workerGlobal.self = workerGlobal;
                                        vm.runInNewContext(this._src, workerGlobal, {timeout: 15000});
                                        if (workerGlobal.onmessage) workerGlobal.onmessage({data});
                                    } catch(e) {
                                        console.log('[iframe-worker] error:', e.message);
                                        if (this.onerror) this.onerror(e);
                                    }
                                });
                            }
                            terminate() {}
                            addEventListener(ev, fn) { if(ev==='message') this.onmessage=fn; if(ev==='error') this.onerror=fn; }
                            removeEventListener() {}
                        };
                    }

                    // --- iframe 缺失构造器补丁 ---
                    // Turnstile iframe 脚本依赖很多 Web API 构造器；jsdom 不提供的需要补全。
                    const {nativize} = require('./src/utils/tools');
                    const iDef = (name, ctor) => {
                        if (typeof iframeWindow[name] !== 'undefined') return;
                        iframeWindow[name] = nativize(ctor || function(){}, name);
                    };
                    // MessageChannel 是 Turnstile PoW 通信常用
                    if (typeof iframeWindow.MessageChannel === 'undefined') {
                        iframeWindow.MessageChannel = class MessageChannel {
                            constructor() {
                                const self = this;
                                this.port1 = {postMessage(d) { if(self.port2.onmessage) setImmediate(()=>self.port2.onmessage({data:d})); }, onmessage:null, close(){}, start(){}, addEventListener(e,fn){if(e==='message')this.onmessage=fn;}, removeEventListener(){}};
                                this.port2 = {postMessage(d) { if(self.port1.onmessage) setImmediate(()=>self.port1.onmessage({data:d})); }, onmessage:null, close(){}, start(){}, addEventListener(e,fn){if(e==='message')this.onmessage=fn;}, removeEventListener(){}};
                            }
                        };
                    }
                    // AbortController / AbortSignal
                    if (typeof iframeWindow.AbortController === 'undefined') {
                        iframeWindow.AbortSignal = nativize(class AbortSignal { constructor(){this.aborted=false;this.reason=undefined;this.onabort=null;} addEventListener(){} removeEventListener(){} }, 'AbortSignal');
                        iframeWindow.AbortController = nativize(class AbortController { constructor(){this.signal=new iframeWindow.AbortSignal();} abort(r){this.signal.aborted=true;this.signal.reason=r;} }, 'AbortController');
                    }
                    // ReadableStream（同父 window 的策略）
                    if (typeof iframeWindow.ReadableStream === 'undefined') {
                        iframeWindow.ReadableStream = nativize(function ReadableStream(source) {
                            if (source && typeof source.start === 'function') {
                                const ctrl = {enqueue(){},close(){},error(){},desiredSize:1};
                                try { source.start(ctrl); } catch(e) {}
                            }
                        }, 'ReadableStream');
                    }
                    try {
                        const RS = iframeWindow.ReadableStream;
                        if (RS && RS.prototype) {
                            if (typeof RS.prototype.pipeTo !== 'function') RS.prototype.pipeTo = function(){ return Promise.resolve(); };
                            if (typeof RS.prototype.pipeThrough !== 'function') RS.prototype.pipeThrough = function(t){ return (t&&t.readable)||this; };
                            if (typeof RS.prototype.tee !== 'function') RS.prototype.tee = function(){ return [this,this]; };
                            if (typeof RS.prototype.getReader !== 'function') RS.prototype.getReader = function(){ return {read(){return Promise.resolve({done:true,value:undefined});},releaseLock(){},cancel(){return Promise.resolve();},closed:Promise.resolve()}; };
                        }
                    } catch(e){}
                    // 其它常见构造器
                    const iframeBenign = [
                        'WritableStream', 'TransformStream', 'OffscreenCanvas',
                        'BroadcastChannel', 'ImageData', 'ImageBitmap',
                        'IntersectionObserver', 'ResizeObserver', 'PerformanceObserver',
                        'DOMParser', 'XMLSerializer', 'CSSStyleSheet',
                    ];
                    for (const n of iframeBenign) iDef(n);
                    // DOMParser 需要能 parseFromString
                    if (iframeWindow.DOMParser && !iframeWindow.DOMParser.prototype.parseFromString) {
                        iframeWindow.DOMParser.prototype.parseFromString = function(str, type) {
                            const {JSDOM} = require('jsdom');
                            return new JSDOM(str, {contentType: type || 'text/html'}).window.document;
                        };
                    }

                    // performance
                    if (iframeWindow.performance && typeof iframeWindow.performance.getEntries !== 'function') {
                        iframeWindow.performance.getEntries = () => [];
                        iframeWindow.performance.getEntriesByType = () => [];
                        iframeWindow.performance.getEntriesByName = () => [];
                    }

                    // 执行脚本
                    const iframeVm = require('vm');
                    const script = new iframeVm.Script(scriptBody, {filename: 'turnstile-iframe.js'});
                    script.runInContext(iframeDom.getInternalVMContext());
                    console.log('[jsdom][turnstile-iframe] iframe 脚本执行完成（独立 DOM，无同步崩溃）');

                } catch (e) {
                    console.log('[jsdom][turnstile-iframe] 执行错误:', e.message);
                    if (e.stack) console.log(String(e.stack).split('\n').slice(0, 8).join('\n'));
                }
            })
            .catch((err) => {
                console.log('[jsdom][turnstile-iframe] 网络错误:', err.message);
            });
    };

    // ------------- iframe 拦截策略 (双保险) --------------------------------
    // Turnstile api.js 使用 ShadowRoot 隔离其 widget DOM：
    //   attachShadow({mode:'closed'}) → shadowRoot.appendChild(iframe)
    // document 级的 MutationObserver 看不到 shadow 内部 mutation。
    //
    // 策略 A：monkey-patch Element.prototype.attachShadow —— 每次 attachShadow 时
    //         在返回的 shadowRoot 上也挂一个 MutationObserver 监听 iframe 插入。
    // 策略 B：document 级 MutationObserver 仍保留，作为非 shadow DOM 场景兜底。
    // -------------------------------------------------------------------------
    const iframeMOCallback = (mutations) => {
        for (const m of mutations) {
            // childList: iframe 被插入
            for (const node of (m.addedNodes || [])) {
                if (node.nodeName === 'IFRAME' || (node.tagName && node.tagName.toLowerCase() === 'iframe')) {
                    setImmediate(() => handleIframeInsert(node));
                }
                if (node.querySelectorAll) {
                    try {
                        const iframes = node.querySelectorAll('iframe');
                        for (const ifr of iframes) setImmediate(() => handleIframeInsert(ifr));
                    } catch (e) {}
                }
            }
            // attributes: iframe 的 src 被修改（先 append 后设 src 的情况）
            if (m.type === 'attributes' && m.attributeName === 'src' && m.target &&
                (m.target.nodeName === 'IFRAME' || (m.target.tagName && m.target.tagName.toLowerCase() === 'iframe'))) {
                setImmediate(() => handleIframeInsert(m.target));
            }
        }
    };

    try {
        const MO = window.MutationObserver;
        if (MO) {
            // 策略 A：hook attachShadow → 在 shadow root 内也监听
            const origAttachShadow = window.Element.prototype.attachShadow;
            if (origAttachShadow) {
                window.Element.prototype.attachShadow = function attachShadow(init) {
                    const shadowRoot = origAttachShadow.call(this, init);
                    try {
                        const innerObs = new MO(iframeMOCallback);
                        innerObs.observe(shadowRoot, {childList: true, subtree: true, attributes: true, attributeFilter: ['src']});
                    } catch (e) {}
                    return shadowRoot;
                };
                console.log('[jsdom] turnstile iframe 拦截器: attachShadow 已 hook');
            }

            // 策略 B：document 级兜底
            const docObs = new MO(iframeMOCallback);
            docObs.observe(window.document.documentElement || window.document.body || window.document, {childList: true, subtree: true, attributes: true, attributeFilter: ['src']});
            console.log('[jsdom] turnstile iframe 拦截器已启动 (MutationObserver + ShadowRoot hook)');
        } else {
            console.log('[jsdom] 无 MutationObserver，turnstile iframe 拦截不可用');
        }
    } catch (e) {
        console.log('[jsdom] turnstile iframe 拦截器初始化失败:', e.message);
    }
}

// =============================================================================
// 缺失全局函数补丁（自适应）
//
// target.js 里有一部分符号名（本轮是 ieqE5 / LHpm9 / Luvb6，上一轮是 ySrR0…）
// 是运行时被 **Turnstile 外链脚本** 挂到 window 上的编解码/组装辅助函数。
// orchestrate 在 z3()/z9() 等 body 组装函数里用它们做数据变换，未定义时会在
// case 内崩溃 → XHR.send 不触发。
//
// 每次刷新 target.js 这批名字会全变（旋转过的字符串表里存的都是"当前一次刷新专属"
// 混淆名）。由 tools/derive_target_stubs.js 静态解析出这批孤儿名字并写入
// target/target.stubs.json，这里只做加载 + identity stub。
//
// Turnstile 真出网时会用真实实现覆盖 stub —— stub 只是"离线也能跑到 send"的兜底。
// identity 是保序变换，不影响 body 结构，只影响字节内容。
// =============================================================================
const stubsPath = path.join(__dirname, 'target/target.stubs.json');
let orphanStubs = [];
try {
    if (fs.existsSync(stubsPath)) {
        const s = JSON.parse(fs.readFileSync(stubsPath, 'utf8'));
        orphanStubs = Array.isArray(s.orphans) ? s.orphans : [];
    } else {
        console.log('[jsdom] 提示：target/target.stubs.json 不存在，运行 `node tools/derive_target_stubs.js` 生成');
    }
} catch (e) {
    console.log('[jsdom] target.stubs.json 加载失败:', e.message);
}
const installedStubs = [];
for (const entry of orphanStubs) {
    const name = entry && (entry.name || entry);
    if (typeof name !== 'string' || !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) continue;
    if (typeof window[name] !== 'undefined') continue; // Turnstile 或其它源已提供
    // identity：接住 z3/z9 里 `ze = <stub>(ze)` 这种保序调用；返回第一个入参
    window[name] = function identityStub() { return arguments.length ? arguments[0] : undefined; };
    installedStubs.push(name);
}
if (installedStubs.length) {
    console.log(`[jsdom] identity stub ${installedStubs.length} 个: ${installedStubs.join(', ')}（Turnstile 加载后会覆盖）`);
}

// =============================================================================
// 可观测性：把“第一个缺口/卡点”暴露出来，而不是静默挂起
// =============================================================================
window.onerror = (msg, src, line, col, err) => {
    console.log('[jsdom][window.onerror]', msg, '@', src, line+':'+col);
    if (err && err.stack) console.log(String(err.stack).split('\n').slice(0, 6).join('\n'));
    return false;
};
try {
    window.addEventListener('error', (e) => {
        const msg = (e && (e.message || (e.error && e.error.message))) || e;
        console.log('[jsdom][error]', msg);
        if (e && e.error && e.error.stack) console.log('    stack:', String(e.error.stack).split('\n').slice(0, 4).join(' | '));
    }, true);
    window.addEventListener('unhandledrejection', (e) => console.log('[jsdom][unhandledrejection]', (e && e.reason && e.reason.message) || (e && e.reason) || e));
} catch (e) {}
process.on('unhandledRejection', (e) => console.log('[jsdom][node unhandledRejection]', (e && e.message) || e));

// =============================================================================
// 执行 orchestrate（target.js）。currentScript 指向带 ray 的伪脚本，
// 供 target.js 解析自身 ray（部分 orchestrate 读 currentScript.src）。
// =============================================================================
const orchestrateUrl = `https://${zone}/cdn-cgi/challenge-platform/h/${cfConfig.cFPWv || 'g'}/orchestrate/chl_page/v1?ray=${cfConfig.cRay}`;
const bootScript = window.document.createElement('script');
bootScript.src = orchestrateUrl;

console.log('[jsdom] readyState =', window.document.readyState, '| 执行 target/target.js ...');

// -----------------------------------------------------------------------------
// 诊断：捕获 /eb/ XHR 的调用栈 —— eb 是 CF 内部错误报告端点。这里必须在 target.js
// 之前挂钩，否则 target.js 内部同步/微任务里的 XHR.open 会漏掉。
// -----------------------------------------------------------------------------
{
    const XHR = window.XMLHttpRequest;
    if (XHR && XHR.prototype && !XHR.prototype.__cfDiagHooked) {
        XHR.prototype.__cfDiagHooked = true;
        const origOpen = XHR.prototype.open;
        XHR.prototype.open = function (method, url) {
            try {
                if (typeof url === 'string' && url.indexOf('/eb/') >= 0) {
                    const err = new Error('eb-trace');
                    console.log('[jsdom][eb-trace] URL:', url.slice(0, 160));
                    console.log(String(err.stack).split('\n').slice(1, 20).join('\n'));
                }
            } catch (e) {}
            return origOpen.apply(this, arguments);
        };
        console.log('[jsdom][eb-trace] XHR.open hooked');
    }
}

runner.setCurrentScript(bootScript);
try {
    runner.runFile(path.join(__dirname, 'target/target.js'));
    console.log('[jsdom] target.js 同步执行返回（未抛错）');
} catch (e) {
    console.log('[jsdom] target.js 抛错（== 下一个要补的缺口）:', e.message);
    if (e.stack) console.log(String(e.stack).split('\n').slice(0, 8).join('\n'));
} finally {
    runner.setCurrentScript(null);
}

// =============================================================================
// 事件注入（真实 jsdom 事件；注意 isTrusted=false 是 jsdom 死穴，CF 会查）
// 重要：DOMContentLoaded / load 由 jsdom 生命周期自己派发（实测序列：
//   readystatechange:interactive → DOMContentLoaded → readystatechange:complete → load），
// 这里绝不能再手动补发，否则 orchestrate 的 DCL 处理器会被触发两次、可能在半就绪
// 状态下出错并latch住，导致 ov1 永远 open 而不 send。只补 jsdom 不会自发的交互事件。
// =============================================================================
const mouse = (type, x, y) => new window.MouseEvent(type, {
    clientX: x, clientY: y, screenX: x + 100, screenY: y + 100, bubbles: true, cancelable: true,
});
setTimeout(() => {
    const moves = [[200, 300], [210, 305], [225, 312], [240, 320], [255, 330]];
    let i = 0;
    const h = setInterval(() => {
        if (i < moves.length) {
            const [x, y] = moves[i++];
            window.dispatchEvent(mouse('mousemove', x, y));
            window.document.dispatchEvent(mouse('mousemove', x, y));
        } else {
            clearInterval(h);
            window.dispatchEvent(mouse('mousedown', 255, 330));
            window.dispatchEvent(mouse('mouseup', 255, 330));
            window.dispatchEvent(mouse('click', 255, 330));
        }
    }, 60);
    try {
        window.document.dispatchEvent(new window.Event('visibilitychange', {bubbles: true}));
        window.dispatchEvent(new window.Event('focus', {bubbles: false}));
    } catch (e) {}
}, 700);

// =============================================================================
// cf_clearance 监听 + 卡点探针
// =============================================================================
let ticks = 0;
const watch = setInterval(() => {
    const c = cookieJar.cookies && cookieJar.cookies.get('cf_clearance');
    if (c) {
        console.log('\n🚀🚀🚀 cf_clearance =', c);
        process.exit(0);
    }
    // token 落到表单 input 也算（保底）
    try {
        const inputs = window.document.getElementsByTagName('input');
        for (const inp of inputs) {
            const name = inp.getAttribute('name');
            const val = inp.getAttribute('value');
            if (val && (name === 'cf_challenge_response' || name === 'cf-turnstile-response')) {
                console.log('\n🚀 token =', val);
                process.exit(0);
            }
        }
    } catch (e) {}
    if (++ticks % 5 === 0) {
        const scripts = window.document.getElementsByTagName('script').length;
        const inputs = window.document.getElementsByTagName('input').length;
        console.log(`[jsdom][probe ${ticks}s] 等待中… scripts=${scripts} inputs=${inputs} loadedExt=${loaded.size}`);
    }
}, 1000);
watch.unref && watch.unref();
