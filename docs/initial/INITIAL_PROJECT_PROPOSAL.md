# 跨标签页智能响度平衡与独立音频控制插件 (Web Audio Normalizer)
> 项目立项规范、核心架构设计与工程研发计划书

---

## 1. 项目背景与需求分析

### 1.1 核心痛点
在日常使用现代浏览器（Chrome / Edge）时，用户经常同时打开多个发声媒体标签页（如视频平台、直播流、播客、背景音乐等）。不同视频和音频源的制作标准差异极大，普遍存在以下问题：
* 基准音量断层：网页 A（如个人播客）整体音量极其微弱（峰值仅有 -30 dBFS 左右）；网页 B（如电竞赛事直播、短视频或开屏广告）开播即满载轰鸣（接近 0 dBFS），用户需要频繁手动调节系统总音量。
* 现有插件能力割裂：
  - 单标签页压缩插件（如 Audio Compressor）：只能在单个页面内部做“削峰填谷”，各个页面互为孤岛，无法跨标签页统筹绝对响度。
  - 标签页调音插件（如 Volume Master）：提供多标签集中面板，但缺乏自动化算法，用户必须针对每个发声网页人肉反复拖拽滑块。

### 1.2 项目定位
打造一款基于 Chrome/Edge Manifest V3 的浏览器扩展工具，具备以下核心能力：
1. 自动对齐：集中探测全浏览器发声标签页，平滑将各个不同来源的感知响度自动归一化到预设基准范围（默认目标设为 -18 dBFS）。
2. 独立调控：在自动归一化的基准之上，提供统一弹出面板（Popup UI），允许用户对任意特定标签页执行独立的音量增益/衰减偏移（-12 dB ~ +12 dB）。
3. 低侵入、零依赖：基于标准 Web Audio API 运行，纯前端架构，无需本地安装 .exe 驱动或后台代理进程。

---

## 2. 总体架构与数据流设计

系统采用“分布式页面探针 (Content) + 集中式调度大脑 (Background) + 响应式交互面板 (Popup)”的分层设计。

### 2.1 整体拓扑结构
* [Popup UI 面板]：负责展示全局自动归一化开关、目标档位选择，以及实时发声标签页卡片列表与微调滑块。
* [Background Service Worker]：维护全局发声注册表 (Tab Registry)，负责滑动窗口均值计算与 AGC 补偿仲裁。
* [Tab Content Script 探针]：负责 MediaElement 探测与劫持、AnalyserNode RMS 分贝采样，以及 GainNode 执行平滑增益注入。

### 2.2 详细数据流转时序
1. 注入与劫持：Content Script 监听到页面挂载 video 或 audio，将其接入由 AudioContext 驱动的处理链路。
2. 采样与上报：Content Script 内置定时器（默认 250ms），通过 AnalyserNode 获取时域浮点数据，计算短时均方根值（RMS）并转换为分贝（dBFS），携带 tabId 上报至 Background。
3. 集中仲裁与平滑阻尼：Background 汇集所有活动标签页的分贝数据。
   - 计算偏差：ΔdB = Target_dB - Current_RMS_dB
   - 计算自动补偿值：Gain_auto = 10^(ΔdB / 20)
4. 增益注入与执行：Background 下发 Gain_auto 指令，Content Script 将其与用户手动微调值 Gain_manual 复合：
   Gain_final = Gain_auto * Gain_manual
   通过 gainNode.gain.setTargetAtTime(target, audioCtx.currentTime, 0.3) 在 300ms 内平缓过渡，规避音量突变与破音。

---

## 3. 核心算法与数学模型

### 3.1 短时有效响度采样 (RMS 计算)
页面探针通过 AnalyserNode.getFloatTimeDomainData() 读取即时采样帧（帧长 N = 2048）：

RMS = sqrt( (1 / N) * sum(x_i^2) )
L_dBFS = 20 * log10( max(RMS, 10^-5) )

注：设置底限 10^-5（对应 -100 dBFS），防止完全静音时计算产生负无穷。

