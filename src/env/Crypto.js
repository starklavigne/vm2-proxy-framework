const {webcrypto, randomFillSync} = require('crypto');

// SubtleCrypto：直接委托给 Node 真实 webcrypto.subtle。
// 旧实现把 digest/sign/encrypt 全 stub 成 0 长度 / 全 0 buffer，
// challenge 里任何一处 SHA-256（PoW / payload 签名）都会算出全 0 → 服务端必拒。
// 用 Proxy 包一层：保留 Symbol.toStringTag('SubtleCrypto')，同时把方法 bind 到真实 subtle，
// 兼容 `crypto.subtle.digest(...)` 和解构后裸调 `const d = crypto.subtle.digest; d(...)` 两种写法。
const realSubtle = webcrypto.subtle;
const boundSubtle = new Proxy(realSubtle, {
    get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver);
        return typeof value === 'function' ? value.bind(target) : value;
    }
});

class Crypto {
    constructor() {
        // 1. 随机数生成 (保留 DataView 强力修复)
        this.getRandomValues = (array) => {
            if (!array) return array;

            // 尝试标准 API (过滤掉 DataView)
            if (array.byteLength !== undefined && array.constructor.name !== 'DataView') {
                try {
                    webcrypto.getRandomValues(array);
                    return array;
                } catch (e) {
                }
            }

            // 兜底内存填充
            try {
                if (array.buffer) {
                    const view = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
                    randomFillSync(view);
                }
            } catch (e) {
                console.error('[Crypto] Random failed:', e.message);
            }
            return array;
        };

        this.randomUUID = () => webcrypto && webcrypto.randomUUID ? webcrypto.randomUUID() : "10000000-1000-4000-8000-100000000000";

        // 2. 绑定真实 SubtleCrypto（不再 stub）
        this.subtle = boundSubtle;
    }

    get [Symbol.toStringTag]() {
        return "Crypto";
    }
}

module.exports = Crypto;
