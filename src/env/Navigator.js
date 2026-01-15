const {PluginArray} = require('./PluginArray');
const MimeTypeArray = require('./MimeTypeArray');

class Navigator {
    // 【修复】增加默认值 = {}，防止传空时报错
    constructor(profile = {}) {
        this.userAgent = profile.userAgent || 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
        this.appCodeName = 'Mozilla';
        this.appName = 'Netscape';
        this.appVersion = this.userAgent.replace('Mozilla/', '');
        this.platform = profile.platform || 'MacIntel';
        this.product = 'Gecko';
        this.productSub = '20030107';
        this.vendor = 'Google Inc.';
        this.vendorSub = '';
        this.language = 'zh-CN';
        this.languages = ['zh-CN', 'zh', 'en-US', 'en'];
        this.cookieEnabled = true;
        this.onLine = true;
        this.hardwareConcurrency = 8;
        this.deviceMemory = 8;
        this.maxTouchPoints = 0;
        this.doNotTrack = null;
        this.pdfViewerEnabled = true;

        this.plugins = new PluginArray();
        this.mimeTypes = new MimeTypeArray(this.plugins);

        this.permissions = {
            query: (desc) => Promise.resolve({state: 'granted', onchange: null})
        };

        this.connection = {
            effectiveType: '4g',
            rtt: 50,
            downlink: 10,
            saveData: false,
            onchange: null,
            addEventListener: () => {
            },
            removeEventListener: () => {
            }
        };

        this.mediaCapabilities = {
            decodingInfo: (cfg) => Promise.resolve({supported: true, smooth: true, powerEfficient: true})
        };

        this.userActivation = {
            hasBeenActive: false,
            isActive: false
        };

        this.clipboard = {
            readText: () => Promise.resolve(''),
            writeText: () => Promise.resolve()
        };

        this.locks = {
            request: () => Promise.resolve()
        };

        this.scheduling = {
            isInputPending: () => false
        };

        // 关键：webdriver 必须是 false 或 undefined，不能是 true
        this.webdriver = false;
    }

    javaEnabled() {
        return false;
    }

    sendBeacon() {
        return true;
    }

    vibrate() {
        return true;
    }
}

module.exports = Navigator;