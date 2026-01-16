const nativize = (func, alias) => {
    // 如果不是函数，直接返回
    if (typeof func !== 'function') return func;

    const funcName = alias || func.name || '';
    const nativeString = `function ${funcName}() { [native code] }`;

    // 1. 劫持 toString
    // 使用 defineProperty 而不是直接赋值，模拟原生属性的 Descriptor
    Object.defineProperty(func, 'toString', {
        value: function () {
            return nativeString;
        },
        writable: true,
        configurable: true,
        enumerable: false // toString 方法本身是不可枚举的
    });

    // 2. 伪装 toString 的 toString
    // 防止检测脚本运行: func.toString.toString()
    Object.defineProperty(func.toString, 'toString', {
        value: function () {
            return "function toString() { [native code] }";
        },
        writable: true,
        configurable: true,
        enumerable: false
    });

    // 3. 修正函数名 (name)
    // 原生函数的 name 属性通常不可写，但可配置
    Object.defineProperty(func, 'name', {
        value: funcName,
        writable: false,
        enumerable: false,
        configurable: true
    });

    return func;
};

const cookieJar = {
    cookies: new Map(),
    getCookieString(url) {
        const list = [];
        this.cookies.forEach((val, key) => list.push(`${key}=${val}`));
        return list.join('; ');
    },
    setCookie(setCookieHeader) {
        if (!setCookieHeader) return;
        const cookies = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
        cookies.forEach(str => {
            const part = str.split(';')[0];
            const [key, val] = part.split('=');
            if (key) this.cookies.set(key.trim(), val);
        });
    }
};

module.exports = {nativize, cookieJar};