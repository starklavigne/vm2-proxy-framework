class ProxyFactory {
    constructor(config = {}) {
        this.enableLog = config.enableLog || false;
        this.silentLogProps = new Set(config.silentLogProps || [
            'window.puQFi0',
            '_cf_chl_opt.Udvh4'
        ]);
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

        const createFallbackElement = () => {
            if (typeof this.createFallbackElement === 'function') {
                return this.createFallbackElement();
            }
            return {
                nodeType: 1,
                tagName: 'DIV',
                style: {},
                className: '',
                classList: {add() {}, remove() {}, contains() { return false; }, toggle() { return false; }},
                children: [],
                childNodes: [],
                appendChild(child) {
                    if (child) {
                        child.parentNode = this;
                        this.children.push(child);
                        this.childNodes.push(child);
                    }
                    return child;
                },
                removeChild(child) {
                    this.children = this.children.filter((item) => item !== child);
                    this.childNodes = this.childNodes.filter((item) => item !== child);
                    return child;
                },
                insertBefore(child) { return this.appendChild(child); },
                setAttribute(key, value) { this[key] = String(value); },
                getAttribute(key) { return this[key] || null; },
                querySelector() { return null; },
                querySelectorAll() { return []; },
                getBoundingClientRect() { return {top: 0, left: 0, right: 300, bottom: 65, width: 300, height: 65, x: 0, y: 0}; }
            };
        };

        const ensureQueryable = (value) => {
            if (!value || (typeof value !== 'object' && typeof value !== 'function')) return value;
            if (typeof value.querySelector !== 'function') {
                value.querySelector = function () { return createFallbackElement(); };
            }
            if (typeof value.querySelectorAll !== 'function') {
                value.querySelectorAll = function () { return []; };
            }
            return value;
        };

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
                if (prop === 'XHwg6' || prop === 'YrpWf3') {
                    return ensureQueryable(value);
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

                const logName = `${name}.${String(prop)}`;
                if (this.enableLog && prop !== 'toString' && prop !== 'toJSON' && typeof prop === 'string' && !this.silentLogProps.has(logName)) {
                    if (value !== undefined) {
                         console.log(`[读] ${logName}`);
                    }
                }

                if (value && (typeof value === 'object' || typeof value === 'function')) {
                    if (value.__isProxy) return value;
                    return this.create(value, `${name}.${String(prop)}`);
                }

                return value;
            },
            set: (target, prop, value, receiver) => {
                if (prop === 'XHwg6' || prop === 'YrpWf3') {
                    ensureQueryable(value);
                }
                const logName = `${name}.${String(prop)}`;
                if (this.enableLog && !this.silentLogProps.has(logName)) {
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
