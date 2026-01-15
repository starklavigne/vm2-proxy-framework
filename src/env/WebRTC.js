class RTCSessionDescription {
    constructor(init) {
        this.type = init.type;
        this.sdp = init.sdp;
    }
}

class RTCIceCandidate {
    constructor(init) {
        this.candidate = init.candidate || "";
        this.sdpMid = init.sdpMid || "";
        this.sdpMLineIndex = init.sdpMLineIndex || 0;
    }
}

class RTCPeerConnection {
    constructor(config) {
        this.localDescription = null;
        this.remoteDescription = null;
        this.iceConnectionState = 'new';
        this.iceGatheringState = 'new';
        this.signalingState = 'stable';

        this.onicecandidate = null;
        this.oniceconnectionstatechange = null;
        this.ondatachannel = null;
    }

    createDataChannel(label) {
        return {
            label: label,
            readyState: 'open',
            send: () => {
            },
            close: () => {
            },
            onmessage: null,
            onopen: null,
            onclose: null
        };
    }

    createOffer(options) {
        return Promise.resolve(new RTCSessionDescription({type: 'offer', sdp: 'v=0\r\n...'}));
    }

    createAnswer(options) {
        return Promise.resolve(new RTCSessionDescription({type: 'answer', sdp: 'v=0\r\n...'}));
    }

    setLocalDescription(desc) {
        this.localDescription = desc;
        return Promise.resolve();
    }

    setRemoteDescription(desc) {
        this.remoteDescription = desc;
        return Promise.resolve();
    }

    addIceCandidate(candidate) {
        return Promise.resolve();
    }

    close() {
    }

    getStats() {
        return Promise.resolve(new Map());
    }
}

module.exports = {RTCPeerConnection, RTCSessionDescription, RTCIceCandidate};