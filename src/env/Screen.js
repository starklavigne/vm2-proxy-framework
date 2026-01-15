class Screen {
    // 【修复】增加默认值 = {}
    constructor(profile = {}) {
        this.width = profile.screenWidth || 1920;
        this.height = profile.screenHeight || 1080;
        this.availWidth = profile.screenWidth || 1920;
        this.availHeight = profile.screenHeight || 1080; // 通常减去任务栏高度，这里简化
        this.colorDepth = 24;
        this.pixelDepth = 24;
    }
}

module.exports = Screen;