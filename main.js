const ProxyFactory = require('./src/core/ProxyFactory');
const VMRunner = require('./src/runner/VMRunner');
const Window = require('./src/env/Window');
const Document = require('./src/env/Document');
const profile = require('./src/config/browserProfile');
const path = require('path');

// 1. 准备 VM
const runner = new VMRunner();
const context = runner.vm.sandbox;

// 2. 准备工厂
const proxyFactory = new ProxyFactory({enableLog: true});

// 3. 创建核心对象
const rawWindow = new Window(context, profile);
const rawDocument = new Document(profile, rawWindow);

// 4. 连接 Document
// 注意：这里不需要代理 document，因为 window 代理后，访问 window.document 会自动被 ProxyFactory 包装
rawWindow.document = rawDocument;

// 5. 将 Document 挂载到 VM 全局
// 必须挂载！否则脚本直接访问 document 会报错
// 我们这里直接挂载 rawDocument，让 VM2 的桥接机制去处理，或者也可以挂载代理后的
const proxyWindow = proxyFactory.create(rawWindow, "window");
const proxyDocument = proxyFactory.create(rawDocument, "document"); // 单独创建一个给全局用

// 6. 注入全局变量
context.window = proxyWindow;
context.self = proxyWindow;
context.top = proxyWindow;
context.parent = proxyWindow;
context.globalThis = proxyWindow;

context.document = proxyDocument;
context.location = rawWindow.location;

// 7. 补全 CF 配置
const realConfig = {
    cHb: '123456', clientVersion: '12345',
    cOgUHash: {}, cOgUQuery: {},
    gdnm2: "", vTex0: "", AcymJ1: "", wOEq9: "",
    cvId: '3', cZone: 'www.sciencedirect.com', cType: 'interactive',
    cRay: '96ad7cbf689c8481',
    cH: 'wsTHNwaOc9LC903bZWgzDzVy7rUWtEcvdq7cB4JrtgE-1754472330-1.2.1.1-7Y.pigKdyvIDf6LyZuSzctCoVeJNtNuXYdvNzTn1pYwxf72HvvpFpW3YJKIK.esD',
    cUPMDTk: "\/journal\/phytochemistry-letters\/vol\/48\/suppl\/C?__cf_chl_tk=nQhJ51m1MrKRzhjA1ZCvYvcuCv7JixExK6EyC9mVZwI-1754472330-1.0.1.1-TvTR8zLZwqvC3xlf5QCjUio70it8aQGSFXQhcOopcqs",
    cFPWv: 'b', cITimeS: '1754472330', cTplC: 1, cTplV: 5, cTplB: 'cf',
    fa: "\/journal\/phytochemistry-letters\/vol\/48\/suppl\/C?__cf_chl_f_tk=nQhJ51m1MrKRzhjA1ZCvYvcuCv7JixExK6EyC9mVZwI-1754472330-1.0.1.1-TvTR8zLZwqvC3xlf5QCjUio70it8aQGSFXQhcOopcqs",
    md: 'SUNPvgPZRBF5q.psaXUaSlELoiMoZ9lnm8qLTVjMedA-1754472330-1.2.1.1-iS5qeJ2QlRRGw99KbOPeyiGVxH5YiBYIirQIzOAWx47pYwHIM8JIJTBe.dP6OSKw4ttoY3ul_3RUPYZ4XoPTj_MK6mpDCxhFisvTpUz5YF9kO33Q68aRiAvR80bMcmpR0U9sZ_2IMJifnS0d7rUw4kBOx9uqI57cxihxznkUDzlzDMJoCiNq1hzsJzoI8TRRQ5k8K0luYv0FWHzVnL8vmx1Umbw12Wftea_ZokavMlQKOwJWtDqono91YhdEn0s0vn1_uO7vOP.cLxxUPvXmZL_ZxNEorZJSlqp2Y3UBRTzK2LXEUklghscDmbIZGjCKmzm1cG6jOsLeltIHTtOT.jRNI9HFZriWyiNvT2gYmsSRXH8Wwoow8fKXUGAri3QOX1KR9CV4tdRuPKryO4YqG6ivDpOVEgFw9_g.fl4224ZBdM9ZZZnvrNeOuVMbKfkQcqo8ehexD7ZOvCjEJf2_UKbjKgJrPkeB9VNqt0lEp7pYrPMTCcusei4_sY7pRRWxXIcYQhn39YbagDUY9ed_jZTtqteL2iWU.Luwdnz1dctCpFCvRqiNYVwC57kHLY1qVgLTQ0dEht0j6xSKKpElSXXA1KUP76p5xcyy1BofeLqFi5MklvgO0YJ3gBxowbpwF9axEMCEdzc07a1hUbcf6ZoAR5S1ljAJgCSbXwvpuW3G_eEX3G8ey6J.xIuokwkesLWnhBqiRcvvh3JKhP_yS2lviph69i9SwLPqOpKEz5v1pXnakM4I.eec.1bYcB2oLL6H0V0XgdLnrWm3B5xPTajM97T5M1w322jl1T43wCCuwfiRlz7.ay4gCrQto3FTGoAGdtSq6FTCChGcMzKzM8TmshXc3.RwV1lTbHh67GdGpAO_cJdes5nQD5lrVsTqSZ_6Vs9GdCp27M.7PtMLNX2lziHaIkC4CGxc9Of47kfe_zrKoRI6bAAWR4oT41_wA8LYOgymTtkpj.qFgs_vfm5yvLmpTS2c6xQGJrrcuAnQ.Ize4Otc1qBR3P._4Y.lxWMELZFTWPXyc9waq8SOImFNieE36joy.DavUCEcvX7qiXb6wxRjIni1ixVm8r3cnrTODJv0v_5YpKiK2O_lH8iZYo7C7R0JvDTgUZejnWE',
    cNounce: '12345',
    DNOs4: 'challenge-stage'
};

rawWindow._cf_chl_opt = new Proxy(realConfig, {
    get: function (target, prop) {
        if (prop in target) return target[prop];
        return "";
    }
});

// 8. 运行
// 这一步其实多余了，因为我们已经手动 context.window = ...，但保持调用无害
runner.setContext(proxyWindow);

const targetFile = path.join(__dirname, 'target/target.js');
runner.runFile(targetFile);