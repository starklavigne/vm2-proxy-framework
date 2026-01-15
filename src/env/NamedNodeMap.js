// 模拟element.attributes
class NamedNodeMap {
    constructor(attributesObj) {
        this._attributes = attributesObj;
    }

    get length() {
        return Object.keys(this._attributes).length;
    }

    item(index) {
        const key = Object.keys(this._attributes)[index];
        if (!key) return null;
        return {
            name: key,
            value: this._attributes[key],
            specified: true
        };
    }

    getNamedItem(key) {
        if (this._attributes[key] === undefined) return null;
        return {
            name: key,
            value: this._attributes[key],
            specified: true
        };
    }

    // 让它可以被遍历
    [Symbol.iterator]() {
        let index = 0;
        const keys = Object.keys(this._attributes);
        return {
            next: () => {
                if (index < keys.length) {
                    return {value: this.item(index++), done: false};
                }
                return {done: true};
            }
        };
    }
}

module.exports = NamedNodeMap;