// 模拟 AudioParam，拥有自动化方法
class AudioParam {
    constructor(val = 0) {
        this.value = val;
        this.defaultValue = val;
    }

    setValueAtTime(value, startTime) {
    }

    linearRampToValueAtTime(value, endTime) {
    }

    exponentialRampToValueAtTime(value, endTime) {
    }

    setTargetAtTime(target, startTime, timeConstant) {
    }

    setValueCurveAtTime(values, startTime, duration) {
    }

    cancelScheduledValues(startTime) {
    }

    cancelAndHoldAtTime(cancelTime) {
    }
}

class AudioNode {
    constructor() {
        this.channelCount = 2;
        this.channelCountMode = 'max';
        this.channelInterpretation = 'speakers';
    }

    connect() {
    }

    disconnect() {
    }
}

class AudioDestinationNode extends AudioNode {
    constructor() {
        super();
        this.maxChannelCount = 2;
    }
}

class OscillatorNode extends AudioNode {
    constructor() {
        super();
        this.frequency = new AudioParam(440);
        this.detune = new AudioParam(0);
        this.type = 'sine';
        this.onended = null;
    }

    start() {
    }

    stop() {
    }

    setPeriodicWave() {
    }
}

class GainNode extends AudioNode {
    constructor() {
        super();
        this.gain = new AudioParam(1);
    }
}

class DynamicsCompressorNode extends AudioNode {
    constructor() {
        super();
        this.threshold = new AudioParam(-24);
        this.knee = new AudioParam(30);
        this.ratio = new AudioParam(12);
        this.reduction = new AudioParam(0); // float 属性，不是 AudioParam，但有些实现也是
        this.attack = new AudioParam(0.003);
        this.release = new AudioParam(0.25);
    }
}

class AudioBuffer {
    constructor(options) {
        this.length = options.length || 0;
        this.sampleRate = options.sampleRate || 44100;
        this.numberOfChannels = options.numberOfChannels || 1;
        this._data = new Float32Array(this.length);
    }

    getChannelData() {
        return this._data;
    }

    copyFromChannel() {
    }

    copyToChannel() {
    }

    get duration() {
        return this.length / this.sampleRate;
    }
}

class AudioContext {
    constructor() {
        this.destination = new AudioDestinationNode();
        this.sampleRate = 44100;
        this.currentTime = 0;
        this.state = 'running';
        this.listener = {
            positionX: new AudioParam(0),
            positionY: new AudioParam(0),
            positionZ: new AudioParam(0),
            forwardX: new AudioParam(0),
            forwardY: new AudioParam(0),
            forwardZ: new AudioParam(-1),
            upX: new AudioParam(0),
            upY: new AudioParam(1),
            upZ: new AudioParam(0)
        };
    }

    createOscillator() {
        return new OscillatorNode();
    }

    createGain() {
        return new GainNode();
    }

    createDynamicsCompressor() {
        return new DynamicsCompressorNode();
    }

    createBuffer(c, l, r) {
        return new AudioBuffer({numberOfChannels: c, length: l, sampleRate: r});
    }

    createBufferSource() {
        return {
            buffer: null, playbackRate: new AudioParam(1), loop: false, start: () => {
            }, stop: () => {
            }, connect: () => {
            }, disconnect: () => {
            }
        };
    }

    createScriptProcessor() {
        return {
            connect: () => {
            }, disconnect: () => {
            }, onaudioprocess: null
        };
    }

    createAnalyser() {
        return {
            fftSize: 2048, frequencyBinCount: 1024, getFloatFrequencyData: () => {
            }, getByteFrequencyData: () => {
            }, connect: () => {
            }, disconnect: () => {
            }
        };
    }

    decodeAudioData(b) {
        return Promise.resolve(new AudioBuffer({length: 100}));
    }

    suspend() {
        return Promise.resolve();
    }

    resume() {
        return Promise.resolve();
    }

    close() {
        return Promise.resolve();
    }
}

class OfflineAudioContext extends AudioContext {
    constructor(c, l, r) {
        super();
        this.length = l;
        this.sampleRate = r;
    }

    startRendering() {
        return Promise.resolve(new AudioBuffer({length: this.length, sampleRate: this.sampleRate}));
    }
}

const webkitAudioContext = AudioContext;
const webkitOfflineAudioContext = OfflineAudioContext;

module.exports = {AudioContext, OfflineAudioContext, webkitAudioContext, webkitOfflineAudioContext};