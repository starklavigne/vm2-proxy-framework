#!/usr/bin/env node
// 检查 jsdom 迁移所需依赖是否就绪。native 库（canvas/gl/web-audio-api）
// 需要系统级编译依赖，装不上不影响其它部分——对应的指纹会退回到 stub。
//
// 三态区分（关键）：
//   ✓ ok      —— require 成功，可用
//   ⚠ broken  —— 包在 node_modules 里，但 native .node 加载失败（编译/ABI 问题）
//   ✗ absent  —— 包根本不在（optionalDependencies 构建失败被 npm 静默丢弃就是这种）
const probes = [
  {name: 'jsdom', why: '替换手搓 DOM / node:vm 宿主（核心）', native: false},
  {name: 'node-fetch', why: 'NetworkPlugin 的 fetch（现有）', native: false},
  {name: 'canvas', why: 'Canvas2D 真实像素（canvas 指纹）', native: true},
  {name: 'gl', why: 'WebGL 真实参数 + readPixels（WebGL 指纹）', native: true},
  {name: 'web-audio-api', why: 'AudioContext 真实缓冲（audio 指纹）', native: true},
];

function probeState(name) {
  // require.resolve 找得到 = 包存在（哪怕 native 二进制坏了，JS 入口仍可 resolve）
  let resolvable = true;
  try {
    require.resolve(name);
  } catch (e) {
    resolvable = false;
  }
  try {
    require(name);
    let v = '?';
    try { v = require(`${name}/package.json`).version; } catch (e) {}
    return {state: 'ok', detail: `v${v}`};
  } catch (e) {
    const msg = (e.message || '').split('\n')[0];
    // 包能 resolve 但 require 抛错 → 装了但 native 加载失败
    if (resolvable || e.code !== 'MODULE_NOT_FOUND') {
      return {state: 'broken', detail: msg.slice(0, 60)};
    }
    return {state: 'absent', detail: '未安装/被 npm 丢弃'};
  }
}

let ready = 0;
console.log('=== jsdom 迁移依赖自检 ===\n');
for (const p of probes) {
  const {state, detail} = probeState(p.name);
  if (state === 'ok') ready++;
  const tag = state === 'ok' ? '✓'
    : state === 'broken' ? '⚠ 装了但加载失败'
    : (p.native ? '○ 未装(可选)' : '✗ 未装');
  console.log(`  ${tag.padEnd(16)} ${p.name.padEnd(14)} ${detail.padEnd(26)} — ${p.why}`);
}
console.log(`\n就绪 ${ready}/${probes.length}。  Node ${process.version} / ABI ${process.versions.modules} / ${process.platform}-${process.arch}`);
if (ready < probes.length) {
  console.log('\n安装：');
  console.log('  npm install jsdom node-fetch');
  console.log('  npm install canvas gl web-audio-api   # native，可选；缺了对应指纹退回 stub');
  console.log('  # macOS canvas: brew install pkg-config cairo pango libpng jpeg giflib librsvg');
  console.log('  # gl(headless-gl) 构建失败要看真实报错: npm install gl --foreground-scripts');
}
