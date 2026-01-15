class MimeType {
    constructor(type, description, suffixes, enabledPlugin) {
        this.type = type;
        this.description = description;
        this.suffixes = suffixes;
        this.enabledPlugin = enabledPlugin;
    }
}

class MimeTypeArray {
    constructor(plugins) {
        // 基于插件生成 MimeTypes
        this._data = [
            new MimeType("application/pdf", "Portable Document Format", "pdf", plugins.item(0)),
            new MimeType("text/pdf", "Portable Document Format", "pdf", plugins.item(0))
        ];
    }

    get length() {
        return this._data.length;
    }

    item(index) {
        return this._data[index];
    }

    namedItem(name) {
        return this._data.find(m => m.type === name) || null;
    }

    [Symbol.iterator]() {
        return this._data.values();
    }
}

module.exports = MimeTypeArray;