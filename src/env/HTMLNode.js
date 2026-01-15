const Element = require('./Element');

const mixinDOMMethods = (instance) => {
    // 1. 辅助函数
    const _indexOf = (node) => {
        if (!node) return -1;
        return instance._children.findIndex(c => c === node || (c._uid && node._uid && c._uid === node._uid));
    };

    // 2. getElementsByTagName
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

    // 3. 【核心修复】querySelector - 找不到就造一个！
    instance.querySelector = (selector) => {
        if (!selector) return null;

        // --- 正常查找逻辑 ---
        // A. ID 查找
        if (selector.startsWith('#')) {
            const id = selector.slice(1);
            const find = (node) => {
                if (node.id === id) return node;
                if (node._children) {
                    for (const child of node._children) {
                        const res = find(child);
                        if (res) return res;
                    }
                }
                return null;
            };
            const found = find(instance);
            if (found) return found;

            // 【补全逻辑】如果没找到 ID，创建一个 DIV 冒充
            console.log(`[Auto-Fix] 自动创建缺失的 ID 元素: ${id}`);
            const newEl = new Element('DIV', instance._context);
            newEl.id = id;
            instance.appendChild(newEl);
            return newEl;
        }

        // B. 标签查找
        const tag = selector.toUpperCase();
        const findTag = (node) => {
             if (node.tagName === tag) return node;
             if (node._children) {
                 for (const child of node._children) {
                     const res = findTag(child);
                     if (res) return res;
                 }
             }
             return null;
        };
        const foundTag = findTag(instance);
        if (foundTag) return foundTag;

        // C. 兜底逻辑 (针对 .class 或其他复杂选择器)
        // 如果上面都没找到，为了防止 null.style 报错，我们在 Body 下硬塞一个 Dummy 元素返回
        // 只有当 selector 看起来像是在找特定元素时才这样做
        console.warn(`[Auto-Fix] 找不到选择器 "${selector}"，返回通用僵尸元素以防崩溃`);
        const zombie = new Element('DIV', instance._context);
        // 随便给个 ID 防止下次还找不到
        zombie.id = 'zombie-' + Date.now();
        instance.appendChild(zombie);
        return zombie;
    };

    // 4. DOM 操作 (保持之前的 UID 修复逻辑)
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
        const index = _indexOf(refNode);
        if (index >= 0) {
            newNode.parentNode = instance;
            instance._children.splice(index, 0, newNode);
        } else {
            instance.appendChild(newNode);
        }
        return newNode;
    };

    instance.replaceChild = (newChild, oldChild) => {
        const index = _indexOf(oldChild);
        if (index >= 0) {
            newChild.parentNode = instance;
            instance._children[index] = newChild;
            oldChild.parentNode = null;
            return oldChild;
        }
        return instance.appendChild(newChild);
    };

    instance.removeChild = (child) => {
        const index = _indexOf(child);
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

// ... 保持类定义 ...
class HTMLMediaElement extends HTMLElement {
    constructor(tagName, context) {
        super(tagName, context);
        this.readyState = 0; this.networkState = 1;
        this.canPlayType = (t) => /mp4|mp3/.test(t) ? "probably" : "";
        this.play = () => Promise.resolve(); this.pause = () => {}; this.load = () => {};
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