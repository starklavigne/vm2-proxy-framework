const {webcrypto, randomFillSync} = require('crypto');

// 模拟一个完美的密钥对象
const MOCK_KEY = {
    type: 'secret',
    extractable: true,
    algorithm: {name: 'AES-CBC', length: 256},
    usages: ['encrypt', 'decrypt', 'sign', 'verify', 'deriveKey', 'deriveBits', 'wrapKey', 'unwrapKey']
};

class SubtleCrypto {
    async encrypt(algorithm, key, data) {
        return new ArrayBuffer(0);
    }

    async decrypt(algorithm, key, data) {
        return new ArrayBuffer(0);
    }

    async sign(algorithm, key, data) {
        return new ArrayBuffer(0);
    }

    async verify(algorithm, key, signature, data) {
        return true;
    }

    async digest(algorithm, data) {
        return new Uint8Array(32).buffer;
    } // SHA-256 长度

    async generateKey(algorithm, extractable, keyUsages) {
        return MOCK_KEY;
    }

    async importKey(format, keyData, algorithm, extractable, keyUsages) {
        return MOCK_KEY;
    }

    async exportKey(format, key) {
        return new ArrayBuffer(0);
    }

    async deriveKey(algorithm, baseKey, derivedKeyType, extractable, keyUsages) {
        return MOCK_KEY;
    }

    async deriveBits(algorithm, baseKey, length) {
        return new ArrayBuffer(length ? length / 8 : 32);
    }

    async wrapKey(format, key, wrappingKey, wrapAlgorithm) {
        return new ArrayBuffer(0);
    }

    async unwrapKey(format, wrappedKey, unwrappingKey, unwrapAlgorithm, unwrappedKeyAlgorithm, extractable, keyUsages) {
        return MOCK_KEY;
    }
}

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

        // 2. 绑定 SubtleCrypto
        // 我们直接使用自定义的 SubtleCrypto 类，不依赖原生，防止算法不兼容导致的 Promise Reject
        this.subtle = new SubtleCrypto();
    }

    get [Symbol.toStringTag]() {
        return "Crypto";
    }
}

module.exports = Crypto;