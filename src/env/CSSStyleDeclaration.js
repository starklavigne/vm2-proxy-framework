const toCamelCase = (str) => str.replace(/-([a-z])/g, (g) => g[1].toUpperCase());
const toKebabCase = (str) => str.replace(/([A-Z])/g, '-$1').toLowerCase();

class CSSStyleDeclaration {
    constructor(element) {
        this._values = new Map();
        this._element = element;
        this.length = 0;
        this.parentRule = null;
    }

    // 核心方法：getPropertyValue
    getPropertyValue(property) {
        return this._values.get(property) || '';
    }

    // 核心方法：setProperty
    setProperty(property, value, priority = '') {
        if (!value) {
            this.removeProperty(property);
            return;
        }
        this._values.set(property, String(value));
        // 同时更新 CamelCase 属性 (例如 background-color -> backgroundColor)
        this[toCamelCase(property)] = String(value);
        this._updateStyleString();
    }

    // 核心方法：removeProperty
    removeProperty(property) {
        const value = this._values.get(property);
        this._values.delete(property);
        delete this[toCamelCase(property)];
        this._updateStyleString();
        return value || '';
    }

    item(index) {
        return Array.from(this._values.keys())[index] || '';
    }

    get cssText() {
        let text = '';
        for (const [key, val] of this._values) {
            text += `${key}: ${val}; `;
        }
        return text;
    }

    set cssText(text) {
        this._values.clear();
        // 简易解析: "color: red; background: blue"
        if (typeof text === 'string') {
            text.split(';').forEach(part => {
                const [key, ...vals] = part.split(':');
                if (key && vals.length > 0) {
                    this.setProperty(key.trim(), vals.join(':').trim());
                }
            });
        }
    }

    _updateStyleString() {
        // 如果需要同步回 element 的 style 属性字符串，可以在这里做
    }
}

// 使用 Proxy 来支持 style.backgroundColor 这种直接访问
const createStyleProxy = (element) => {
    const style = new CSSStyleDeclaration(element);

    return new Proxy(style, {
        get: (target, prop) => {
            // 优先返回 target 上的方法 (getPropertyValue 等)
            if (prop in target) {
                const val = target[prop];
                if (typeof val === 'function') {
                    return val.bind(target);
                }
                return val;
            }
            // 尝试作为 CSS 属性读取
            if (typeof prop === 'string') {
                return target.getPropertyValue(toKebabCase(prop));
            }
            return undefined;
        },
        set: (target, prop, value) => {
            if (prop === 'cssText') {
                target.cssText = value;
                return true;
            }
            // 作为 CSS 属性写入
            if (typeof prop === 'string') {
                target.setProperty(toKebabCase(prop), value);
                return true;
            }
            return Reflect.set(target, prop, value);
        }
    });
};

module.exports = createStyleProxy;