### 3.2 动态自适应平滑算法 (防止呼吸效应/泵浦效应)
为了避免背景音乐间歇或人声停顿导致增益疯狂拉扯，Background 端加入两级过滤逻辑：
1. 静音忽略门限 (Silence Gate)：当瞬时 L_dBFS < -50 dBFS 时，判定为静音或环境空白段，冻结当前的补偿增益，禁止盲目提升底噪。
2. 非对称响应时间常数：
   - 压低（Attack）：检测到过载爆音时，快速响应（约 50ms 注入），防止刺耳。
   - 拉升（Release）：检测到弱音需要补益时，慢速上升（约 1500ms 注入），确保声音动态自然。

---

## 4. 关键技术边界与攻坚方案

1. CORS 跨域媒体污染
- 影响表现：跨域视频（如 CDN 加载）接入 Web Audio 会触发安全静音。
- 应对对策：使用 MV3 的 declarativeNetRequest API，针对音视频媒体请求的响应头无条件补全 Access-Control-Allow-Origin: *。

2. 自动播放策略限制
- 影响表现：浏览器禁止未产生交互的标签页初始化声音上下文。
- 应对对策：捕获媒体的 play / playing 原生事件，在初次监听到播放动作时通过 audioCtx.resume() 唤醒上下文。

3. DRM 加密流保护
- 影响表现：部分流媒体采用 EME / Widevine 加密，PCM 无法直接读取。
- 应对对策：DOM 节点接入失败时，提示用户降级启用单标签页录制接口 chrome.tabCapture 作为音频输入源。

4. 后台生命周期中断
- 影响表现：Manifest V3 的 Service Worker 在空闲时会被系统冻结。
- 应对对策：使用基于 Port 的长连接保活机制；所有关键状态保存在 chrome.storage.session 中，以便快速恢复。

---

## 5. 项目工程规划与甘特里程碑 (4 周排期)

* W1 (原型与管线)：Web Audio 管线原型构建、跨域与自动播放策略突破。
* W2 (仲裁与算法)：Background 集中仲裁逻辑、非对称增益平滑算法实现。
* W3 (UI与交互)：Popup 面板状态与滑块组件、多标签场景全链路联调。
* W4 (调优与发布)：边界测试、性能调优与发布准备。

### 里程碑交付物定义
* 里程碑 1 (Week 1)：单页音频捕获与处理闭环。完成 manifest.json 与 content-script.js 最小闭环。能够稳定劫持当前页面的 video/audio 节点，实时输出 RMS 分贝数据，并支持外部增益写入。
* 里程碑 2 (Week 2)：跨标签页自动对齐算法就绪。background.js 实现多标签数据聚合。多开 2 个不同音量的视频网站时，后台能正确下发补偿指令，将两者的平均音量拉齐至目标分贝。
* 里程碑 3 (Week 3)：交互面板开发与状态双向同步。美观的 Popup 界面，展示发声标签列表。支持全局“自动平衡”总开关切换，每个标签页拥有各自的独立调节滑块，支持 -12 dB ~ +12 dB 范围的手动干预。
* 里程碑 4 (Week 4)：性能优化与发布打包。长驻运行 CPU 额外开销 < 2%；完成 Chrome Web Store 及 Edge Add-ons 商店提审物料打包。

---

## 6. 核心文件代码参考

### 6.1 manifest.json
{
  "manifest_version": 3,
  "name": "Web Audio Normalizer",
  "version": "1.0.0",
  "description": "智能跨标签页自动音量平衡与独立音量管理工具",
  "permissions": ["storage", "declarativeNetRequest", "tabs"],
  "host_permissions": ["<all_urls>"],
  "background": { "service_worker": "background.js" },
  "content_scripts": [
    {
      "matches": ["<all_urls>"],
      "js": ["content-script.js"],
      "run_at": "document_end"
    }
  ],
  "action": {
    "default_popup": "popup.html",
    "default_title": "Web Audio Normalizer"
  }
}

