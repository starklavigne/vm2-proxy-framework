// 模拟 CanvasGradient
class CanvasGradient {
    addColorStop(offset, color) {
    }
}

// 模拟 CanvasPattern
class CanvasPattern {
    setTransform(matrix) {
    }
}

class CanvasRenderingContext2D {
    constructor(canvas) {
        this.canvas = canvas;
        this._direction = 'ltr';
        this._fillStyle = '#000000';
        this._filter = 'none';
        this._font = '10px sans-serif';
        this._globalAlpha = 1.0;
        this._globalCompositeOperation = 'source-over';
        this._imageSmoothingEnabled = true;
        this._imageSmoothingQuality = 'low';
        this._lineCap = 'butt';
        this._lineDashOffset = 0.0;
        this._lineJoin = 'miter';
        this._lineWidth = 1.0;
        this._miterLimit = 10.0;
        this._shadowBlur = 0;
        this._shadowColor = 'rgba(0, 0, 0, 0)';
        this._shadowOffsetX = 0;
        this._shadowOffsetY = 0;
        this._strokeStyle = '#000000';
        this._textAlign = 'start';
        this._textBaseline = 'alphabetic';
    }

    // 状态保存
    save() {
    }

    restore() {
    }

    // 矩形
    clearRect(x, y, w, h) {
    }

    fillRect(x, y, w, h) {
    }

    strokeRect(x, y, w, h) {
    }

    // 文本
    fillText(text, x, y, maxWidth) {
    }

    strokeText(text, x, y, maxWidth) {
    }

    measureText(text) {
        // 简单模拟
        return {
            width: text.length * 6,
            actualBoundingBoxAscent: 10,
            actualBoundingBoxDescent: 2,
            actualBoundingBoxLeft: 0,
            actualBoundingBoxRight: text.length * 6,
            fontBoundingBoxAscent: 10,
            fontBoundingBoxDescent: 2
        };
    }

    // 路径 (Path)
    beginPath() {
    }

    closePath() {
    }

    moveTo(x, y) {
    }

    lineTo(x, y) {
    }

    bezierCurveTo(cp1x, cp1y, cp2x, cp2y, x, y) {
    }

    quadraticCurveTo(cpx, cpy, x, y) {
    }

    arc(x, y, radius, startAngle, endAngle, counterclockwise) {
    }

    arcTo(x1, y1, x2, y2, radius) {
    }

    rect(x, y, w, h) {
    }

    ellipse(x, y, radiusX, radiusY, rotation, startAngle, endAngle, counterclockwise) {
    }

    // 绘图
    fill(fillRule) {
    }

    stroke() {
    }

    clip(fillRule) {
    }

    isPointInPath(x, y, fillRule) {
        return false;
    }

    isPointInStroke(x, y) {
        return false;
    }

    // 变换
    rotate(angle) {
    }

    scale(x, y) {
    }

    translate(x, y) {
    }

    transform(a, b, c, d, e, f) {
    }

    setTransform(a, b, c, d, e, f) {
    }

    resetTransform() {
    }

    // 图像
    drawImage(image, ...args) {
    }

    // 像素操作
    createImageData(w, h) {
        return {width: w, height: h, data: new Uint8ClampedArray(w * h * 4)};
    }

    getImageData(x, y, w, h) {
        return {
            width: w,
            height: h,
            data: new Uint8ClampedArray(w * h * 4) // 全黑，防止指纹泄露
        };
    }

    putImageData(imagedata, dx, dy) {
    }

    // 【核心修复】渐变与图案 (Crash Point!)
    createLinearGradient(x0, y0, x1, y1) {
        return new CanvasGradient();
    }

    createRadialGradient(x0, y0, r0, x1, y1, r1) {
        return new CanvasGradient();
    }

    createPattern(image, repetition) {
        return new CanvasPattern();
    }

    // 虚线
    setLineDash(segments) {
    }

    getLineDash() {
        return [];
    }

    // 属性 Getter/Setter
    get fillStyle() {
        return this._fillStyle;
    }

    set fillStyle(v) {
        this._fillStyle = v;
    }

    get strokeStyle() {
        return this._strokeStyle;
    }

    set strokeStyle(v) {
        this._strokeStyle = v;
    }

    get font() {
        return this._font;
    }

    set font(v) {
        this._font = v;
    }

    // ... 其他属性可按需补全，通常不报错即可
}

module.exports = CanvasRenderingContext2D;