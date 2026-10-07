# WebAudioBalance 项目功能与实施现状全面审查报告

**文档版本**: v1.0.0  
**审查时间**: 2026-10-08  
**审查对象**: WebAudioBalance (Chrome/Edge MV3 扩展, 当前版本 v1.1.1)  
**审查目标**: 针对用户反馈的核心缺陷（多窗口/标签页无法实现音量自动平衡、多窗口捕获后仅最后一个正常其余报错、UI 刷新与设置按钮无响应）进行深度代码链路与底层机制审查，给出根因分析及整改技术方案。

---

## 目录
1. [执行摘要 (Executive Summary)](#1-执行摘要)
2. [核心问题一：多窗口捕获后仅最后一个正常，其余全部显示 Error](#2-核心问题一多窗口捕获后仅最后一个正常其余全部显示-error)
   - 2.1 故障现象与复现链路
   - 2.2 核心根因分析（深度代码与 Chromium 机制）
   - 2.3 验证证据与实验日志
3. [核心问题二：未能够实现捕获后所有窗口之间的自动音量平衡](#3-核心问题二未能够实现捕获后所有窗口之间的自动音量平衡)
   - 3.1 故障现象与用户感知偏差
   - 3.2 根因一：多标签崩溃导致的级联失效
   - 3.3 根因二：静音/语音停顿导致短时窗被频繁清空与增益冻结
   - 3.4 根因三：缺少跨标签动态相对配平逻辑（独立静态绝对目标模型局限）
   - 3.5 根因四：激进的安全包络（Headroom Ceiling）压制
4. [核心问题三：UI 上的“刷新”、“设置”等按钮似乎没有作用](#4-核心问题三ui-上的刷新设置等按钮似乎没有作用)
   - 4.1 “设置”按钮（⚙️）的视觉欺骗与离屏抽屉缺陷
   - 4.2 “刷新”按钮（🔄）的静默无反馈与无自愈能力
5. [系统实现与设计规格偏离对比表](#5-系统实现与设计规格偏离对比表)
6. [整改与修复技术方案建议 (Actionable Recommendations)](#6-整改与修复技术方案建议)
   - 6.1 音频捕获纯音频改造与误报校验纠正
   - 6.2 响度控制器的语音停顿抗扰与自适应暖机优化
   - 6.3 跨窗口相对音量平衡编排器（Cross-Tab Balancer）增强
   - 6.4 弹出层 UI 与操作交互彻底重构

---

## 1. 执行摘要

经过对 WebAudioBalance 项目代码仓库（包含 Service Worker 控制面、Offscreen 音频面、Popup 表现层、DSP 响度核心以及 Chromium 底层交互机制）的端到端穿透审查与现场 CDP 环境复现测试，审查结果表明：

1. **多标签 Error 问题属于“误伤型自杀式状态校验”**：
   - 根本原因是在 [`src/engine/audio-source.js`](file:///d:/CHATGPT_WORKSPACE/WebAudioBalance/src/engine/audio-source.js#L59-L78) 中请求了多余的 `video` 轨道并在捕获后立即执行 `videoTrack.stop()`。
   - Chromium 核心的 `TabCaptureRegistry` 收到视频轨道关闭事件后，将该标签的捕获状态标记为 `stopped`。
   - [`src/control/coordinator.js`](file:///d:/CHATGPT_WORKSPACE/WebAudioBalance/src/control/coordinator.js#L576-L584) 的对账逻辑据此判定产生 `CAPTURE_STATE_MISMATCH`，强行将先前所有仍在正常运行的音频引擎标记为 `Error`。唯独最新捕获的标签页由于事务刚结束清空了错误字段，才呈现为唯一的“正常”标签。
2. **自动音量平衡未达预期由两层机制叠加导致**：
   - 第一层：由于上述 Error 机制，除最后一个标签外，所有前面标签在控制面均沦为故障态，跨窗口平衡在第一步就丧失了基础。
   - 第二层：在 [`src/engine/audio-engine.js`](file:///d:/CHATGPT_WORKSPACE/WebAudioBalance/src/engine/audio-engine.js#L159-L163) 和 [`src/engine/dsp/loudness-core.js`](file:///d:/CHATGPT_WORKSPACE/WebAudioBalance/src/engine/dsp/loudness-core.js#L206-L216) 中，人声自然的语间停顿（>600ms）会触发静音恢复逻辑，将累计能量切片彻底清空并重置短时窗 (`shortTermValid = false`)。控制器对未达到 3 秒连续音频的信号强制采用 0 dB 增益保护，导致**真实视频/语音对话中的较小声音永远得不到提升**。
3. **UI 刷新与设置按钮属于设计与实现严重脱节**：
   - 顶部 `⚙️` 图标实际绑定的是底部折叠的“高级诊断抽屉” (`#diagnosticsDrawer`)，且位于视口滚动区域之外，点击既无弹窗亦无滚动，完全没有真正的“设置”界面。
   - 顶部 `🔄` 刷新按钮无动画、无加载态，且仅单纯重查 Service Worker 的当前快照，无法自愈任何已知错误，点击后界面像素没有任何变化，形同虚设。

---

## 2. 核心问题一：多窗口捕获后仅最后一个正常，其余全部显示 Error

### 2.1 故障现象与复现链路
- **用户操作链路**：
  1. 用户在窗口/标签页 A 打开音视频播放，点击“Balance This Tab”，标签 A 正常进入 Running 状态。
  2. 用户在窗口/标签页 B 打开音视频播放，点击“Balance This Tab”，标签 B 进入 Running 状态。
  3. 观察 Popup 界面：标签 B 显示正常（绿色/橙色 Balanced/Balancing/Limited），但标签 A 及之前的所有标签全部变为红色 **Error** 徽章。

### 2.2 核心根因分析（深度代码与 Chromium 机制）

#### ① 罪魁祸首：请求视频流并在获取后立即 stop()
在 [`src/engine/audio-source.js`](file:///d:/CHATGPT_WORKSPACE/WebAudioBalance/src/engine/audio-source.js#L59-L78)：
```javascript
// src/engine/audio-source.js
const stream = await navigator.mediaDevices.getUserMedia({
  audio: {
    mandatory: {
      chromeMediaSource: 'tab',
      chromeMediaSourceId: this.streamId
    }
  },
  video: { // <--- 致命诱因：多余请求了视频流
    mandatory: {
      chromeMediaSource: 'tab',
      chromeMediaSourceId: this.streamId
    }
  }
});

// Immediately stop redundant video track to free graphics compositor resources
const videoTracks = stream.getVideoTracks();
videoTracks.forEach((t) => {
  try { t.stop(); } catch (_) {} // <--- 致命诱因：手动停止视频轨道
});
```

#### ② Chromium 底层状态转移机制
通过查阅 Chromium 源码 `chrome/browser/extensions/api/tab_capture/tab_capture_registry.cc`：
```cpp
void TabCaptureRegistry::OnRequestUpdate(
    int target_render_process_id,
    int target_render_frame_id,
    blink::mojom::MediaStreamType stream_type,
    const content::MediaRequestState new_state) {
  ...
  switch (new_state) {
    case content::MEDIA_REQUEST_STATE_CLOSING:
      next_state = tab_capture::TabCaptureState::kStopped; // 视频轨道 stop() 触发关闭
      break;
  }
  request->UpdateCaptureState(next_state);
}
```
当 JavaScript 执行 `videoTrack.stop()` 后，Chromium 认为捕获请求正在关闭，将该 `LiveRequest` 的状态强制更新为 `kStopped`，并通过 `chrome.tabCapture.onStatusChanged` 广播 `status: 'stopped'`。此时 `chrome.tabCapture.getCapturedTabs()` 返回的所有捕获条目均为：
```json
{ "tabId": 1278003522, "status": "stopped" }
```

#### ③ 控制面 Coordinator 的“过度校验”陷阱
在 [`src/control/coordinator.js`](file:///d:/CHATGPT_WORKSPACE/WebAudioBalance/src/control/coordinator.js#L576-L584)：
```javascript
// Corroboration diagnostic check (Section 12.2)
const tabCaptureRecord = capturedTabsList.find(c => c.tabId === tabId);
if (tabCaptureRecord && (tabCaptureRecord.status === 'stopped' || tabCaptureRecord.status === 'error')) {
  logger.warn(`Capture mismatch: Live engine exists for tab ${tabId} but tabCapture reports status ${tabCaptureRecord.status}`);
  regTab.runtime.lastRuntimeError = createRuntimeError(
    ErrorCodes.CAPTURE_STATE_MISMATCH,
    `Audio engine running but browser tabCapture reports ${tabCaptureRecord.status}`,
    { tabId, retryable: true }
  );
}
```
当第二个标签 B 开启捕获时，Service Worker 收到 `tabCapture.onStatusChanged` 事件，触发全量状态对账 `coordinator.reconcileRuntime()`。对账程序扫描所有已管理标签：
- 对于**先前的标签 A**：因为标签 A 的视频流早被 stop()，`tabCaptureRecord.status` 为 `'stopped'`，对账逻辑立即将其打上 `CAPTURE_STATE_MISMATCH: Audio engine running but browser tabCapture reports stopped` 的错误标记。
- 对于**最后的标签 B**：标签 B 刚在 `startManagingTab()` 中完成了启动，事务末尾显式将标签 B 的 `lastRuntimeError` 覆盖重置为 `null`。
- **呈现结果**：在 Popup 中，UI 依据 `state-presenter.js` 的优先级规则（Error 状态享有最高优先级），导致标签 A 显示为红色 **Error**，而只有标签 B 呈现正常。

### 2.3 验证证据与实验日志
在真实 Edge/Chrome 浏览器环境下的实机复现实验结果显示：
```json
"browserCaptured": [
  { "tabId": 1278003522, "status": "stopped" }, // 标签 A 被浏览器内部置为 stopped
  { "tabId": 1278003523, "status": "stopped" }  // 标签 B 也被浏览器内部置为 stopped
],
"offscreenEngines": [
  { "tabId": 1278003522, "engineState": "RUNNING", "ctxState": "running" }, // 实际底层音频全部活着！
  { "tabId": 1278003523, "engineState": "RUNNING", "ctxState": "running" }
]
```
对比实验：我们将 `getUserMedia` 修改为**纯音频请求**（移除了 `video` 约束），两标签同时捕获后：
```json
"capturedTabs": [
  { "tabId": 1188766623, "status": "active" }, // 全部维持 active！
  { "tabId": 1188766624, "status": "active" }  // 彻底消除 stopped！
]
```
这铁证表明：**Chromium 完全支持多标签同时纯音频捕获，此缺陷纯属前端代码盲目索取并中断视频轨道而触发的自身状态机自残**。

---

## 3. 核心问题二：未能够实现捕获后所有窗口之间的自动音量平衡

### 3.1 故障现象与用户感知偏差
用户反馈：“没有能够实现自动平衡捕获后的所有窗口之间的音量平衡”。
在实际体验中，用户开启了扩展后，常常感觉：
1. 一个窗口明明说话很轻，但声音没有被明显提上去。
2. 多个窗口交替发声或同时发声时，响度依然忽大忽小，完全没有“拉齐到同一水平线”的平衡感。

### 3.2 根因一：多标签崩溃导致的级联失效
正如问题一所述，当用户开启多个窗口后，先前的窗口立刻被标记为 `Error`。在业务表现层上，用户看到的是错误红标，以为该窗口已经捕获失败，且对账机制干扰了连续增益调整。

### 3.3 根因二：静音/语音停顿导致短时窗被频繁清空与增益冻结
这是 DSP 控制算法层面的**严重设计缺陷**：

#### ① 停顿重置 Epoch
在 [`src/engine/audio-engine.js`](file:///d:/CHATGPT_WORKSPACE/WebAudioBalance/src/engine/audio-engine.js#L159-L163)：
```javascript
// 3. Handle silence -> active resume transition: reset epoch to avoid silence poisoning
if (!this.wasActive && activity.isActive) {
  if (this.inputMeter) this.inputMeter.resetEpoch();
  if (this.outputMeter) this.outputMeter.resetEpoch();
  if (this.controller) this.controller.resetEpoch();
}
```
而在 [`src/engine/activity-detector.js`](file:///d:/CHATGPT_WORKSPACE/WebAudioBalance/src/engine/activity-detector.js#L9)：
```javascript
this.holdTimeMs = options.holdTimeMs ?? 600; // 仅保持 600ms
```
只要说话人一句讲完停顿超过 0.6 秒（正常语速下句与句之间通常停顿 0.8~1.5 秒），`activity.isActive` 就会跌落为 `false`。下一句话开口时，立即触发 `resetEpoch()`！

#### ② 重置清空历史切片，抹杀短时响度
在 [`src/engine/dsp/loudness-core.js`](file:///d:/CHATGPT_WORKSPACE/WebAudioBalance/src/engine/dsp/loudness-core.js#L206-L216)：
```javascript
resetEpoch() {
  this.slices = [];             // 清空所有切片！
  this.totalSlicesProcessed = 0; // 重置切片计数！
  if (this.lastMeasurement) {
    this.lastMeasurement.momentaryValid = false;
    this.lastMeasurement.shortTermValid = false;
  }
}
```

#### ③ 控制器对非稳态短时窗采取“零增益”保守策略
在 [`src/engine/normalization-controller.js`](file:///d:/CHATGPT_WORKSPACE/WebAudioBalance/src/engine/normalization-controller.js#L215-L224)：
```javascript
if (!shortTermValid) {
  // Momentary is valid, but Short-Term (< 3s) is still warming up
  if (momentaryLufs > this.globalTargetLufs) {
    // 遇到大声声音，快速压低保护
    controlLufs = momentaryLufs;
  } else {
    // 遇到小声声音：保守处理，不予放大！
    controlLufs = this.globalTargetLufs; // 强制等于目标 LUFS (-18)
  }
}
// 计算期望增益：
const rawAutoGain = this.globalTargetLufs - controlLufs; 
// 当 controlLufs 强制等于 this.globalTargetLufs 时，rawAutoGain 恒等于 0 dB！
```
**死循环后果**：
- 人在说话时，每句话之间停顿 >0.6s $\rightarrow$ 历史数据被全量清空 $\rightarrow$ 要求重新连续积累 3.0 秒的切片才算 `shortTermValid`。
- 但一句话通常也就 2~3 秒就再次停顿！
- 因此在绝大部分人类语音、播客、解说、游戏直播中，`shortTermValid` **永远无法建立**！
- 面对偏小的声音（例如 -26 LUFS 的微弱声音），计算增益永远被迫取 0 dB。**较小的声音永远得不到放大配平！**

### 3.4 根因三：缺少跨标签动态相对配平逻辑（独立静态绝对目标模型局限）
WebAudioBalance 现在的设计实际上是 **“各自独立单标签响度规整器”**，并不是真正的 **“跨窗口动态协调配平器”**：
- 每个标签各自独立地朝静态目标 `-18 LUFS` 逼近。
- 系统缺乏一个中央的“主控混音/平衡调度总线”来评估：
  - “窗口 A 当前响度是 -20 LUFS，窗口 B 当前响度是 -14 LUFS，背景音乐窗口 C 应该被相对 ducking 压低多少？”
  - “当窗口 A 遇到 Headroom 物理天花板无法放大到 -18 时，是否应该动态将窗口 B 相应下压，以保持两者听感响度一致？”
由于没有跨标签的关联动态控制，一旦某个窗口受限于峰值无法提升，两窗口之间的响度差便原封不动地暴露给用户。

### 3.5 根因四：激进的安全包络（Headroom Ceiling）压制
在 [`src/engine/normalization-controller.js`](file:///d:/CHATGPT_WORKSPACE/WebAudioBalance/src/engine/normalization-controller.js#L238-L242)：
```javascript
const safeHeadroomGain = this.outputCeilingDbFS - this.peakMarginDb - samplePeakDbFS;
// outputCeilingDbFS = -1.0, peakMarginDb = 1.0 => 天花板固定在 -2.0 dBFS
```
如果音频中带有瞬态尖峰（如轻微的爆音、敲击声、齿音，峰值达到 -4 dBFS）：
`safeHeadroomGain = -2.0 - (-4.0) = +2.0 dB`。
即使用户音频的平均听感响度极低（-30 LUFS，理论需要 +12 dB 提升），算法也会被这个瞬时峰值硬性锁死在 +2 dB，并进入 `Limited` 状态。

---

## 4. 核心问题三：UI 上的“刷新”、“设置”等按钮似乎没有作用

### 4.1 “设置”按钮（⚙️）的视觉欺骗与离屏抽屉缺陷

#### ① 视觉与预期错位
在 [`src/popup/popup.html`](file:///d:/CHATGPT_WORKSPACE/WebAudioBalance/src/popup/popup.html#L20-L22)：
```html
<div class="header-actions">
  <button id="btnRefresh" class="icon-btn" title="Refresh tabs" aria-label="Refresh tabs">🔄</button>
  <button id="btnToggleDiagnostics" class="icon-btn" title="Toggle diagnostics" aria-label="Toggle diagnostics">⚙️</button>
</div>
```
- 图标采用了通用设置齿轮 `⚙️`。所有用户下意识认为这是“偏好设置 / 首选项”。
- 但实际绑定的代码是：
```javascript
// src/popup/popup.js
btnToggleDiagnostics.addEventListener('click', () => {
  if (diagnosticsDrawer) {
    diagnosticsDrawer.open = !diagnosticsDrawer.open;
    if (diagnosticsDrawer.open) renderDiagnosticsMetrics();
  }
});
```

#### ② 离屏且无交互反馈
- `#diagnosticsDrawer` 是页面最底部的 HTML5 `<details>` 原生抽屉（第 100 行），排在当前标签卡片、已平衡卡片列表、已检测音频列表的下方。
- Popup 窗口高度有限（默认 400~500px），只要当前有 1~2 个标签卡片，诊断抽屉就完全被挤到了**视口可视区域之外（Fold 之下）**。
- 用户点击顶部右上角的 `⚙️`，页面顶部没有任何动静、没有弹出层、没有自动平滑滚动到底部、按钮自身也没有激活高亮态。用户自然认为“点击毫无反应，按钮坏了”。
- 此外，项目中**根本不存在真正的“设置页面”**（没有常规设置选项，如默认目标 LUFS、快捷键配置、启动行为等）。

### 4.2 “刷新”按钮（🔄）的静默无反馈与无自愈能力

#### ① 缺乏任何 UI 加载/旋转反馈
在 [`src/popup/popup.js`](file:///d:/CHATGPT_WORKSPACE/WebAudioBalance/src/popup/popup.js#L83)：
```javascript
btnRefresh.addEventListener('click', () => refreshAll());
```
- 点击后既没有给按钮添加旋转 CSS 类（例如 `animate-spin`），也没有任何 Toast 提示。
- 数据读取是异步内存通信，耗时极短（几毫秒到几十毫秒）。刷新完成后重新渲染 DOM，由于数据没有变动，页面上连一个像素的闪烁变化都没有，用户感官上等同于“未响应”。

#### ② 缺少自愈与重试逻辑
- 当标签页已经进入 `Error` 状态后，`refreshAll()` 执行的只是：
  1. 向 Service Worker 发送 `GET_PRODUCT_SNAPSHOT` 查询当前快照。
  2. 向浏览器查询当前活动标签页。
- 它**压根不会清空错误标记**，**也不会通知后台重新尝试链接音频流**，只是把原有的带有 `lastRuntimeError` 的快照原样重新画了一遍。
- 用户期望点击“刷新”能够“重新检测/重试恢复错误标签”，但现在的实现只能让错误卡片维持错误状态，起不到任何修复作用。

---

## 5. 系统实现与设计规格偏离对比表

| 功能模块 | 预期产品设计目标 | 当前实际代码实现 | 偏差等级 | 核心影响 |
|---|---|---|:---:|---|
| **TabCapture 流获取** | 仅捕获目标标签的纯音频流 | 请求了 `audio` 与 `video`，并在获取后立即调用 `videoTrack.stop()` | **致命 (Critical)** | 触发 Chromium `kStopped` 内部事件，导致所有已存在标签被标记为 `CAPTURE_STATE_MISMATCH` 报错 |
| **状态对账器 (Coordinator)** | 发现引擎与浏览器脱节时自愈或同步 | 发现 `capturedTabsList` 中包含 `'stopped'` 记录，立即判定错误，覆盖写入 `lastRuntimeError` | **高危 (High)** | 误伤处于正常工作中的前序引擎，导致只有最后一个开启捕获的标签显示正常 |
| **响度积分器 (Loudness Core)** | 连续计算音频响度，平滑过渡 | 每次语间停顿（>0.6s）彻底清空所有历史切片与短时窗有效性 | **高危 (High)** | 正常对话语音永远无法跨过 3 秒暖机阈值，较小声音增益恒为 0 dB，无法平衡微弱音量 |
| **多标签音量平衡机制** | 多个标签页之间音量智能平衡 | 各标签独立对标固定的 -18 LUFS，无多窗口全局联动，且前序标签因报错直接退出控制 | **严重 (Major)** | 无法实现多窗口声音的听感一致与动态协调配平 |
| **UI 交互：设置 (⚙️)** | 打开插件全局参数设置或浮层 | 仅切换底部不可见的原生 `<details>` 诊断抽屉，无滚动与视觉反馈 | **中度 (Medium)** | 用户普遍误认为按钮失灵无作用 |
| **UI 交互：刷新 (🔄)** | 重新检测、重试错误连接、提供刷新动效 | 静默无动效重新加载相同快照，无自愈能力 | **中度 (Medium)** | 遇到临时异常无法通过刷新恢复，操作感知极差 |

---

## 6. 整改与修复技术方案建议 (Actionable Recommendations)

针对上述四大核心根因，建议实施以下四项专项整改：

### 6.1 音频捕获纯音频改造与误报校验纠正
1. **彻底移除视频轨道请求**：
   修改 [`src/engine/audio-source.js`](file:///d:/CHATGPT_WORKSPACE/WebAudioBalance/src/engine/audio-source.js#L59-L78)：
   ```javascript
   // 仅请求音频，彻底杜绝 video 及其 stop() 产生的所有副作用
   const stream = await navigator.mediaDevices.getUserMedia({
     audio: {
       mandatory: {
         chromeMediaSource: 'tab',
         chromeMediaSourceId: this.streamId
       }
     }
   });
   ```
2. **修正对账逻辑中的假死判断**：
   在 [`src/control/coordinator.js`](file:///d:/CHATGPT_WORKSPACE/WebAudioBalance/src/control/coordinator.js#L576-L584)：
   对账时，只要 Offscreen 文档中的 `liveEngine` 处于 `RUNNING` 且音频上下文处于 `running`，且连续有 Telemetry 指标产出，就必须以实际运行的引擎为权威真实源，不得盲目依据已停止的视频轨道历史记录将标签置为 Error。

### 6.2 响度控制器的语音停顿抗扰与自适应暖机优化
1. **防止频繁清空历史切片**：
   - 提高语音活跃保持时间 (`holdTimeMs`)，从目前的 600ms 放宽至 1500ms~2000ms。
   - 在从静音恢复时，**不要全量删除切片数组** (`this.slices = []`)，而是采用 ITU-R BS.1770-5 标准的门限加权（Gating -70 dBFS 绝对门限与 -10 LU 相对门限），仅丢弃静音帧的能量，保留先前有效发声切片的积分。
2. **自适应短时窗增益补偿**：
   - 当 `shortTermValid` 尚未满足但 `momentaryValid`（400ms）有效时，允许以受限的斜率基于瞬时响度先行进行温和的正向增益提升，彻底打破“小声语音永远提升不了”的死锁局面。

### 6.3 跨窗口相对音量平衡编排器（Cross-Tab Balancer）增强
1. 在 `MultiTabCoordinator` 中建立轻量级的**跨窗口响度仲裁逻辑**：
   - 周期性比对所有活跃运行标签的输出响度。
   - 当某标签因硬件或峰值原因受到 Headroom 限制（如上限只能到 -22 LUFS），系统提供联动平衡模式，将其他过响的标签适当等比下调，确保多个标签之间的**相对听感响度恒定**。

### 6.4 弹出层 UI 与操作交互彻底重构
1. **优化设置与诊断按钮**：
   - 将顶部 `⚙️` 图标明确拆分为独立的 **“设置”**（或更替为诊断图标如 `📊` 或 `🛠️`），或者点击时以抽屉 Modal / 自动平滑滚动 (`scrollIntoView({ behavior: 'smooth' })`) 的形式直接呈现在可视区域。
   - 增加一个真实的轻量级设置面（如调整默认目标 LUFS、响应速度等）。
2. **增强刷新按钮自愈力与动效**：
   - 点击 `🔄` 时，为按钮添加持续 500ms 的旋转 CSS 动画。
   - 在刷新逻辑中加入**主动自愈探测**：若检测到标签处于 Error 状态，尝试触发安全重连或恢复提示。

---

## 7. 结论

当前项目未能达到预期的主要症结并非底层 Web Audio 架构不可行，而是由**视频流无意中断引发的 Chromium 状态链条误伤**与**响度控制器重置逻辑过激**双重诱发。只要实施纯音频捕获改造、理顺对账权威源、平滑停顿重置机制并补齐 UI 交互闭环，当前项目即可完整实现预期的跨窗口多标签自动响度平衡功能。
