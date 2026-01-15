class PerformanceEntry {
    constructor(name, type) {
        this.name = name;
        this.entryType = type;
        this.startTime = 0;
        this.duration = 0;
    }
}

class Performance {
    constructor() {
        this.timeOrigin = Date.now();
        this.timing = {
            navigationStart: this.timeOrigin,
            domComplete: this.timeOrigin + 100,
            domContentLoadedEventEnd: this.timeOrigin + 100,
            domInteractive: this.timeOrigin + 50,
            loadEventEnd: this.timeOrigin + 200,
            // ... 其他必要的 timing 属性
            connectStart: this.timeOrigin,
            connectEnd: this.timeOrigin + 10,
            fetchStart: this.timeOrigin,
            domainLookupStart: this.timeOrigin,
            domainLookupEnd: this.timeOrigin + 5,
            requestStart: this.timeOrigin + 10,
            responseStart: this.timeOrigin + 20,
            responseEnd: this.timeOrigin + 50
        };
        this.memory = {
            jsHeapSizeLimit: 2172649472,
            totalJSHeapSize: 10000000,
            usedJSHeapSize: 10000000
        };
        this.navigation = {
            type: 0, // NAVIGATE
            redirectCount: 0
        };
        this._entries = [];
    }

    now() {
        return Date.now() - this.timeOrigin;
    }

    getEntries() {
        return this._entries;
    }

    getEntriesByType(type) {
        // CF 经常检查 resource, navigation, paint
        if (type === 'navigation') {
            return [new PerformanceEntry(window.location.href, 'navigation')];
        }
        return this._entries.filter(e => e.entryType === type);
    }

    getEntriesByName(name) {
        return this._entries.filter(e => e.name === name);
    }

    mark(name) {
        const entry = new PerformanceEntry(name, 'mark');
        entry.startTime = this.now();
        this._entries.push(entry);
    }

    measure(name, startMark, endMark) {
        const entry = new PerformanceEntry(name, 'measure');
        entry.startTime = this.now();
        this._entries.push(entry);
    }

    clearMarks() {
    }

    clearMeasures() {
    }

    clearResourceTimings() {
    }

    setResourceTimingBufferSize() {
    }

    toJSON() {
        return {};
    }
}

module.exports = Performance;