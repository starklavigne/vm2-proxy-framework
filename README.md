# 🛡️ VM2 + Proxy Reverse Engineering Framework

这是一个基于 **Node.js**、**VM2** 和 **ES6 Proxy** 构建的高内聚、低耦合的 JavaScript 补环境框架。

该框架专为 JS 逆向工程（Reverse Engineering）设计，旨在提供一个纯净、可监控、易扩展的沙箱环境，用于分析和运行高强度的混淆代码（如
Cloudflare Turnstile, Akamai, Datadome 等）。

## 🌟 设计理念 (Design Philosophy)

本框架严格遵循 **“极低耦合 (Loose Coupling)”** 的设计原则，将系统拆分为五个独立的层级：

1. **数据层 (Config)**：纯粹的 JSON/Object 配置，管理 UserAgent、屏幕分辨率等指纹数据。
2. **拦截层 (Interceptor)**：通用的 Proxy 工厂，负责“监控”、“日志”和“递归代理”，不包含具体的业务逻辑。
3. **环境层 (Environment)**：具体的浏览器对象模拟（Window, Navigator, Document 等），只关注模拟实现。
4. **执行层 (Runner)**：封装 VM2 沙箱，提供纯净的代码执行容器。
5. **组装层 (Main)**：唯一的耦合点，负责将上述组件组装并启动。

## 📂 目录结构 (Directory Structure)

```text
vm2-proxy-framework/
├── src/
│   ├── config/             # [数据层] 浏览器指纹配置
│   │   └── browserProfile.js
│   ├── core/               # [拦截层] Proxy 核心逻辑
│   │   └── ProxyFactory.js
│   ├── env/                # [环境层] 具体的浏览器对象模拟
│   │   ├── Window.js       # 全局对象入口
│   │   ├── Navigator.js    # 导航对象
│   │   ├── Document.js     # 文档对象
│   │   └── index.js        # 统一导出
│   └── runner/             # [执行层] VM2 沙箱封装
│       └── VMRunner.js
├── target/                 # 存放目标混淆代码
│   └── target_bak.js
├── main.js                 # [组装层] 程序入口
└── README.md               # 说明文档
```

## 🚀 快速开始 (Quick Start)

### 1. 安装依赖

确保你的环境中已安装 Node.js。

```text
Bash
# 初始化项目
npm init -y

# 安装核心依赖 vm2
npm install vm2
```

### 2. 准备目标代码

将你需要分析的混淆代码（或测试代码）放入 target/target_bak.js。

### 3. 运行框架

```text
Bash
node main.js
```

你将在控制台看到如下格式的日志，这表示“监控探头”已经开始工作：

```text
Plaintext
>>> 开始执行目标代码: .../target/target_bak.js >>>

[读] window.navigator -> [object Navigator]
[读] window.navigator.userAgent -> Mozilla/5.0...
[!] 警告：window.screen 未定义，可能需要补环境！
```

## 🛠️ 补环境工作流 (Workflow)

逆向工程的核心在于**“缺什么补什么”**。利用本框架的 Proxy 自动监测机制，你可以按照以下步骤高效工作：

运行代码：执行 node main.js。

1. 观察日志：寻找带有 [!] 警告 的日志条目，或观察代码在哪里报错/停止。
2. 编写实现：在 src/env/ 目录下创建缺失的对象文件（例如 Screen.js）。
3. 注入环境：在 src/env/Window.js 中引入并实例化该对象。
4. 重复步骤：再次运行，直到代码跑通并生成预期的 Token。

## 🧩 扩展指南 (Extension Guide)

场景：代码报错 screen is not defined
步骤 1：创建 src/env/Screen.js

```text
JavaScript
class Screen {
    constructor(profile) {
        this.width = profile.screenWidth;
        this.height = profile.screenHeight;
        this.availWidth = profile.screenWidth;
        this.availHeight = profile.screenHeight;
        this.colorDepth = 24;
    }
}
module.exports = Screen;
```

步骤 2：在 src/env/Window.js 中注册

```text
JavaScript
const Navigator = require('./Navigator');
const Document = require('./Document');
const Screen = require('./Screen'); // <--- 引入

class Window {
    constructor(profile) {
        this.navigator = new Navigator(profile);
        this.document = new Document(profile);
        this.screen = new Screen(profile); // <--- 实例化
        
        // ... 其他代码
    }
}
module.exports = Window;
```

得益于 ProxyFactory 的递归代理机制，你不需要手动为 Screen 创建 Proxy。只要 window 被代理了，通过 window.screen 获取到的对象会自动被
Proxy 包裹并具备监控能力。

