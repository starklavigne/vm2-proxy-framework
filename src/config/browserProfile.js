// 定义一套浏览器指纹数据
// 纯数据，方便随时切换不同的浏览器指纹。
module.exports = {
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36",
    language: "zh-CN",
    screenWidth: 1920,
    screenHeight: 1080,
    platform: "Win32", // 确保这里是 Win32，配合 Windows UA
    hardwareConcurrency: 8,
};