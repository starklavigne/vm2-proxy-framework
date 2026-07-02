// 定义一套浏览器指纹数据
// 纯数据，方便随时切换不同的浏览器指纹。
// 【一致性】全项目共用这一套身份：UA / platform / 两个 capture 脚本的 DEFAULT_UA
// 必须指向同一个 Chrome 版本，CF 会交叉核对 UA、sec-ch-ua、navigator、TLS。
// 这里取 Chrome 149 / Windows，与真机 dump 里的 sec-ch-ua(149) 对齐。
module.exports = {
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
    uaFullVersion: "149.0.7827.55", // 与 sec-ch-ua-full-version 对齐（如后续补 navigator.userAgentData）
    language: "zh-CN",
    screenWidth: 1920,
    screenHeight: 1080,
    platform: "Win32", // 确保这里是 Win32，配合 Windows UA
    hardwareConcurrency: 8,
};
