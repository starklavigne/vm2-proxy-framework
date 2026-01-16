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

    // 定时器封装
    const timerMap = new Map();
    let timerIdCounter = 1;

    context.setTimeout = nativize((cb, delay, ...args) => {
        const id = timerIdCounter++;
        const timer = setTimeout(() => {
            timerMap.delete(id);
            cb(...args);
        }, delay);
        timerMap.set(id, timer);
        return id;
    }, 'setTimeout');

    context.clearTimeout = nativize((id) => {
        const timer = timerMap.get(id);
        if (timer) {
            clearTimeout(timer);
            timerMap.delete(id);
        }
    }, 'clearTimeout');

    context.setInterval = nativize(setInterval, 'setInterval');
    context.clearInterval = nativize(clearInterval, 'clearInterval');

    // RequestAnimationFrame
    const perfStart = Date.now();
    context.requestAnimationFrame = nativize((cb) => setTimeout(() => cb(Date.now() - perfStart), 16), 'requestAnimationFrame');
    context.cancelAnimationFrame = nativize(clearTimeout, 'cancelAnimationFrame');

    // Microtask
    context.queueMicrotask = nativize((cb) => Promise.resolve().then(cb), 'queueMicrotask');
};