## ⚙️ 核心组件说明

ProxyFactory (src/core/ProxyFactory.js)

```text

- 功能：为对象穿上“监控装甲”。
- 特性：
    - 自动递归：当获取属性值为对象时，自动为其创建子 Proxy。
    - 方位拦截：支持 Get, Set, Apply (函数调用), Construct (new 调用)。
    - 格式化输出：将复杂的对象输出为可读的字符串。
```

VMRunner (src/runner/VMRunner.js)

```text

- 功能：提供干净的执行“房间”。
- 特性：
    - 使用 vm2 隔离宿主环境（Node.js 的 process, fs 等）。
    - setContext 方法将伪造的 window 对象平铺到沙箱全局。
```

## 🔬 Payload 对账工作流

当 VM 跑完没拿到 `cf_clearance` 时，先用对账工具定位"VM 在哪一步偏离了真浏览器"，
再决定要补指纹、补事件、还是补算法。

### 依赖

两个 capture 脚本用 [**patchright**](https://github.com/Kaliiiiiiiiii-Vinyzu/patchright)（Playwright 的反检测分叉），原生 Playwright 会被 CF 直接识破：

```bash
pip install patchright
# 二选一：
#   方案 1：用系统装的真 Chrome（脚本默认 --channel chrome，最稳）
#   方案 2：让 patchright 装它自己的补丁 chromium，并加 --channel ''
patchright install chromium
```

### 四步顺序

1. **抓最新 challenge 资产**
   ```bash
   python capture_challenge_playwright.py
   # 写出 src/config/cfConfig.js 和 target/target.js
   ```

2. **真浏览器解一遍 challenge，dump 到 `dumps/real/`**
   ```bash
   python capture_payloads_playwright.py --clear-dir
   # 默认非 headless，便于观察；拿到 cf_clearance 后 +3s 自动退出
   # 同时写出 dumps/real/_cookies.json，包含完整的 cookie 集
   ```

3. **VM 跑一遍 challenge，dump 到 `dumps/vm/`**
   ```bash
   node main.js
   # 启动时会自动清空 dumps/vm/；若需保留旧 dump 加 CLEAR_DUMP_DIR=0
   ```

4. **生成 diff 报告**
   ```bash
   python tools/diff_challenge_payloads.py --out report.txt
   ```

报告会按 endpoint 配对、列出长度/sha256/JSON 结构/二进制 hex 差异。

**核心诊断信号**：

- 摘要表里 `VM 没跑到这里`，说明执行流在某一步报错或挂起，**先解执行流**再谈算法
- `RESP : status real=200 vm=403`，说明 VM 的请求被 CF 直接判掉
- JSON diff 里指纹字段出现差异，说明对应的 env mock 不真（比如 canvas/audio/screen）

**当前已知短板**（解释为什么 cf_clearance 拿不到）：

- `turnstile.execute()` callback 返的是占位 token（默认 `turnstileMock`），CF 服务端必然拒——有效 token 需要真实 Turnstile 与 CF 服务端交互
- `node-fetch` 的 TLS JA3 跟 Chrome 完全不同，TLS 层就可能被识别（建议换 tls-client / curl-impersonate）
- 鼠标事件是定时器塞的、轨迹太规则
- `crypto.subtle` 之前是 stub（digest 返回全 0），现已接 Node 真实 webcrypto
- ~~曾尝试把真实 Turnstile 拉到 Node 宿主域执行（PURE_TURNSTILE / executeTurnstileInHostRealm）~~ 已移除：背离纯沙箱、且 token 仍被拒

对账工具不解决以上问题，但能告诉你**哪一项最先击穿**——是 TLS、是 token、还是某个指纹字段。

## 🧪 新执行层：node:vm + jsdom（迁移中）

vm2 已停维护且有逃逸，手搓 DOM 永远在"缺什么补什么"且自相矛盾（曾有两套 Navigator）。
新执行层用 **jsdom** 提供自洽的 DOM/CSSOM，复用现有 `NetworkPlugin`（fetch/XHR/cookie/dump）
和已修好的 `Crypto`（`subtle` 接真 webcrypto），让 challenge 能跑到底，从而在 dumps 里看清它算了什么。

新增文件：
- `src/runner/JsdomRunner.js` — jsdom 宿主 + navigator/screen/chrome 指纹覆盖 + 真实 crypto + 网络复用 + 可选 native 指纹后端
- `main.jsdom.js` — 驱动：注入 `_cf_chl_opt`、跑 `target/target.js`、监听 `cf_clearance`
- `tools/preflight_deps.js` — 依赖自检

安装与运行：
```bash
npm install jsdom node-fetch
npm install canvas gl web-audio-api   # native，可选；缺了对应指纹退回 stub
# macOS 上 canvas 需要: brew install pkg-config cairo pango libpng jpeg giflib librsvg
npm run preflight     # 看哪些后端就绪
npm run jsdom         # 跑 jsdom 版（dump 仍写 dumps/vm，可与 dumps/real 对账）
```

**已冒烟通过**：jsdom 窗口构建、navigator(`webdriver=false`/UA/platform)/screen/chrome 覆盖、
`TextEncoder/TextDecoder` 注入、`crypto.subtle.digest` 真实非 0、fetch/XHR 就位、自洽 DOM；
`target.js` 已能在 jsdom 里执行不抛错。

### 主线进展（实测，截至当前）

跑 `npm run jsdom`（本机无外网时会停在网络边界），`target.js`（orchestrate）已被驱动到：
注册 error/DCL/load 监听 → 1s 看门狗 → `setTimeout(0)` 里 **open 了真正的 ov1 flow POST**
（`/cdn-cgi/challenge-platform/h/g/b/ov1/375771525:...`，与真机 `dumps/real` 同端点）。

为打通到这一步，已补齐这些"第一个缺口"（都在 `JsdomRunner` 里，按发现顺序）：
1. **VirtualConsole/jsdomError** —— jsdom 把 timer/事件回调里的异常吞掉，只发到这里。
   这是看见"被吞错误"的唯一窗口，是后续定位的关键工具。
2. **Web Worker shim**（`installWorkerShim`）—— orchestrate 把 PoW/指纹 offload 到
   `new Worker(URL.createObjectURL(new Blob([src])))` 再 await `worker.onmessage` 才发 ov1。
   jsdom 不实现 Worker → 那个 await 永不返回。shim 同实例 postMessage 桥接 + 真实 crypto，
   已用玩具 worker（echo + subtle.digest）单测通过。
3. **缺失构造器**（`installMissingConstructors`）—— 补了 35 个 jsdom 缺、真 Chrome 必有的
   构造器（WebGL*/OffscreenCanvas/RTC*/各 Observer/ImageData…），CF 指纹会读它们的 `.prototype`。

### 当前卡点（精确到偏移，可复现）

`[Cloudflare Turnstile] Unhandled error: Cannot read properties of undefined (reading 'prototype')`
—— 内联 Turnstile 采集器在 `target.js` 偏移 **41710**（函数 `zJ`）做了个**无 try 保护**的特征检测：
`N[X].prototype[Y]`，其中 `N[X]` 是个 jsdom 仍缺、且不在上面 35 个里的构造器（名字由 `mu()`
运行时解码，需联机插桩才能确认是哪个）。

**继续这个循环的方法**（每轮约补一个 API）：
1. `node -e "setTimeout(()=>process.exit(0),4000); require('./main.jsdom.js')" 2>&1 | grep -A12 jsdomError`
   拿到栈里的 `<anonymous>:1:OFFSET`；
2. 在 `target/target.js` 该偏移附近看是哪个 `N[X]` / API；
3. 在 `JsdomRunner` 对应 `install*` 里补上；回到 1。

### 仍需联机（本机沙箱到不了 CF，无法验证）

- ov1 真正 `send` 后才会写 `dumps/vm`，再和 `dumps/real` 跑 `tools/diff_challenge_payloads.py` 对账；
- turnstile 外链脚本、`/flow` 响应、turnstile token —— 都要真出网；
- **turnstile token 仍是核心死结**：jsdom 渲染不了真实 widget，`isTrusted` 也伪造不了（和 vm2 同病）。
  这部分要么真机采样喂 ground truth（route 4），要么深逆 turnstile（route 5）。

**Canvas/WebGL 取舍**：node-canvas 是 Cairo、headless-gl 多为 Mesa/ANGLE，hash 不会等于某台真 Chrome，
但是真实、稳定、自洽的值（强于全 0/常量）。严格模式要比对 Chrome 分布时，需用真机采样锚定。

## ⚠️ 免责声明 (Disclaimer)

1. VM2 安全性：vm2 库存在已知的沙箱逃逸漏洞，且已停止维护。本框架仅供本地逆向分析、研究和学习使用，严禁在生产环境或对外提供服务的接口中使用，否则可能导致服务器被入侵。
2. 合法性：请确保你的逆向工程行为符合当地法律法规，仅用于合法的安全研究或兼容性测试。