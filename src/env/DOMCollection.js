class DOMCollection extends Array {
    constructor(items = []) {
        super(...items);
        // 为了兼容 instanceof 检查，虽然后面会由 Proxy 包装
        this._isDOMCollection = true;
    }

    item(index) {
        return this[index] || null;
    }

    namedItem(name) {
        for (let i = 0; i < this.length; i++) {
            const el = this[i];
            if (el.id === name || el.name === name) {
                return el;
            }
        }
        return null;
    }
}

class NodeList extends DOMCollection {
}

class HTMLCollection extends DOMCollection {
}

module.exports = {DOMCollection, NodeList, HTMLCollection};