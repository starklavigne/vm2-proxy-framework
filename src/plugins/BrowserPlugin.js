const { nativize } = require('../utils/tools');
const Media = require('../env/Media');

// 修复后的 Navigator
class Navigator {
    constructor(p, context) {
        this._p = p;
        // 1. 先生成 PluginArray
        this._plugins = new context.PluginArray();

        // 2. 【核心修复】必须把 this._plugins 传进去！否则 MimeTypeArray 内部会报错
        this._mimeTypes = new context.MimeTypeArray(this._plugins);
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

module.exports = function(context, rawWindow, profile) {
    // 1. 注入 Navigator 类
    context.Navigator = nativize(Navigator, 'Navigator');

    // 2. 注入 Canvas 增强 (带噪点)
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
                if ((i/4) % 100 === 0) { data[i] = 50; data[i+1] = 50; data[i+2] = 50; }
            }
            return { width: sw, height: sh, data: data };
        }
    };
    context.CanvasRenderingContext2D = nativize(context.CanvasRenderingContext2D, 'CanvasRenderingContext2D');

    // 3. 注入 Performance
    const perfStart = Date.now();
    context.performance = {
        timeOrigin: perfStart,
        now: nativize(() => Date.now() - perfStart, 'now'),
        timing: { navigationStart: perfStart },
        getEntries: nativize(() => [], 'getEntries')
    };

    // 4. 注入 Screen
    context.screen = {
        width: 1920, height: 1080, availWidth: 1920, availHeight: 1040,
        colorDepth: 24, pixelDepth: 24
    };

    // 5. Chrome 对象
    context.chrome = { runtime: { id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }, app: { isInstalled: false } };

    // 6. Base64
    context.atob = nativize((i) => Buffer.from(String(i), 'base64').toString('binary'), 'atob');
    context.btoa = nativize((i) => Buffer.from(String(i), 'binary').toString('base64'), 'btoa');

    // 7. Intl
    context.Intl = Intl;

    // 8. 实例化并绑定到 rawWindow (供内部逻辑使用)
    rawWindow.navigator = new context.Navigator(profile, context);
    rawWindow.chrome = context.chrome;
};