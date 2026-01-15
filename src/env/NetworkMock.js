class Headers {
    constructor(init) {
        this._map = new Map();
        if (init) {
            for (const key in init) {
                this.append(key, init[key]);
            }
        }
    }
    append(key, value) {
        this._map.set(key.toLowerCase(), String(value));
    }
    set(key, value) {
        this._map.set(key.toLowerCase(), String(value));
    }
    get(key) {
        return this._map.get(key.toLowerCase()) || null;
    }
    has(key) {
        return this._map.has(key.toLowerCase());
    }
    delete(key) {
        this._map.delete(key.toLowerCase());
    }
    forEach(callback, thisArg) {
        this._map.forEach((value, key) => {
            callback.call(thisArg, value, key, this);
        });
    }
}

class FormData {
    constructor() {
        this._entries = [];
    }
    append(key, value) {
        this._entries.push([key, value]);
    }
    get(key) {
        const entry = this._entries.find(e => e[0] === key);
        return entry ? entry[1] : null;
    }
    getAll(key) {
        return this._entries.filter(e => e[0] === key).map(e => e[1]);
    }
    has(key) {
        return this._entries.some(e => e[0] === key);
    }
    delete(key) {
        this._entries = this._entries.filter(e => e[0] !== key);
    }
    toString() {
        return '[object FormData]';
    }
}

class Blob {
    constructor(parts, options) {
        this.size = 0;
        this.type = options?.type || "";
        if (parts) {
            parts.forEach(p => {
                if (typeof p === 'string') this.size += p.length;
                else if (p.byteLength) this.size += p.byteLength;
            });
        }
    }
    slice() {
        return new Blob([], { type: this.type });
    }
}

class FileReader {
    constructor() {
        this.onload = null;
        this.onerror = null;
        this.result = null;
    }
    readAsDataURL(blob) {
        setTimeout(() => {
            this.result = "data:application/octet-stream;base64,";
            if (this.onload) this.onload({ target: this });
        }, 10);
    }
}

// 【关键新增】XMLHttpRequest 模拟
class XMLHttpRequest {
    constructor() {
        // 0: UNSENT, 1: OPENED, 2: HEADERS_RECEIVED, 3: LOADING, 4: DONE
        this.readyState = 0;
        this.status = 0;
        this.statusText = "";
        this.response = "";
        this.responseText = "";
        this.responseType = "";
        this.responseURL = "";
        this.onreadystatechange = null;
        this.onload = null;
        this.onerror = null;
        this.withCredentials = false;
        this._headers = {};
    }

    open(method, url) {
        this.readyState = 1;
        if (this.onreadystatechange) this.onreadystatechange();
    }

    send(data) {
        // 模拟异步请求成功
        setTimeout(() => {
            this.readyState = 4;
            this.status = 200;
            this.responseText = "{}";
            if (this.onreadystatechange) this.onreadystatechange();
            if (this.onload) this.onload();
        }, 50);
    }

    setRequestHeader(k, v) {
        this._headers[k] = v;
    }

    getAllResponseHeaders() {
        return "";
    }

    getResponseHeader(k) {
        return null;
    }
}

module.exports = {
    Headers,
    FormData,
    Blob,
    FileReader,
    XMLHttpRequest // 导出它
};