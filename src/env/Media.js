// 原生伪装辅助
const nativize = (func, name) => {
    if (typeof func !== 'function') func = () => {
    };
    const funcName = name || func.name || '';
    const nativeString = `function ${funcName}() { [native code] }`;
    Object.defineProperty(func, 'toString', {value: () => nativeString, writable: true, configurable: true});
    return func;
};

// 1. Canvas 2D Context
class CanvasRenderingContext2D {
    constructor(canvas) {
        this.canvas = canvas;
    }

    save() {
    }

    restore() {
    }

    beginPath() {
    }

    closePath() {
    }

    moveTo() {
    }

    lineTo() {
    }

    stroke() {
    }

    fill() {
    }

    rect() {
    }

    arc() {
    }

    fillText(text, x, y) {
    }

    strokeText() {
    }

    getImageData(x, y, w, h) {
        // 返回全白或随机噪音，防止指纹一致性检测（反指纹）
        // 这里简单返回全 0
        return {data: new Uint8ClampedArray(w * h * 4)};
    }

    toDataURL() {
        return "data:image/png;base64,";
    }
}

// 2. WebGL Context
class WebGLRenderingContext {
    constructor(canvas) {
        this.canvas = canvas;
    }

    getParameter(id) {
        // 模拟常见显卡信息
        if (id === 37445) return "Google Inc."; // UNMASKED_VENDOR_WEBGL
        if (id === 37446) return "ANGLE (Intel, Intel(R) UHD Graphics 630, OpenGL 4.1)"; // UNMASKED_RENDERER_WEBGL
        return 0;
    }

    getExtension(name) {
        return null;
    }

    createBuffer() {
        return {};
    }

    bindBuffer() {
    }

    bufferData() {
    }

    enable() {
    }

    clearColor() {
    }

    clear() {
    }

    viewport() {
    }
}

// 3. Audio Context
class AudioContext {
    constructor() {
        this.state = 'running';
    }

    createOscillator() {
        return {
            connect: () => {
            }, start: () => {
            }, stop: () => {
            }
        };
    }

    createDynamicsCompressor() {
        return {
            threshold: {value: 0}, connect: () => {
            }
        };
    }

    createBuffer() {
    }

    destination = {};
}

class OfflineAudioContext extends AudioContext {
    constructor(c, l, r) {
        super();
    }

    startRendering() {
        return Promise.resolve(new AudioBuffer());
    }
}

class AudioBuffer {
    getChannelData() {
        return new Float32Array(0);
    }
}

module.exports = {
    CanvasRenderingContext2D: nativize(CanvasRenderingContext2D, 'CanvasRenderingContext2D'),
    WebGLRenderingContext: nativize(WebGLRenderingContext, 'WebGLRenderingContext'),
    AudioContext: nativize(AudioContext, 'AudioContext'),
    OfflineAudioContext: nativize(OfflineAudioContext, 'OfflineAudioContext')
};