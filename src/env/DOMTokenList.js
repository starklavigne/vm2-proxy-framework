class DOMTokenList {
    constructor(element) {
        this._element = element;
        this._tokens = new Set();
    }

    add(...tokens) {
        tokens.forEach(t => this._tokens.add(String(t)));
        this._update();
    }

    remove(...tokens) {
        tokens.forEach(t => this._tokens.delete(String(t)));
        this._update();
    }

    contains(token) {
        return this._tokens.has(String(token));
    }

    toggle(token, force) {
        if (force !== undefined) {
            return force ? (this.add(token), true) : (this.remove(token), false);
        }
        if (this.contains(token)) {
            this.remove(token);
            return false;
        } else {
            this.add(token);
            return true;
        }
    }

    replace(oldToken, newToken) {
        if (this._tokens.delete(oldToken)) {
            this._tokens.add(newToken);
            this._update();
            return true;
        }
        return false;
    }

    item(index) {
        return Array.from(this._tokens)[index] || null;
    }

    get length() {
        return this._tokens.size;
    }

    // 设置 value 属性 (如 el.classList.value = 'a b')
    get value() {
        return this.toString();
    }

    set value(v) {
        this._tokens.clear();
        String(v).split(/\s+/).forEach(t => {
            if (t) this._tokens.add(t);
        });
        this._update();
    }

    toString() {
        return Array.from(this._tokens).join(' ');
    }

    _update() {
        // 同步回元素属性 (如果需要)
    }

    // 【核心修复】迭代方法补全
    [Symbol.iterator]() {
        return this._tokens.values();
    }

    entries() {
        return this._tokens.entries();
    }

    keys() {
        return this._tokens.keys();
    }

    values() {
        return this._tokens.values();
    }

    forEach(callback, thisArg) {
        this._tokens.forEach((val, val2, set) => {
            callback.call(thisArg, val, val, this);
        });
    }
}

module.exports = DOMTokenList;