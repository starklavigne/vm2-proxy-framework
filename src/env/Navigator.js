// src/env/Navigator.js
const { PluginArray } = require('./PluginArray');
const MimeTypeArray = require('./MimeTypeArray');
const { nativize } = require('../utils/tools');

// 定义私有数据存储的 WeakMap，防止被遍历发现
const privateData = new WeakMap();

class Navigator {
    constructor(profile = {}, context = {}) {
        // 将配置数据存储在 WeakMap 中，保持实例干净
        privateData.set(this, {
            profile,
            context,
            plugins: new PluginArray(),
            mimeTypes: null // 稍后初始化
        });

        // 初始化 mimeTypes (依赖 plugins)
        const data = privateData.get(this);
        data.mimeTypes = new MimeTypeArray(data.plugins);
    }

    // ==========================================
    // 1. 原型链属性 (Prototype Properties)
    // 所有的属性都改为 Getter，这样它们位于 Navigator.prototype
    // ==========================================

    get userAgent() {
        // 从配置中读取，或者使用默认的高频 UserAgent
        return privateData.get(this).profile.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    }

    get platform() {
        const ua = this.userAgent;
        if (ua.includes('Win')) return 'Win32';
        if (ua.includes('Mac')) return 'MacIntel';
        return 'Linux x86_64';
    }

    get appCodeName() { return 'Mozilla'; }
    get appName() { return 'Netscape'; }
    get appVersion() { return this.userAgent.replace('Mozilla/', ''); }
    get product() { return 'Gecko'; }
    get productSub() { return '20030107'; }
    get vendor() { return 'Google Inc.'; }
    get vendorSub() { return ''; }
    get language() { return 'zh-CN'; }
    get languages() { return ['zh-CN', 'zh', 'en-US', 'en']; }
    get cookieEnabled() { return true; }
    get onLine() { return true; }
    get hardwareConcurrency() { return 8; }
    get deviceMemory() { return 8; }
    get maxTouchPoints() { return 0; }
    get doNotTrack() { return null; }
    get pdfViewerEnabled() { return true; }

    // 关键：webdriver 必须是 false (不是 undefined)
    get webdriver() { return false; }

    // ==========================================
    // 2. 复杂对象关联
    // ==========================================
    get plugins() { return privateData.get(this).plugins; }
    get mimeTypes() { return privateData.get(this).mimeTypes; }

    get connection() {
        return {
            effectiveType: '4g',
            rtt: 50,
            downlink: 10,
            saveData: false,
            onchange: null,
            addEventListener: nativize(() => {}, 'addEventListener'),
            removeEventListener: nativize(() => {}, 'removeEventListener')
        };
    }

    get permissions() {
        return {
            query: nativize(async (desc) => ({ state: 'granted', onchange: null }), 'query')
        };
    }

    get mediaCapabilities() {
        return {
            decodingInfo: nativize((cfg) => Promise.resolve({ supported: true, smooth: true, powerEfficient: true }), 'decodingInfo')
        };
    }

    get userActivation() {
        return { hasBeenActive: false, isActive: false };
    }

    get clipboard() {
        return {
            readText: nativize(() => Promise.resolve(''), 'readText'),
            writeText: nativize(() => Promise.resolve(), 'writeText')
        };
    }

    get locks() {
        return { request: nativize(() => Promise.resolve(), 'request') };
    }

    get scheduling() {
        return { isInputPending: nativize(() => false, 'isInputPending') };
    }

    // ==========================================
    // 3. 方法 (Methods)
    // ==========================================
    javaEnabled() { return false; }
    sendBeacon() { return true; }
    vibrate() { return true; }

    // ==========================================
    // 4. 核心伪装：Symbol.toStringTag
    // ==========================================
    get [Symbol.toStringTag]() {
        return 'Navigator';
    }
}

// 批量 Nativize 原型方法
['javaEnabled', 'sendBeacon', 'vibrate'].forEach(method => {
    Navigator.prototype[method] = nativize(Navigator.prototype[method], method);
});

module.exports = Navigator;