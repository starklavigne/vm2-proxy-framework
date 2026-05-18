/**
 * capture.js - 自动从 CF 挑战页面抓取最新 cfConfig 和 target.js
 *
 * 用法: node capture.js [URL]
 * 示例: node capture.js "https://www.sciencedirect.com/journal/phytochemistry-letters/issues"
 */

const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

const TARGET_URL = process.argv[2] || 'https://www.sciencedirect.com/journal/phytochemistry-letters/issues';
const profile = require('./src/config/browserProfile');

// CF challenge 页面响应头
const CAPTURE_HEADERS = {
    'User-Agent': profile.userAgent,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7',
    'Accept-Encoding': 'gzip, deflate, br',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
    'Sec-Ch-Ua': '"Chromium";v="120", "Not_A Brand";v="24", "Google Chrome";v="120"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"Windows"',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1',
};

async function capture() {
    console.log(`\n[Capture] 请求: ${TARGET_URL}`);

    let html;
    let cfRay;
    let cfBm;
    try {
        const resp = await fetch(TARGET_URL, {
            headers: CAPTURE_HEADERS,
            redirect: 'follow',
            timeout: 20000,
        });

        // 读取响应头
        cfRay = resp.headers.get('cf-ray') || '';
        cfBm = resp.headers.get('set-cookie') || '';
        const status = resp.status;
        html = await resp.text();

        console.log(`[Capture] 响应 ${status}, CF-Ray: ${cfRay}`);
        console.log(`[Capture] HTML 大小: ${html.length} 字节`);

        if (status !== 403 && status !== 503 && !html.includes('_cf_chl_opt')) {
            // 尝试不带重定向再访问（有时 403 才有 CF challenge）
            console.log(`[Capture] 状态 ${status}，尝试带 __cf_chl_tk 参数...`);
        }
    } catch(e) {
        console.error(`[Capture] 网络错误: ${e.message}`);
        process.exit(1);
    }

    // 1. 提取 _cf_chl_opt
    const chlOptMatch = html.match(/window\._cf_chl_opt\s*=\s*(\{[\s\S]*?\})\s*;/);
    if (!chlOptMatch) {
        console.log(`\n[Capture] ❌ 未找到 _cf_chl_opt，该页面可能没有 CF 挑战`);
        console.log(`  当前 HTML 开头 500 字节:\n${html.substring(0, 500)}`);
        console.log(`\n[建议] 使用真实浏览器访问并手动操作：`);
        printManualGuide();
        process.exit(1);
    }

    let cfChlOpt;
    try {
        cfChlOpt = JSON.parse(chlOptMatch[1].replace(/'/g, '"'));
    } catch(e) {
        // 尝试 eval 方式
        try {
            cfChlOpt = eval('(' + chlOptMatch[1] + ')');
        } catch(e2) {
            console.error(`[Capture] 解析 _cf_chl_opt 失败: ${e2.message}`);
            console.log(`  原始内容: ${chlOptMatch[1].substring(0, 200)}`);
            process.exit(1);
        }
    }

    console.log(`\n[Capture] ✅ 找到 _cf_chl_opt:`);
    console.log(`  cRay   : ${cfChlOpt.cRay}`);
    console.log(`  cType  : ${cfChlOpt.cType}`);
    console.log(`  cZone  : ${cfChlOpt.cZone}`);
    console.log(`  cITimeS: ${cfChlOpt.cITimeS} (${new Date(cfChlOpt.cITimeS * 1000).toISOString()})`);

    // 2. 提取 orchestrate 脚本 URL
    const orchestrateMatch = html.match(/src=['"]([^'"]*orchestrate[^'"]*)['"]/);
    if (!orchestrateMatch) {
        console.log(`\n[Capture] ❌ 未找到 orchestrate 脚本 URL`);
        console.log(`  [建议] 在 DevTools Network 里找 orchestrate 请求，手动保存`);
        // 依然写入 cfConfig
    } else {
        let orchestrateUrl = orchestrateMatch[1];
        if (orchestrateUrl.startsWith('/')) {
            const urlObj = new URL(TARGET_URL);
            orchestrateUrl = `${urlObj.origin}${orchestrateUrl}`;
        }

        console.log(`\n[Capture] 下载 orchestrate 脚本: ${orchestrateUrl.substring(0, 100)}`);

        try {
            const resp = await fetch(orchestrateUrl, {
                headers: { ...CAPTURE_HEADERS, 'Referer': TARGET_URL },
                timeout: 20000,
            });
            const scriptContent = await resp.text();
            console.log(`[Capture] 脚本大小: ${scriptContent.length} 字节, 状态: ${resp.status}`);

            if (resp.ok && scriptContent.length > 1000) {
                fs.writeFileSync(path.join(__dirname, 'target/target.js'), scriptContent, 'utf-8');
                console.log(`[Capture] ✅ target/target.js 已更新`);
            } else {
                console.log(`[Capture] ⚠️  脚本内容异常，未写入`);
            }
        } catch(e) {
            console.error(`[Capture] 下载 orchestrate 失败: ${e.message}`);
        }
    }

    // 3. 生成 cfConfig.js
    const cZone = cfChlOpt.cZone || new URL(TARGET_URL).hostname;
    const cfConfigContent = `module.exports = ${JSON.stringify({
        cvId:    cfChlOpt.cvId   || '3',
        cZone:   cZone,
        cType:   cfChlOpt.cType  || 'managed',
        cRay:    cfChlOpt.cRay   || cfRay.split('-')[0] || '',
        cH:      cfChlOpt.cH     || '',
        cUPMDTk: cfChlOpt.cUPMDTk || '',
        cFPWv:   cfChlOpt.cFPWv  || 'b',
        cITimeS: cfChlOpt.cITimeS || String(Math.floor(Date.now() / 1000)),
        cTplC:   cfChlOpt.cTplC  || 1,
        cTplV:   cfChlOpt.cTplV  || 5,
        cTplB:   cfChlOpt.cTplB  || 'cf',
        fa:      cfChlOpt.fa     || '',
        md:      cfChlOpt.md     || '',
    }, null, 4)};\n`;

    fs.writeFileSync(path.join(__dirname, 'src/config/cfConfig.js'), cfConfigContent, 'utf-8');
    console.log(`\n[Capture] ✅ src/config/cfConfig.js 已更新`);

    // 4. 更新 main.js 里的目标 URL
    const mainJsPath = path.join(__dirname, 'main.js');
    let mainJs = fs.readFileSync(mainJsPath, 'utf-8');
    const newTargetUrl = TARGET_URL;

    // 检查 cType
    const isInteractive = (cfChlOpt.cType === 'interactive');
    if (isInteractive) {
        console.log(`\n[Capture] ⚠️  该挑战类型为 interactive（需要用户交互）`);
        console.log(`  提示：若需要自动通过，请寻找 managed 类型的挑战页面`);
    } else {
        console.log(`\n[Capture] ✅ 挑战类型: ${cfChlOpt.cType}（可能自动通过）`);
    }

    console.log(`\n[Capture] 完成！运行 node main.js 开始挑战`);
    console.log(`\n[下一步提示]`);
    console.log(`  1. 如果目标 URL 与现在不同，请手动更新 main.js 里的 targetUrl 变量`);
    console.log(`  2. 运行: node main.js`);
    console.log(`  3. 等待 Token 输出`);
}

function printManualGuide() {
    console.log(`
╔══════════════════════════════════════════════════════════════╗
║           手动抓取 CF 挑战数据 - 操作指南                      ║
╠══════════════════════════════════════════════════════════════╣
║                                                              ║
║  1. 打开 Chrome/Firefox，开启 DevTools (F12)                  ║
║                                                              ║
║  2. 访问 CF 挑战页面（403/503 页面）                           ║
║     示例: ${TARGET_URL.substring(0, 45)}...
║                                                              ║
║  3. 在 DevTools Console 中执行:                               ║
║     console.log(JSON.stringify(window._cf_chl_opt))          ║
║     → 复制输出，填入 src/config/cfConfig.js                   ║
║                                                              ║
║  4. 在 Network 标签页，找到 "orchestrate" 请求                 ║
║     → 右键 → Copy response                                   ║
║     → 粘贴到 target/target.js                                ║
║                                                              ║
║  5. 运行: node main.js                                        ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
`);
}

capture().catch(e => {
    console.error(`[Capture] 致命错误:`, e.message);
    process.exit(1);
});