### 6.2 content-script.js
let audioCtx = null;
let gainNode = null;
let analyserNode = null;
let hookedElements = new WeakSet();
let manualGain = 1.0;
let autoGain = 1.0;

function initAudioPipeline() {
  if (audioCtx) return;
  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  analyserNode = audioCtx.createAnalyser();
  analyserNode.fftSize = 2048;

  gainNode = audioCtx.createGain();
  gainNode.gain.setValueAtTime(1.0, audioCtx.currentTime);

  analyserNode.connect(gainNode);
  gainNode.connect(audioCtx.destination);
  startLevelReporter();
}

function hookElement(el) {
  if (hookedElements.has(el)) return;
  initAudioPipeline();
  try {
    el.crossOrigin = "anonymous";
    const source = audioCtx.createMediaElementSource(el);
    source.connect(analyserNode);
    hookedElements.add(el);
  } catch (err) {
    console.warn("[AudioNormalizer] 节点挂载跳过:", err);
  }
}

function startLevelReporter() {
  const buffer = new Float32Array(analyserNode.fftSize);
  setInterval(() => {
    if (audioCtx.state === 'suspended') return;
    analyserNode.getFloatTimeDomainData(buffer);
    let sum = 0;
    for (let i = 0; i < buffer.length; i++) {
      sum += buffer[i] * buffer[i];
    }
    const rms = Math.sqrt(sum / buffer.length);
    const db = 20 * Math.log10(Math.max(rms, 1e-5));

    chrome.runtime.sendMessage({
      type: "REPORT_LEVEL",
      db: db,
      title: document.title
    }).catch(() => {});
  }, 250);
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "APPLY_GAIN" && gainNode && audioCtx) {
    if (msg.autoGain !== undefined) autoGain = msg.autoGain;
    if (msg.manualGain !== undefined) manualGain = msg.manualGain;
    const finalGain = autoGain * manualGain;
    gainNode.gain.setTargetAtTime(finalGain, audioCtx.currentTime, 0.3);
  }
});

document.querySelectorAll('video, audio').forEach(hookElement);
const observer = new MutationObserver(() => {
  document.querySelectorAll('video, audio').forEach(hookElement);
});
observer.observe(document.body, { childList: true, subtree: true });

window.addEventListener('click', () => {
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
}, { once: true });

### 6.3 background.js
const TARGET_DB = -18.0;
const activeTabs = new Map();
let globalAutoNormalize = true;

chrome.runtime.onMessage.addListener((msg, sender) => {
  const tabId = sender.tab?.id;
  if (!tabId) return;

  if (msg.type === "REPORT_LEVEL") {
    const currentRecord = activeTabs.get(tabId) || { manualGain: 1.0, autoGain: 1.0 };
    currentRecord.db = msg.db;
    currentRecord.title = msg.title;
    currentRecord.lastSeen = Date.now();
    activeTabs.set(tabId, currentRecord);

    if (globalAutoNormalize && msg.db > -45.0) {
      const deltaDb = TARGET_DB - msg.db;
      const clampedDelta = Math.max(-15.0, Math.min(15.0, deltaDb));
      const calculatedAutoGain = Math.pow(10, clampedDelta / 20);

      currentRecord.autoGain = calculatedAutoGain;
      chrome.tabs.sendMessage(tabId, {
        type: "APPLY_GAIN",
        autoGain: calculatedAutoGain
      }).catch(() => {});
    }
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  activeTabs.delete(tabId);
});

---

## 7. 验收标准与交付规范

1. 自动归一化准确度：在两个标签页分别播放源响度相差 >= 12 dB 的视频时，开启功能后 2 秒内，两者的实际听觉响度差距需收敛至 <= 2 dB 范围以内。
2. 手动微调独立性：在已平衡状态下，在 Popup 面板对标签页 A 进行手动提亮 +6 dB，标签页 B 的输出增益与平衡状态不得产生联动抖动。
3. 播放流畅度：注入 Web Audio 链路后，媒体画面帧率波动 <= 1 fps，音画同步偏移量控制在 ±10 ms 以内。