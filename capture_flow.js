const puppeteer = require('puppeteer');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const cfConfig = require('./src/config/cfConfig');

const zone = String(cfConfig.cZone || 'www.sciencedirect.com')
    .replace(/^https?:\/\//, '')
    .replace(/\/$/, '');
const args = process.argv.slice(2);
const HEADFUL = args.includes('--headful') || args.includes('--manual');
const WAIT_CLEARANCE = args.includes('--wait-clearance') || args.includes('--manual');
const urlArg = args.find((arg) => !arg.startsWith('--'));
const TARGET_URL = urlArg || (cfConfig.cUPMDTk
    ? `https://${zone}${cfConfig.cUPMDTk}`
    : `https://${zone}/`);

function extractChlOpt(html) {
    const match = String(html || '').match(/window\._cf_chl_opt\s*=\s*(\{[\s\S]*?\})\s*;/);
    if (!match) return null;
    try {
        return JSON.parse(match[1].replace(/'/g, '"'));
    } catch (e) {
        try {
            return Function(`return (${match[1]})`)();
        } catch (e2) {
            return null;
        }
    }
}

function saveCfConfig(opt, targetUrl) {
    const content = `module.exports = ${JSON.stringify({
        cvId: opt.cvId || '3',
        cZone: opt.cZone || new URL(targetUrl).hostname,
        cType: opt.cType || 'managed',
        cRay: opt.cRay || '',
        cH: opt.cH || '',
        cUPMDTk: opt.cUPMDTk || '',
        cFPWv: opt.cFPWv || 'b',
        cITimeS: opt.cITimeS || String(Math.floor(Date.now() / 1000)),
        cTplC: opt.cTplC || 1,
        cTplV: opt.cTplV || 5,
        cTplB: opt.cTplB || 'cf',
        fa: opt.fa || '',
        md: opt.md || '',
        mdrd: opt.mdrd || '',
    }, null, 4)};\n`;
    fs.writeFileSync(path.join(__dirname, 'src/config/cfConfig.js'), content, 'utf8');
    console.log('[capture] saved src/config/cfConfig.js:', opt.cRay);
}

function dumpBody(prefix, url, headers, body) {
    if (!body) return;
    const hash = crypto.createHash('sha256').update(body).digest('hex');
    const file = path.join(os.tmpdir(), `${prefix}-${Date.now()}-${hash.slice(0, 10)}.txt`);
    fs.writeFileSync(file, body, 'utf8');
    console.log(`[capture] ${prefix} ${url}`);
    console.log(`[capture] body len=${body.length}, sha256=${hash}`);
    console.log(`[capture] content-type=${headers['content-type'] || headers['Content-Type'] || 'none'}`);
    console.log(`[capture] head=${body.slice(0, 180).replace(/\s+/g, ' ')}`);
    console.log(`[capture] tail=${body.slice(-120).replace(/\s+/g, ' ')}`);
    console.log(`[capture] dump=${file}`);
}

async function main() {
    console.log('[capture] target:', TARGET_URL);
    console.log(`[capture] mode: ${HEADFUL ? 'headful' : 'headless'}${WAIT_CLEARANCE ? ', wait-clearance' : ''}`);
    const browser = await puppeteer.launch({
        headless: HEADFUL ? false : 'new',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled',
            '--window-size=1365,900',
        ],
        defaultViewport: {width: 1365, height: 900},
    });

    const page = await browser.newPage();
    page.setDefaultTimeout(45000);
    page.setDefaultNavigationTimeout(45000);

    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', {get: () => undefined});
        Object.defineProperty(navigator, 'languages', {get: () => ['zh-CN', 'zh', 'en-US', 'en']});
        window.chrome = window.chrome || {runtime: {}};
    });

    const requestMap = new Map();

    page.on('request', (request) => {
        const url = request.url();
        if (!url.includes('/cdn-cgi/challenge-platform/')) return;
        const info = {
            method: request.method(),
            url,
            headers: request.headers(),
            postData: request.postData() || '',
        };
        requestMap.set(request, info);
        console.log(`[capture] request ${info.method} ${url}`);
        if (url.includes('/flow/ov1/')) dumpBody('browser-flow', url, info.headers, info.postData);
        if (url.includes('/b/ov1/') && url.includes('/interactive')) dumpBody('browser-interactive', url, info.headers, info.postData);
    });

    page.on('response', async (response) => {
        const url = response.url();
        const headers = response.headers();
        const contentType = headers['content-type'] || '';

        if (url.includes('/cdn-cgi/challenge-platform/')) {
            console.log(`[capture] response ${response.status()} ${url}`);
        }

        try {
            if (url.includes('/cdn-cgi/challenge-platform/') && url.includes('/orchestrate/')) {
                const text = await response.text();
                if (response.status() === 200 && text.length > 500) {
                    fs.writeFileSync(path.join(__dirname, 'target/target.js'), text, 'utf8');
                    console.log('[capture] saved target/target.js:', text.length, 'bytes');
                }
                return;
            }

            if (contentType.includes('text/html')) {
                const text = await response.text();
                const opt = extractChlOpt(text);
                if (opt) saveCfConfig(opt, url);
            }
        } catch (e) {
            console.log('[capture] response read skipped:', e.message);
        }
    });

    try {
        await page.goto(TARGET_URL, {waitUntil: 'domcontentloaded'});
    } catch (e) {
        console.log('[capture] goto:', e.message);
    }

    const maxTicks = WAIT_CLEARANCE ? 48 : 6;
    for (let i = 0; i < maxTicks; i++) {
        await new Promise((resolve) => setTimeout(resolve, 5000));
        try {
            const frameHandles = await page.$$('iframe[src*="challenges.cloudflare.com"]');
            if (frameHandles.length) {
                const box = await frameHandles[0].boundingBox();
                if (box) {
                    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, {steps: 8});
                    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, {delay: 80});
                    console.log('[capture] clicked challenge iframe');
                }
            }
        } catch (e) {
            console.log('[capture] iframe click skipped:', e.message);
        }

        const cookies = await page.cookies();
        const names = cookies.map((cookie) => cookie.name);
        console.log(`[capture] cookies(${i + 1}): ${names.join(', ') || 'none'}`);
        const clearance = cookies.find((cookie) => cookie.name === 'cf_clearance');
        if (clearance) {
            console.log(`[capture] cf_clearance=${clearance.value}`);
            const cookieFile = path.join(__dirname, 'src/config/cfCookies.json');
            fs.writeFileSync(cookieFile, JSON.stringify(cookies, null, 2), 'utf8');
            console.log(`[capture] saved ${cookieFile}`);
            break;
        }
    }

    const finalState = await page.evaluate(() => ({
        title: document.title,
        href: location.href,
        text: document.body ? document.body.innerText.slice(0, 200) : '',
    })).catch((e) => ({error: e.message}));
    console.log('[capture] final:', JSON.stringify(finalState));
    await browser.close();
}

main().catch((err) => {
    console.error('[capture] fatal:', err && err.stack || err);
    process.exit(1);
});
