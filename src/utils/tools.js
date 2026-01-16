const nativize = (func, name) => {
    if (typeof func !== 'function') func = () => {
    };
    const funcName = name || func.name || '';
    const nativeString = `function ${funcName}() { [native code] }`;
    Object.defineProperty(func, 'toString', {
        value: () => nativeString,
        writable: true,
        configurable: true,
        enumerable: false
    });
    if (func.prototype) {
        Object.defineProperty(func.prototype.constructor, 'name', {
            value: funcName,
            writable: false,
            configurable: true
        });
    }
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