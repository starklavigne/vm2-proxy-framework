const { nativize } = require('../utils/tools');
const Media = require('../env/Media');

// ============================================================
// 1. 堆栈清洗与伪装逻辑 (Stack Sanitizer)
// ============================================================
const installStackGuard = (context, scriptUrl) => {
    // 保存原始的 prepareStackTrace（如果有的话）
    const originalPrepare = Error.prepareStackTrace;

    // 重写 V8 的堆栈生成器
    Object.defineProperty(Error, 'prepareStackTrace', {
        value: function (error, callSites) {
            // 1. 构造错误头 "Error: message"
            let stackString = `${error.name || 'Error'}: ${error.message || ''}`;

            for (const site of callSites) {
                // 获取真实文件名
                const unsafeFileName = site.getFileName() || '';

                // --- 过滤规则 (Filter) ---
                // 剔除 Node 内部模块、VM2 桥接文件、加载器等
                if (
                    !unsafeFileName ||
                    unsafeFileName.startsWith('node:') ||
                    unsafeFileName.includes('internal/') ||
                    unsafeFileName.includes('bridge.js') ||
                    unsafeFileName.includes('vm.js') ||
                    unsafeFileName.includes('node_modules')
                ) {
                    continue;
                }

                // --- 伪装规则 (Mapper) ---
                // 将本地运行的 target.js 映射回云端 URL
                // 这里的 'target.js' 需要根据你实际运行的文件名特征来匹配
                let safeFileName = unsafeFileName;
                if (unsafeFileName.includes('target.js') || unsafeFileName === 'EnterScript') {
                    safeFileName = scriptUrl;
                } else {
                    // 对于其他不确定的文件，只要不是 target.js，一律视为 VM 内部代码，选择性隐藏或伪装
                    // 简单策略：如果是 eval 代码，保留；否则过滤
                    if (!unsafeFileName.startsWith('http') && !unsafeFileName.startsWith('eval')) {
                       continue;
                    }
                }

                // 获取行号列号 (防止 null)
                const line = site.getLineNumber() || 1;
                const col = site.getColumnNumber() || 1;

                // 获取函数名
                let funcName = site.getFunctionName();
                const typeName = site.getTypeName();
                const method = site.getMethodName();

                // 浏览器格式化逻辑：
                // Chrome 格式通常是: "    at FunctionName (URL:Line:Col)"
                // 或者匿名函数: "    at URL:Line:Col"

                let location = `(${safeFileName}:${line}:${col})`;
                let frame = '';

                if (funcName) {
                    frame = `    at ${funcName} ${location}`;
                } else {
                    // 尝试组合 typeName.method
                    if (typeName && method) {
                        frame = `    at ${typeName}.${method} ${location}`;
                    } else {
                        // 纯匿名
                        frame = `    at ${safeFileName}:${line}:${col}`;
                    }
                }

                stackString += '\n' + frame;
            }

            return stackString;
        },
        writable: true,
        configurable: true,
        enumerable: false
    });
};

// ============================================================
// 原有的 Navigator 和其他定义保持不变
// ============================================================
class Navigator {
    constructor(p, context) {
        Object.defineProperty(this, '_p', { value: p, enumerable: false, writable: true });
        const plugins = new context.PluginArray();
        Object.defineProperty(this, '_plugins', { value: plugins, enumerable: false });
        Object.defineProperty(this, '_mimeTypes', { value: new context.MimeTypeArray(plugins), enumerable: false });
    }
    get userAgent() { return this._p.userAgent; }
    get platform() { return this._p.userAgent.includes('Win') ? "Win32" : "MacIntel"; }
    get appCodeName() { return "Mozilla"; }
    get appName() { return "Netscape"; }
    get appVersion() { return this._p.userAgent.replace('Mozilla/', ''); }
    get product() { return "Gecko"; }
    get vendor() { return "Google Inc."; }
    get language() { return "zh-CN"; }
    get languages() { return ["zh-CN", "zh", "en"]; }
    get cookieEnabled() { return true; }
    get onLine() { return true; }
    get hardwareConcurrency() { return 8; }
    get webdriver() { return false; }
    get maxTouchPoints() { return 0; }
    get plugins() { return this._plugins; }
    get mimeTypes() { return this._mimeTypes; }
    get connection() { return { effectiveType: '4g', rtt: 50, downlink: 10, saveData: false }; }
    get permissions() { return { query: nativize(async () => ({state: 'granted'}), 'query') }; }
    javaEnabled() { return false; }
    sendBeacon() { return true; }
    vibrate() { return true; }
}

// ============================================================
// 模块导出
// ============================================================
module.exports = function(context, rawWindow, profile) {
    // 1. 【新增】启动堆栈防护
    // 注意：这里的 URL 应该和你 document.currentScript.src 保持一致
    // 你可以从 cfConfig 传入，或者写死一个通用的
    const mainScriptUrl = "https://challenges.cloudflare.com/turnstile/v0/api.js";
    installStackGuard(context, mainScriptUrl);

    // 2. 注入 Navigator
    context.Navigator = nativize(Navigator, 'Navigator');

    // 3. 注入 Canvas 增强
    context.CanvasRenderingContext2D = class CanvasRenderingContext2D extends Media.CanvasRenderingContext2D {
        constructor(canvas) { super(canvas); }
        measureText(text) {
            return { width: text.length * 8.5, actualBoundingBoxAscent: 10, actualBoundingBoxDescent: 2 };
        }
        getImageData(sx, sy, sw, sh) {
            const size = sw * sh * 4;
            const data = new Uint8ClampedArray(size);
            for (let i = 0; i < size; i += 4) {
                data[i] = 255; data[i+1] = 255; data[i+2] = 255; data[i+3] = 255;
                if ((i * 7 + 3) % 100 < 5) data[i] = 250;
            }
            return { width: sw, height: sh, data: data };
        }
    };
    context.CanvasRenderingContext2D = nativize(context.CanvasRenderingContext2D, 'CanvasRenderingContext2D');

    // 4. 注入 Performance
    const perfStart = Date.now();
    context.performance = {
        timeOrigin: perfStart,
        now: nativize(() => Date.now() - perfStart, 'now'),
        timing: { navigationStart: perfStart },
        getEntries: nativize(() => [], 'getEntries')
    };

    // 5. 注入 Screen
    context.screen = {
        width: 1920, height: 1080, availWidth: 1920, availHeight: 1040,
        colorDepth: 24, pixelDepth: 24
    };

    // 6. Chrome 对象
    context.chrome = {
        runtime: {
            id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            connect: nativize(()=>{}, 'connect')
        },
        app: { isInstalled: false }
    };

    // 7. Base64
    context.atob = nativize((i) => Buffer.from(String(i), 'base64').toString('binary'), 'atob');
    context.btoa = nativize((i) => Buffer.from(String(i), 'binary').toString('base64'), 'btoa');

    // 8. Intl 透传
    context.Intl = Intl;

    // 9. 绑定 Window 尺寸
    rawWindow.innerWidth = profile.screenWidth || 1920;
    rawWindow.innerHeight = profile.screenHeight || 1080;
    rawWindow.outerWidth = rawWindow.innerWidth;
    rawWindow.outerHeight = rawWindow.innerHeight;
    rawWindow.devicePixelRatio = 1;

    // 10. 实例化并绑定
    rawWindow.navigator = new context.Navigator(profile, context);
    rawWindow.chrome = context.chrome;
};