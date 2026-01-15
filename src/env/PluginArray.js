class Plugin {
    constructor(name, filename, description) {
        this.name = name;
        this.filename = filename;
        this.description = description;
    }

    // 关键：Mock Length
    get length() {
        return 1;
    }

    item(index) {
        return null;
    }

    namedItem(name) {
        return null;
    }
}

class PluginArray {
    constructor() {
        this._data = [
            new Plugin("PDF Viewer", "internal-pdf-viewer", "Portable Document Format"),
            new Plugin("Chrome PDF Viewer", "internal-pdf-viewer", "Portable Document Format"),
            new Plugin("Chromium PDF Viewer", "internal-pdf-viewer", "Portable Document Format"),
            new Plugin("Microsoft Edge PDF Viewer", "internal-pdf-viewer", "Portable Document Format"),
            new Plugin("WebKit built-in PDF", "internal-pdf-viewer", "Portable Document Format")
        ];
    }

    get length() {
        return this._data.length;
    }

    item(index) {
        return this._data[index];
    }

    namedItem(name) {
        return this._data.find(p => p.name === name) || null;
    }

    refresh() {
    }

    // 迭代器支持
    [Symbol.iterator]() {
        return this._data.values();
    }
}

module.exports = {PluginArray, Plugin};