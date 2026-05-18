/**
 * capture_headless.js
 * 用无头 Chrome (headless=true，无防检测) 触发 CF 挑战，提取 _cf_chl_opt
 */
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const TARGET_URL = process.argv[2] || 'https://www.sciencedirect.com/journal/phytochemistry-letters/issues';

async function main() {
    console.log('[headless] 启动无头 Chrome，目标:', TARGET_URL);

    const browser = await puppeteer.launch({
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
        ],
        // 不隐藏自动化特征
    });

    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(25000);

    let challengeHtml = '';
    let challengeUrl = '';
    let cfRay = '';
    let orchestrateUrl = '';

    page.on('response', async (resp) => {
        const ct = resp.headers()['content-type'] || '';
        if (!ct.includes('text/html') && !ct.includes('javascript')) return;
        const url = resp.url();

        // 监视 orchestrate 脚本
        if (url.includes('orchestrate') && url.includes('challenge-platform')) {
            orchestrateUrl = url;
            console.log('[headless] orchestrate URL:', url.substring(0, 120));
            try {
                const text = await resp.text();
                if (text.length > 500) {
                    fs.writeFileSync(path.join(__dirname, 'target/target.js'), text, 'utf-8');
                    console.log('[headless] ✅ target/target.js 已从响应更新:', text.length, '字节');
                }
            } catch(e) {}
            return;
        }

        if (!ct.includes('text/html')) return;

        // 寻找 CF 挑战 HTML
        try {
            const text = await resp.text();
            if (text.includes('_cf_chl_opt') || text.includes('cf-chl')) {
                challengeHtml = text;
                challengeUrl = url;
                cfRay = resp.headers()['cf-ray'] || '';
                console.log('[headless] ✅ CF 挑战页面! status:', resp.status(), 'ray:', cfRay);
            }
        } catch(e) {}
    });

    try {
        await page.goto(TARGET_URL, { waitUntil: 'networkidle0', timeout: 20000 });
    } catch(e) {
        console.log('[headless] 导航结果:', e.message.substring(0, 80));
    }

    await new Promise(r => setTimeout(r, 3000));

    // 直接从页面提取
    try {
        const result = await page.evaluate(() => {
            const opt = window._cf_chl_opt;
            const scripts = [...document.querySelectorAll('script[src]')]
                .filter(s => s.src.includes('orchestrate'));
            return {
                cfOpt: opt ? JSON.stringify(opt) : null,
                orchestrate: scripts.length ? scripts[0].src : null,
                title: document.title,
                url: location.href,
            };
        });
        console.log('[headless] 页面标题:', result.title);
        console.log('[headless] 当前 URL:', result.url);

        if (result.cfOpt) {
            const opt = JSON.parse(result.cfOpt);
            console.log('[headless] ✅ _cf_chl_opt found! cRay:', opt.cRay, 'cType:', opt.cType, 'cITimeS:', opt.cITimeS);

            const cfConfigContent = `module.exports = ${JSON.stringify({
                cvId:    opt.cvId    || '3',
                cZone:   opt.cZone   || new URL(TARGET_URL).hostname,
                cType:   opt.cType   || 'managed',
                cRay:    opt.cRay    || '',
                cH:      opt.cH      || '',
                cUPMDTk: opt.cUPMDTk || '',
                cFPWv:   opt.cFPWv   || 'b',
                cITimeS: opt.cITimeS || String(Math.floor(Date.now() / 1000)),
                cTplC:   opt.cTplC   || 1,
                cTplV:   opt.cTplV   || 5,
                cTplB:   opt.cTplB   || 'cf',
                fa:      opt.fa      || '',
                md:      opt.md      || '',
            }, null, 4)};\n`;

            fs.writeFileSync(path.join(__dirname, 'src/config/cfConfig.js'), cfConfigContent, 'utf-8');
            console.log('[headless] ✅ cfConfig.js 已更新');
        } else {
            console.log('[headless] ❌ 未找到 _cf_chl_opt');
            console.log('[headless]   这说明 CF 对这个 Chrome 实例没有发起挑战');
        }

        if (result.orchestrate && !orchestrateUrl) {
            orchestrateUrl = result.orchestrate;
        }
    } catch(e) {
        console.log('[headless] 提取错误:', e.message);
    }

    // 如果从响应里提取到了 cfConfig，处理它
    if (challengeHtml && !challengeHtml.includes('已更新')) {
        const match = challengeHtml.match(/window\._cf_chl_opt\s*=\s*(\{[\s\S]*?\})\s*;/);
        if (match) {
            try {
                let opt;
                try { opt = JSON.parse(match[1].replace(/'/g, '"')); }
                catch(e) { opt = eval('(' + match[1] + ')'); }

                console.log('[headless] ✅ 从响应 HTML 提取 _cf_chl_opt:', opt.cRay);
                const cfConfigContent = `module.exports = ${JSON.stringify({
                    cvId:    opt.cvId    || '3',
                    cZone:   opt.cZone   || new URL(TARGET_URL).hostname,
                    cType:   opt.cType   || 'managed',
                    cRay:    opt.cRay    || '',
                    cH:      opt.cH      || '',
                    cUPMDTk: opt.cUPMDTk || '',
                    cFPWv:   opt.cFPWv   || 'b',
                    cITimeS: opt.cITimeS || String(Math.floor(Date.now() / 1000)),
                    cTplC:   opt.cTplC   || 1,
                    cTplV:   opt.cTplV   || 5,
                    cTplB:   opt.cTplB   || 'cf',
                    fa:      opt.fa      || '',
                    md:      opt.md      || '',
                }, null, 4)};\n`;
                fs.writeFileSync(path.join(__dirname, 'src/config/cfConfig.js'), cfConfigContent, 'utf-8');
                console.log('[headless] ✅ cfConfig.js 已更新');
            } catch(e) {
                console.log('[headless] 解析 cfConfig 失败:', e.message);
            }
        }
    }

    await browser.close();
}

main().catch(e => { console.error('[headless] 致命错误:', e.message); process.exit(1); });
