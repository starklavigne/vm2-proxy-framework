const {VM} = require('vm2');
const fs = require('fs');

class VMRunner {
    constructor() {
        this.vm = new VM({timeout: 10000, sandbox: {}});
    }

    setContext(contextObj) {
        for (let key in contextObj) this.vm.freeze(contextObj[key], key);
        this.vm.sandbox.window = contextObj;
        this.vm.sandbox.self = contextObj;
        this.vm.sandbox.top = contextObj;
        this.vm.sandbox.parent = contextObj;
        this.vm.sandbox.globalThis = contextObj;
    }

    runFile(filePath) {
        const code = fs.readFileSync(filePath, 'utf-8');
        const bootstrapCode = `
            try {
                const globalMounts = {
                    Object, Array, Function, String, Number, Boolean, RegExp, Date, Math, JSON, Promise, Symbol, Proxy, Reflect,
                    Error, TypeError, EvalError, RangeError, ReferenceError, SyntaxError, URIError,
                    ArrayBuffer, Uint8Array, Int8Array, Uint16Array, Int16Array, Uint32Array, Int32Array, Float32Array, Float64Array, Uint8ClampedArray, DataView,
                    Map, Set, WeakMap, WeakSet,
                    
                    // 【绝对关键】必须注入 TextEncoder/TextDecoder
                    TextEncoder: TextEncoder,
                    TextDecoder: TextDecoder,
                    
                    console, parseInt, parseFloat, isNaN, isFinite, encodeURI, decodeURI, encodeURIComponent, decodeURIComponent, escape, unescape,
                    atob: window.atob, btoa: window.btoa,
                    setTimeout: window.setTimeout, clearTimeout: window.clearTimeout, setInterval: window.setInterval, clearInterval: window.clearInterval,
                    requestAnimationFrame: window.requestAnimationFrame, cancelAnimationFrame: window.cancelAnimationFrame, queueMicrotask: window.queueMicrotask,

                    URL: window.URL, URLSearchParams: window.URLSearchParams, DOMParser: window.DOMParser, fetch: window.fetch,
                    Headers: window.Headers, Request: window.Request, Response: window.Response,
                    
                    Element: window.Element, HTMLElement: window.HTMLElement, Node: window.Node, Event: window.Event,
                    HTMLDivElement: window.HTMLDivElement, HTMLCanvasElement: window.HTMLCanvasElement, HTMLFormElement: window.HTMLFormElement,
                    HTMLAnchorElement: window.HTMLAnchorElement, HTMLImageElement: window.HTMLImageElement, HTMLScriptElement: window.HTMLScriptElement,
                    HTMLBodyElement: window.HTMLBodyElement, HTMLHeadElement: window.HTMLHeadElement, HTMLHtmlElement: window.HTMLHtmlElement,
                    HTMLIFrameElement: window.HTMLIFrameElement, HTMLSpanElement: window.HTMLSpanElement,
                    MouseEvent: window.MouseEvent, KeyboardEvent: window.KeyboardEvent,
                    
                    HTMLCollection: window.HTMLCollection, NodeList: window.NodeList,
                    MutationObserver: window.MutationObserver, IntersectionObserver: window.IntersectionObserver, ResizeObserver: window.ResizeObserver,
                    
                    Image: window.Image, Audio: window.Audio, CSS: window.CSS,
                    
                    AudioContext: window.AudioContext, OfflineAudioContext: window.OfflineAudioContext,
                    webkitAudioContext: window.webkitAudioContext, webkitOfflineAudioContext: window.webkitOfflineAudioContext,
                    RTCPeerConnection: window.RTCPeerConnection, RTCSessionDescription: window.RTCSessionDescription, RTCIceCandidate: window.RTCIceCandidate, webkitRTCPeerConnection: window.webkitRTCPeerConnection
                };

                for (const [key, value] of Object.entries(globalMounts)) {
                    if (value && window[key] === undefined) window[key] = value;
                    if (value && self[key] === undefined) self[key] = value;
                }
                
                window.Object.prototype.toString = Object.prototype.toString;
                console.log("[系统] 环境注入完成");
            } catch (e) { console.log("[系统] 注入失败: " + e.message); }
        `;

        try {
            return this.vm.run(bootstrapCode + "\n" + code);
        } catch (e) {
            console.error("执行报错:", e.message);
        }
    }
}

module.exports = VMRunner;