/**
 * capture_puppeteer.js - 使用真实 Chrome 浏览器捕获 CF 挑战数据
 *
 * 策略：
 * 1. 启动 Chrome (headless=false 为了不触发额外的机器人检测)
 * 2. 拦截所有 HTTP 响应，寻找含 _cf_chl_opt 的页面
 * 3. 提取挑战配置，下载最新 orchestrate 脚本
 * 4. 更新本地 cfConfig.js 和 target/target.js
 *
 * 用法: node capture_puppeteer.js [URL]
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const https = require('https');

const TARGET_URL = process.argv[2] || 'https://www.sciencedirect.com/journal/phytochemistry-letters/issues';
const TIMEOUT = 30000;

// ─── 辅助：提取 _cf_chl_opt ───────────────────────────────────────────────
function extractChlOpt(html) {
    const match = html.match(/window\._cf_chl_opt\s*=\s*(\{[\s\S]*?\})\s*;/);
    if (!match) return null;
    try {
        return JSON.parse(match[1].replace(/'/g, '"'));
    } catch(e) {
        try { return eval('(' + match[1] + ')'); } catch(e2) { return null; }
    }
}

// ─── 辅助：提取 orchestrate 脚本 URL ─────────────────────────────────────
function extractOrchestrateUrl(html, baseUrl) {
    const m = html.match(/src=['"]([^'"]*orchestrate[^'"]*)['"]/);
    if (!m) return null;
    let url = m[1];
    if (url.startsWith('/')) {
        const u = new URL(baseUrl);
        url = `${u.origin}${url}`;
    }
    return url;
}

// ─── 辅助：HTTPS GET ──────────────────────────────────────────────────────
function httpsGet(url, headers = {}) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                ...headers
            }
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve({ status: res.statusCode, body: data, headers: res.headers }));
        });
        req.on('error', reject);
        req.setTimeout(15000, () => { req.destroy(); reject(new Error('timeout')); });
    });
}

// ─── 写入配置文件 ─────────────────────────────────────────────────────────
function saveCfConfig(cfChlOpt, cfRay, targetUrl) {
    const cZone = cfChlOpt.cZone || new URL(targetUrl).hostname;
    const cfConfigContent = `module.exports = ${JSON.stringify({
        cvId:    cfChlOpt.cvId    || '3',
        cZone:   cZone,
        cType:   cfChlOpt.cType   || 'managed',
        cRay:    cfChlOpt.cRay    || cfRay || '',
        cH:      cfChlOpt.cH      || '',
        cUPMDTk: cfChlOpt.cUPMDTk || '',
        cFPWv:   cfChlOpt.cFPWv   || 'b',
        cITimeS: cfChlOpt.cITimeS || String(Math.floor(Date.now() / 1000)),
        cTplC:   cfChlOpt.cTplC   || 1,
        cTplV:   cfChlOpt.cTplV   || 5,
        cTplB:   cfChlOpt.cTplB   || 'cf',
        fa:      cfChlOpt.fa      || '',
        md:      cfChlOpt.md      || '',
    }, null, 4)};\n`;

    fs.writeFileSync(path.join(__dirname, 'src/config/cfConfig.js'), cfConfigContent, 'utf-8');
    console.log('[Capture] ✅ src/config/cfConfig.js 已更新');
}

// ─── 主流程 ───────────────────────────────────────────────────────────────
async function capture() {
    console.log(`\n[Capture] 目标 URL: ${TARGET_URL}`);
    console.log('[Capture] 启动 Chrome...');

    let browser;
    try {
        browser = await puppeteer.launch({
            headless: false,          // 可见模式减少机器人检测
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-blink-features=AutomationControlled',
                '--disable-infobars',
                '--window-size=1920,1080',
                '--start-maximized',
            ],
            defaultViewport: null,
            ignoreHTTPSErrors: true,
        });
    } catch (e) {
        console.log('[Capture] headless=false 失败，尝试 headless=true...');
        browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
            ignoreHTTPSErrors: true,
        });
    }

    const page = await browser.newPage();

    // 隐藏自动化痕迹
    await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        Object.defineProperty(navigator, 'languages', { get: () => ['zh-CN', 'zh', 'en'] });
        Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
        window.chrome = { runtime: {} };
    });

    let challengeFound = false;
    let capturedHtml = '';
    let capturedUrl = '';
    let capturedRay = '';
    let orchestrateUrl = '';

    // 拦截所有响应
    page.on('response', async (response) => {
        if (challengeFound) return;
        const url = response.url();
        const status = response.status();

        // 只检查 HTML 响应
        const ct = response.headers()['content-type'] || '';
        if (!ct.includes('html')) return;

        try {
            const text = await response.text();
            if (text.includes('_cf_chl_opt') || text.includes('cf-chl')) {
                console.log(`\n[Capture] 🎯 发现 CF 挑战页面!`);
                console.log(`  URL: ${url}`);
                console.log(`  Status: ${status}`);
                challengeFound = true;
                capturedHtml = text;
                capturedUrl = url;
                capturedRay = response.headers()['cf-ray'] || '';
            }
        } catch (e) {
            // 忽略读取错误
        }
    });

    // 同时监听请求，拦截 orchestrate 请求
    page.on('request', (request) => {
        const url = request.url();
        if (url.includes('orchestrate') && url.includes('challenge-platform')) {
            if (!orchestrateUrl) {
                orchestrateUrl = url;
                console.log(`[Capture] 🎯 发现 orchestrate URL: ${url.substring(0, 100)}`);
            }
        }
    });

    console.log('[Capture] 导航到目标 URL...');

    try {
        await page.goto(TARGET_URL, {
            waitUntil: 'domcontentloaded',
            timeout: TIMEOUT,
        });
    } catch (e) {
        console.log(`[Capture] 导航超时或错误: ${e.message}`);
    }

    // 等待最多 10 秒看是否出现挑战
    await new Promise(r => setTimeout(r, 5000));

    // 如果没拦截到，尝试从当前页面提取
    if (!challengeFound) {
        console.log('[Capture] 响应拦截未发现挑战，从当前页面提取...');
        try {
            const result = await page.evaluate(() => {
                return {
                    hasChlOpt: !!(window._cf_chl_opt),
                    chlOpt: window._cf_chl_opt ? JSON.stringify(window._cf_chl_opt) : null,
                    title: document.title,
                    url: location.href,
                };
            });
            console.log(`  页面标题: ${result.title}`);
            console.log(`  当前 URL: ${result.url}`);
            if (result.hasChlOpt) {
                console.log(`  ✅ 发现 window._cf_chl_opt!`);
                const parsed = JSON.parse(result.chlOpt);
                console.log(`  cRay: ${parsed.cRay}`);
                console.log(`  cType: ${parsed.cType}`);
                console.log(`  cITimeS: ${parsed.cITimeS}`);

                saveCfConfig(parsed, capturedRay, TARGET_URL);

                // 尝试获取 orchestrate URL
                if (!orchestrateUrl) {
                    orchestrateUrl = await page.evaluate(() => {
                        const scripts = document.querySelectorAll('script[src]');
                        for (const s of scripts) {
                            if (s.src && s.src.includes('orchestrate')) return s.src;
                        }
                        return null;
                    });
                }
            } else {
                console.log(`  ❌ 没有 _cf_chl_opt (页面可能已通过挑战或不需要挑战)`);
                console.log('\n[建议] CF 可能没有对当前 IP/浏览器发起挑战。');
                console.log('  尝试以下方法:');
                console.log('  1. 在 VPN/代理后重试');
                console.log('  2. 使用数据中心 IP (如 VPS)');
                console.log('  3. 找其他 CF 保护但显示 interstitial 的网站');

                // 尝试获取 orchestrate URL (如果已经拦截到了)
                if (!orchestrateUrl) {
                    console.log('\n[Capture] 尝试直接导航到 CF orchestrate 端点...');
                    await tryGetOrchestrateScript(page);
                }
            }
        } catch (e) {
            console.log(`[Capture] 提取失败: ${e.message}`);
        }
    } else {
        // 从拦截的 HTML 中提取
        const cfChlOpt = extractChlOpt(capturedHtml);
        if (cfChlOpt) {
            console.log(`\n[Capture] ✅ 成功提取 _cf_chl_opt:`);
            console.log(`  cRay   : ${cfChlOpt.cRay}`);
            console.log(`  cType  : ${cfChlOpt.cType}`);
            console.log(`  cITimeS: ${cfChlOpt.cITimeS}`);
            saveCfConfig(cfChlOpt, capturedRay, TARGET_URL);
            orchestrateUrl = orchestrateUrl || extractOrchestrateUrl(capturedHtml, capturedUrl);
        }
    }

    // 下载 orchestrate 脚本
    if (orchestrateUrl) {
        console.log(`\n[Capture] 下载 orchestrate 脚本: ${orchestrateUrl.substring(0, 100)}`);
        try {
            const scriptResp = await httpsGet(orchestrateUrl, { 'Referer': TARGET_URL });
            if (scriptResp.status === 200 && scriptResp.body.length > 500) {
                fs.writeFileSync(path.join(__dirname, 'target/target.js'), scriptResp.body, 'utf-8');
                console.log(`[Capture] ✅ target/target.js 已更新 (${scriptResp.body.length} 字节)`);
            } else {
                console.log(`[Capture] ⚠️ 脚本内容异常 (${scriptResp.status}, ${scriptResp.body.length} 字节)`);
            }
        } catch (e) {
            // 尝试通过 puppeteer 下载
            try {
                const scriptPage = await browser.newPage();
                await scriptPage.goto(orchestrateUrl, { waitUntil: 'networkidle0', timeout: 15000 });
                const content = await scriptPage.content();
                const bodyOnly = content.replace(/<html><head><\/head><body><pre[^>]*>/, '').replace(/<\/pre><\/body><\/html>/, '');
                if (bodyOnly.length > 500) {
                    fs.writeFileSync(path.join(__dirname, 'target/target.js'), bodyOnly, 'utf-8');
                    console.log(`[Capture] ✅ target/target.js 已通过浏览器下载`);
                }
                await scriptPage.close();
            } catch (e2) {
                console.log(`[Capture] orchestrate 下载失败: ${e2.message}`);
            }
        }
    } else {
        console.log('\n[Capture] 未找到 orchestrate URL');
        // 尝试构造 URL
        const cfConfigPath = path.join(__dirname, 'src/config/cfConfig.js');
        if (fs.existsSync(cfConfigPath)) {
            const config = require(cfConfigPath);
            if (config.cRay) {
                const constructedUrl = `https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/b/orchestrate/chl_page/v1?ray=${config.cRay}`;
                console.log(`[Capture] 尝试构造 URL: ${constructedUrl}`);
                try {
                    const resp = await httpsGet(constructedUrl, { 'Referer': TARGET_URL });
                    if (resp.status === 200 && resp.body.length > 500) {
                        fs.writeFileSync(path.join(__dirname, 'target/target.js'), resp.body, 'utf-8');
                        console.log(`[Capture] ✅ target/target.js 已用构造 URL 下载`);
                    } else {
                        console.log(`[Capture] 构造 URL 失败: ${resp.status}`);
                    }
                } catch(e) {
                    console.log(`[Capture] 构造 URL 请求失败: ${e.message}`);
                }
            }
        }
    }

    await browser.close();

    console.log('\n[Capture] 完成');
    if (challengeFound || fs.existsSync(path.join(__dirname, 'src/config/cfConfig.js'))) {
        console.log('[下一步] 运行: node main.js');
    }
}

async function tryGetOrchestrateScript(page) {
    // 尝试通过拦截到的网络请求找到 orchestrate URL
    const requests = await page.evaluate(() => {
        return performance.getEntriesByType('resource')
            .filter(e => e.name.includes('orchestrate'))
            .map(e => e.name);
    });
    if (requests.length > 0) {
        console.log(`[Capture] 从 performance entries 发现: ${requests[0]}`);
        return requests[0];
    }
    return null;
}

capture().catch(e => {
    console.error('[Capture] 致命错误:', e.message);
    process.exit(1);
});
