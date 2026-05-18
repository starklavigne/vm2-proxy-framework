class ProxyFactory {
    constructor(config = {}) {
        this.enableLog = config.enableLog || false;
        this.hiddenProps = new Set(['_context', '_children', '_attributes', '_parentNode', '_uid']);
        this.noopMethods = new Set([
            'appendChild', 'insertBefore', 'removeChild', 'replaceChild', 'remove',
            'addEventListener', 'removeEventListener', 'dispatchEvent',
            'focus', 'blur', 'click', 'querySelector', 'querySelectorAll'
        ]);
        this.unboundWindowFunctions = new Set([
            'Object', 'Function', 'Array', 'String', 'Number', 'Boolean', 'RegExp',
            'Date', 'Promise', 'Symbol', 'Proxy', 'WeakMap', 'WeakSet', 'Map', 'Set',
            'DataView', 'ArrayBuffer', 'Uint8Array', 'Int8Array', 'Uint16Array',
            'Int16Array', 'Uint32Array', 'Int32Array', 'Float32Array', 'Float64Array',
            'Uint8ClampedArray', 'Error', 'TypeError', 'EvalError', 'RangeError',
            'ReferenceError', 'SyntaxError', 'URIError', 'TextEncoder', 'TextDecoder',
            'URL', 'URLSearchParams', 'Blob', 'FileReader', 'Worker', 'Event',
            'MouseEvent', 'KeyboardEvent', 'CustomEvent', 'DOMException',
            'MutationObserver', 'AbortSignal', 'AbortController', 'Storage',
            'Document', 'Window', 'EventTarget', 'Node', 'Element', 'HTMLElement',
            'HTMLCollection', 'NodeList', 'DOMCollection', 'HTMLDivElement',
            'HTMLCanvasElement', 'HTMLFormElement', 'HTMLInputElement',
            'HTMLButtonElement', 'HTMLAnchorElement', 'HTMLImageElement',
            'HTMLScriptElement', 'HTMLBodyElement', 'HTMLHeadElement',
            'HTMLHtmlElement', 'HTMLIFrameElement', 'HTMLSpanElement',
            'HTMLAudioElement', 'HTMLVideoElement', 'DOMParser', 'Request',
            'Response', 'Audio', 'AudioContext', 'OfflineAudioContext',
            'webkitAudioContext', 'webkitOfflineAudioContext', 'RTCPeerConnection',
            'RTCSessionDescription', 'RTCIceCandidate', 'webkitRTCPeerConnection'
        ]);
    }

    create(target, name = "root") {
        if (target && target.__isProxy) return target;

        const handler = {
            get: (target, prop, receiver) => {
                if (prop === '__isProxy' || prop === '_isProxy') return true;
                if (this.hiddenProps.has(prop)) return undefined;
                if (prop === 'window' || prop === 'self' || prop === 'top' || prop === 'parent' || prop === 'globalThis') {
                    return receiver;
                }
                if (prop === Symbol.toPrimitive) return undefined;
                if (typeof prop === 'symbol') return Reflect.get(target, prop, receiver);
                if (prop === 'prototype') return Reflect.get(target, prop, receiver);

                if (typeof target === 'function' && (prop === 'apply' || prop === 'call' || prop === 'bind')) {
                    return Function.prototype[prop].bind(target);
                }

                const value = Reflect.get(target, prop, receiver);
                if (prop === 'XHwg6' && value && (typeof value === 'object' || typeof value === 'function')) {
                    if (typeof value.querySelector !== 'function') {
                        value.querySelector = function () { return null; };
                    }
                    if (typeof value.querySelectorAll !== 'function') {
                        value.querySelectorAll = function () { return []; };
                    }
                    return value;
                }
                if ((prop === 'querySelector' || prop === 'querySelectorAll') && typeof value !== 'function') {
                    return function () {
                        return prop === 'querySelector' ? null : [];
                    };
                }
                if (value === undefined && this.noopMethods.has(prop)) {
                    return function () {
                        if (prop === 'querySelector') return null;
                        if (prop === 'querySelectorAll') return [];
                        return arguments[0] || null;
                    };
                }

                if (typeof value === 'function') {
                    if (name === 'window' && this.unboundWindowFunctions.has(prop)) {
                        return value;
                    }
                    const bound = value.bind(target);
                    if (/native code/.test(value.toString())) {
                        Object.defineProperty(bound, 'toString', {
                            value: () => value.toString(),
                            configurable: true
                        });
                    }
                    return bound;
                }

                if (this.enableLog && prop !== 'toString' && prop !== 'toJSON' && typeof prop === 'string') {
                    if (value !== undefined) {
                         console.log(`[读] ${name}.${String(prop)}`);
                    }
                }

                if (value && (typeof value === 'object' || typeof value === 'function')) {
                    if (value.__isProxy) return value;
                    return this.create(value, `${name}.${String(prop)}`);
                }

                return value;
            },
            set: (target, prop, value, receiver) => {
                if (prop === 'XHwg6' && value && (typeof value === 'object' || typeof value === 'function')) {
                    if (typeof value.querySelector !== 'function') {
                        value.querySelector = function () { return null; };
                    }
                    if (typeof value.querySelectorAll !== 'function') {
                        value.querySelectorAll = function () { return []; };
                    }
                }
                if (this.enableLog) {
                    console.log(`[写] ${name}.${String(prop)} = ${String(value).substring(0, 50)}`);
                }
                return Reflect.set(target, prop, value, receiver);
            },
            ownKeys: (target) => {
                return Reflect.ownKeys(target).filter((prop) => !this.hiddenProps.has(prop));
            },
            // 【核心修复】确保属性描述符总是存在且可枚举
            // 解决 Object.assign 或 spread 操作符无法复制属性的问题
            getOwnPropertyDescriptor: (target, prop) => {
                if (this.hiddenProps.has(prop)) return undefined;
                const desc = Reflect.getOwnPropertyDescriptor(target, prop);
                if (desc) return desc;
                // 如果 Reflect 没取到，但对象上确实有这个属性（可能是原型链上的），手动构造描述符
                if (Reflect.has(target, prop)) {
                    return {
                        configurable: true,
                        enumerable: true, // 必须为 true，否则 Object.keys 读不到
                        writable: true,
                        value: target[prop]
                    };
                }
                return undefined;
            },
            deleteProperty: (target, prop) => {
                if (this.enableLog) console.log(`[删] ${name}.${String(prop)}`);
                return Reflect.deleteProperty(target, prop);
            }
        };

        return new Proxy(target, handler);
    }
}

module.exports = ProxyFactory;
