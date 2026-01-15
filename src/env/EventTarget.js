class EventTarget {
    constructor() {
        this._listeners = {};
    }

    addEventListener(type, callback, options) {
        if (!type || !callback) return;
        if (!this._listeners[type]) this._listeners[type] = [];
        // 简单去重
        if (!this._listeners[type].includes(callback)) {
            this._listeners[type].push(callback);
        }
    }

    removeEventListener(type, callback) {
        if (!this._listeners[type]) return;
        const index = this._listeners[type].indexOf(callback);
        if (index !== -1) {
            this._listeners[type].splice(index, 1);
        }
    }

    dispatchEvent(event) {
        if (!event || !event.type) return false;

        // 确保 event.target 指向当前对象
        if (!event.target) {
            try {
                event.target = this;
            } catch (e) {
            } // target 可能是只读的
        }

        const listeners = this._listeners[event.type] || [];
        // 也就是 onclick, onmessage 这种
        const onHandler = this['on' + event.type];

        if (typeof onHandler === 'function') {
            try {
                onHandler.call(this, event);
            } catch (e) {
            }
        }

        listeners.forEach(listener => {
            try {
                if (typeof listener === 'function') {
                    listener.call(this, event);
                } else if (listener && typeof listener.handleEvent === 'function') {
                    listener.handleEvent(event);
                }
            } catch (e) {
                console.error('[EventTarget] Error in listener:', e);
            }
        });
        return !event.defaultPrevented;
    }
}

module.exports = EventTarget;