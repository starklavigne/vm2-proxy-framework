/**
 * 代理工厂：负责生成这就监控能力的 Proxy 对象
 */
class ProxyFactory {
    constructor(config = {}) {
        this.enableLog = config.enableLog || false;
    }

    create(target, name = "root") {
        // 1. 检查目标是否已经是代理
        // 这里通过访问 __isProxy 触发 get 拦截器，如果返回 true 说明已经是我们包装过的
        if (target && target.__isProxy) return target;

        const handler = {
            get: (target, prop, receiver) => {
                // --- A. 身份识别 (虚拟属性) ---
                // 【核心修复】不需要 defineProperty，直接在这里拦截返回 true 即可
                if (prop === '__isProxy' || prop === '_isProxy') return true;

                // --- B. 动态接收器 (解决 window === window.window) ---
                if (prop === 'window' || prop === 'self' || prop === 'top' || prop === 'parent' || prop === 'globalThis') {
                    return receiver;
                }

                // --- C. 排除干扰 ---
                if (prop === Symbol.toPrimitive) return undefined;
                if (typeof prop === 'symbol') return Reflect.get(target, prop, receiver);
                if (prop === 'prototype') return Reflect.get(target, prop, receiver);

                // 获取真实值
                let value;
                try {
                    value = Reflect.get(target, prop, receiver);
                } catch (e) {
                    // 防止某些 getter 报错导致中断
                    return undefined;
                }

                // --- D. 原生函数放行 ---
                // 解决 "TypeError: Illegal invocation" 的关键
                if (typeof value === 'function' && /native code/.test(value.toString())) {
                    // 特殊处理：如果是 bind/call/apply，可能需要绑定原始 target
                    // 但通常直接返回 value 最稳妥
                    return value;
                }

                // --- E. 日志记录 ---
                if (this.enableLog && prop !== 'toString' && prop !== 'toJSON') {
                    if (value !== undefined) {
                        // 限制日志长度，防止大对象刷屏
                         console.log(`[读] ${name}.${String(prop)}`);
                    }
                }

                // --- F. 递归代理 ---
                if (value && (typeof value === 'object' || typeof value === 'function')) {
                    // 如果已经是代理，直接返回
                    if (value.__isProxy) return value;
                    // 递归创建
                    return this.create(value, `${name}.${String(prop)}`);
                }

                return value;
            },
            set: (target, prop, value, receiver) => {
                if (this.enableLog) {
                    console.log(`[写] ${name}.${String(prop)} = ${String(value).substring(0, 50)}`);
                }
                return Reflect.set(target, prop, value, receiver);
            },
            // 拦截 defineProperty 防止外部检测或修改
            defineProperty: (target, prop, descriptor) => {
                return Reflect.defineProperty(target, prop, descriptor);
            },
            // 拦截 delete
            deleteProperty: (target, prop) => {
                if (this.enableLog) console.log(`[删] ${name}.${String(prop)}`);
                return Reflect.deleteProperty(target, prop);
            }
        };

        const proxy = new Proxy(target, handler);

        // 【已删除】Object.defineProperty(proxy, '__isProxy', ...)
        // 这行代码是万恶之源，删除它！

        return proxy;
    }
}

module.exports = ProxyFactory;