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

## ⚠️ 免责声明 (Disclaimer)

1. VM2 安全性：vm2 库存在已知的沙箱逃逸漏洞，且已停止维护。本框架仅供本地逆向分析、研究和学习使用，严禁在生产环境或对外提供服务的接口中使用，否则可能导致服务器被入侵。
2. 合法性：请确保你的逆向工程行为符合当地法律法规，仅用于合法的安全研究或兼容性测试。