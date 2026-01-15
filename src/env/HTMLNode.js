// 确保这里只引入 Element，不要引入其他会导致循环的东西
const Element = require('./Element');

// Mixin 定义 (保持之前的代码)
const mixinDOMMethods = (instance) => {
    // ... (保持之前提供的 mixinDOMMethods 完整代码，包含 insertBefore, querySelector 等)
    // 为节省篇幅，这里简略，请复用上一次成功的 Mixin 代码
    instance.getElementsByTagName = (tagName) => {
        const tag = tagName.toUpperCase();
        const result = [];
        const traverse = (node) => {
            if (node && node._children) {
                for (const child of node._children) {
                    if (child && child.nodeType === 1) {
                        if (tag === '*' || child.tagName === tag) result.push(child);
                        traverse(child);
                    }
                }
            }
        };
        traverse(instance);
        const HTMLCollection = instance._context?.HTMLCollection || Array;
        return new HTMLCollection(result);
    };

    instance.querySelector = (selector) => {
        if (!selector) return null;
        if (selector.startsWith('#')) {
            const id = selector.slice(1);
            const find = (node) => {
                if (node.id === id) return node;
                if (node._children) {
                    for (const child of node._children) {
                        if (child) {
                            const res = find(child);
                            if (res) return res;
                        }
                    }
                }
                return null;
            };
            return find(instance);
        }
        const tag = selector.toUpperCase();
        const find = (node) => {
             if (node.tagName === tag) return node;
             if (node._children) {
                 for (const child of node._children) {
                     if (child) {
                         const res = find(child);
                         if (res) return res;
                     }
                 }
             }
             return null;
        };
        return find(instance) || null;
    };

    const originalAppend = instance.appendChild;
    instance.appendChild = (child) => {
        if (!child) return null;
        if (originalAppend) return originalAppend.call(instance, child);
        child.parentNode = instance;
        instance._children.push(child);
        return child;
    };

    instance.insertBefore = (newNode, refNode) => {
        if (!newNode) return null;
        if (!refNode) return instance.appendChild(newNode);
        const index = instance._children.indexOf(refNode);
        if (index >= 0) {
            newNode.parentNode = instance;
            instance._children.splice(index, 0, newNode);
        } else {
            instance.appendChild(newNode);
        }
        return newNode;
    };

    instance.replaceChild = (newChild, oldChild) => {
        const index = instance._children.indexOf(oldChild);
        if (index >= 0) {
            newChild.parentNode = instance;
            instance._children[index] = newChild;
            oldChild.parentNode = null;
            return oldChild;
        }
        return instance.appendChild(newChild);
    };

    instance.removeChild = (child) => {
        const index = instance._children.indexOf(child);
        if (index >= 0) {
            instance._children.splice(index, 1);
            child.parentNode = null;
        }
        return child;
    };
};

class HTMLElement extends Element {
    constructor(tagName = 'DIV', context) {
        super(tagName, context);
        mixinDOMMethods(this);
    }
}

// ... 保持其他类定义 (HTMLMediaElement, HTMLDivElement 等) 不变 ...
// 必须确保 HTMLMediaElement 等类在这个文件里被正确定义和导出
class HTMLMediaElement extends HTMLElement {
    constructor(tagName, context) {
        super(tagName, context);
        this.readyState = 0;
        this.networkState = 1;
        this.canPlayType = (t) => /mp4|mp3/.test(t) ? "probably" : "";
        this.play = () => Promise.resolve();
        this.pause = () => {};
        this.load = () => {};
    }
}
class HTMLAudioElement extends HTMLMediaElement { constructor(context) { super('AUDIO', context); } }
class HTMLVideoElement extends HTMLMediaElement { constructor(context) { super('VIDEO', context); } }

class HTMLDivElement extends HTMLElement { constructor(context) { super('DIV', context); } }
class HTMLSpanElement extends HTMLElement { constructor(context) { super('SPAN', context); } }
class HTMLAnchorElement extends HTMLElement { constructor(context) { super('A', context); } }
class HTMLFormElement extends HTMLElement { constructor(context) { super('FORM', context); } }
class HTMLIFrameElement extends HTMLElement { constructor(context) { super('IFRAME', context); } }
class HTMLScriptElement extends HTMLElement { constructor(context) { super('SCRIPT', context); } }
class HTMLImageElement extends HTMLElement { constructor(context) { super('IMG', context); } }
class HTMLCanvasElement extends HTMLElement {
    constructor(context) { super('CANVAS', context); }
    getContext(type) { return super.getContext(type); }
}
class HTMLBodyElement extends HTMLElement { constructor(context) { super('BODY', context); } }
class HTMLHeadElement extends HTMLElement { constructor(context) { super('HEAD', context); } }
class HTMLHtmlElement extends HTMLElement { constructor(context) { super('HTML', context); } }

class SVGElement extends Element {
    constructor(tagName, context) {
        super(tagName, context);
        this.namespaceURI = "http://www.w3.org/2000/svg";
    }
}
class SVGGraphicsElement extends SVGElement { constructor(t, c) { super(t, c); } getBBox() { return {x:0,y:0,width:0,height:0}; } getCTM() { return {a:1,b:0,c:0,d:1,e:0,f:0}; } getScreenCTM() { return {a:1,b:0,c:0,d:1,e:0,f:0}; } }
class SVGSVGElement extends SVGGraphicsElement { constructor(c) { super('svg', c); } createSVGPoint() { return {x:0,y:0,matrixTransform:function(m){return this;}}; } createSVGMatrix() { return {a:1,b:0,c:0,d:1,e:0,f:0}; } createSVGRect() { return {x:0,y:0,width:0,height:0}; } get width() { return {baseVal:{value:0}}; } get height() { return {baseVal:{value:0}}; } }

module.exports = {
    HTMLElement,
    HTMLMediaElement, HTMLAudioElement, HTMLVideoElement,
    SVGElement, SVGGraphicsElement, SVGSVGElement,
    HTMLDivElement, HTMLSpanElement, HTMLAnchorElement, HTMLFormElement,
    HTMLIFrameElement, HTMLScriptElement, HTMLImageElement, HTMLCanvasElement,
    HTMLBodyElement, HTMLHeadElement, HTMLHtmlElement
};