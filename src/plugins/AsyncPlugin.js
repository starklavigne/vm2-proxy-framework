const {nativize} = require('../utils/tools');
const EventTarget = require('../env/EventTarget');

// 修复后的 MessageChannel (支持 EventTarget)
class MessagePort extends EventTarget {
    constructor() {
        super();
        this._otherPort = null;
        this.onmessage = null;
    }

    postMessage(data) {
        if (this._otherPort) {
            setTimeout(() => {
                const event = {type: 'message', data: data, target: this._otherPort, ports: []};
                this._otherPort.dispatchEvent(event);
                if (typeof this._otherPort.onmessage === 'function') {
                    this._otherPort.onmessage(event);
                }
            }, 0);
        }
    }

    start() {
    }

    close() {
    }
}

class MessageChannel {
    constructor() {
        this.port1 = new MessagePort();
        this.port2 = new MessagePort();
        this.port1._otherPort = this.port2;
        this.port2._otherPort = this.port1;
    }
}

module.exports = function (context, rawWindow) {
    context.MessageChannel = nativize(MessageChannel, 'MessageChannel');
    context.MessagePort = nativize(MessagePort, 'MessagePort');
    rawWindow.MessageChannel = context.MessageChannel;
    rawWindow.MessagePort = context.MessagePort;

    // 定时器封装
    const timerMap = new Map();
    let timerIdCounter = 1;
    const reportAsyncError = (error) => {
        const message = error && error.message ? error.message : String(error);
        if (
            message.includes('g9[Vt(...)][Vt(...)][Vt(...)] is not a function') ||
            message.includes('this[VH(...)] is not a function')
        ) {
            return;
        }
        const event = {
            type: 'error',
            message,
            error,
            filename: 'target/target.js',
            lineno: 0,
            colno: 0
        };
        if (typeof rawWindow.onerror === 'function') {
            const handled = rawWindow.onerror(event.message, event.filename, event.lineno, event.colno, error);
            if (handled === true) return;
        }
        if (typeof rawWindow.dispatchEvent === 'function') rawWindow.dispatchEvent(event);
        console.log(`[AsyncPlugin] timer callback error: ${event.message}`);
    };

    context.setTimeout = nativize((cb, delay, ...args) => {
        const id = timerIdCounter++;
        const timer = setTimeout(() => {
            timerMap.delete(id);
            try {
                if (typeof cb === 'function') {
                    cb(...args);
                } else if (cb != null) {
                    const source = String(cb);
                    if (typeof rawWindow.eval === 'function') rawWindow.eval(source);
                    else Function(source)();
                }
            } catch (error) {
                reportAsyncError(error);
            }
        }, delay);
        timerMap.set(id, timer);
        return id;
    }, 'setTimeout');
    rawWindow.setTimeout = context.setTimeout;

    context.clearTimeout = nativize((id) => {
        const timer = timerMap.get(id);
        if (timer) {
            clearTimeout(timer);
            timerMap.delete(id);
        }
    }, 'clearTimeout');
    rawWindow.clearTimeout = context.clearTimeout;

    context.setInterval = nativize((cb, delay, ...args) => setInterval(() => {
        try {
            if (typeof cb === 'function') cb(...args);
            else if (cb != null) {
                const source = String(cb);
                if (typeof rawWindow.eval === 'function') rawWindow.eval(source);
                else Function(source)();
            }
        } catch (error) {
            reportAsyncError(error);
        }
    }, delay), 'setInterval');
    context.clearInterval = nativize(clearInterval, 'clearInterval');
    rawWindow.setInterval = context.setInterval;
    rawWindow.clearInterval = context.clearInterval;

    // RequestAnimationFrame
    const perfStart = Date.now();
    context.requestAnimationFrame = nativize((cb) => setTimeout(() => cb(Date.now() - perfStart), 16), 'requestAnimationFrame');
    context.cancelAnimationFrame = nativize(clearTimeout, 'cancelAnimationFrame');
    rawWindow.requestAnimationFrame = context.requestAnimationFrame;
    rawWindow.cancelAnimationFrame = context.cancelAnimationFrame;

    // Microtask
    context.queueMicrotask = nativize((cb) => Promise.resolve().then(cb), 'queueMicrotask');
    rawWindow.queueMicrotask = context.queueMicrotask;
};
