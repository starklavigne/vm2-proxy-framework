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
const nodeFetch = require('node-fetch');
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
    nodeFetch(finalUrl, {
        headers: {
            'User-Agent': profile.userAgent,
            'Referer': window.location.href,
            'Accept': '*/*',
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
            'Cookie': cookieJar.getCookieString(finalUrl),
        },
        redirect: 'follow',
        timeout: 15000,
    }).then(async (resp) => {
        const text = await resp.text();
        if (!resp.ok) {
            console.log(`[jsdom] 脚本响应 ${resp.status} → 跳过执行: ${finalUrl.slice(0, 70)}`);
            if (isTurnstile(finalUrl)) triggerOnload(el, finalUrl); // 让流程继续
            else if (el.onerror) { try { el.onerror(); } catch (e) {} }
            return;
        }
        console.log(`[jsdom] 执行 ${text.length} 字节: ${finalUrl.slice(0, 70)}`);
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
    }).catch((err) => {
        console.log('[jsdom] 脚本网络错误:', err.message, '—', finalUrl.slice(0, 70));
        if (isTurnstile(finalUrl)) triggerOnload(el, finalUrl);
        else if (el.onerror) { try { el.onerror(); } catch (e) {} }
    });
};

runner.hookScriptInsertion((el) => setImmediate(() => loadExternalScript(el)));

// =============================================================================
// 缺失全局函数补丁
// ySrR0: 由 Turnstile 外链脚本注入的辅助函数，orchestrate 在 z3()（PoW/指纹组装）
// 里调用它做编码转换。无 Turnstile 时不存在 → z3 在 case'27' 崩溃 → XHR.send 不触发。
// 用 identity 函数 stub：让 z3 能跑完并发出 XHR.send（body 内容与真机有差异，
// 但结构/长度可对账，等 Turnstile 真实注入后再验证正确性）。
// =============================================================================
if (typeof window.ySrR0 !== 'function') {
    window.ySrR0 = function ySrR0(ze) { return ze; };
    console.log('[jsdom] ySrR0 stub 已注入（Turnstile 注入后会覆盖此 stub）');
}

// =============================================================================
// 可观测性：把“第一个缺口/卡点”暴露出来，而不是静默挂起
// =============================================================================
window.onerror = (msg) => { console.log('[jsdom][window.onerror]', msg); return false; };
try {
    window.addEventListener('error', (e) => console.log('[jsdom][error]', (e && (e.message || (e.error && e.error.message))) || e));
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
