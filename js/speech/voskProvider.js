// voskProvider.js - Vosk 本地语音识别 Provider
// 基于 vosk-browser（Kaldi WASM，ccoreilly 维护，Apache-2.0）
// 特点：无需 COOP/COEP（非 SIMD 构建）、Safari 兼容好、库内部自动管理 Worker 和 IDBFS 模型缓存
// 模型格式支持 .zip（libarchive 按 magic bytes 识别，非扩展名）
// 动态加载 vosk-browser CDN，避免在未使用时增加 5.8MB 带宽

// 检查基类是否已加载（防御性，避免因 script 顺序问题导致继承失败）
if (typeof SpeechProvider === 'undefined') {
    console.error('[VoskProvider] SpeechProvider 基类未加载，请检查 script 加载顺序');
}

// Vosk 中文小模型（vosk-model-small-cn-0.22，43MB，Apache-2.0）
// alphacephei 官方 .zip 格式，libarchive 自动解压（源码确认支持 zip）
// 库内部用 IDBFS 自动缓存到 IndexedDB，第二次加载跳过下载
const VOSK_MODEL_URL = 'https://alphacephei.com/vosk/models/vosk-model-small-cn-0.22.zip';

// vosk-browser CDN（UMD bundle，约 5.8MB，内含 base64 编码的 wasm，无独立 wasm 文件）
const VOSK_CDN_URL = 'https://cdn.jsdelivr.net/npm/vosk-browser@0.0.8/dist/vosk.js';

class VoskProvider extends (SpeechProvider || class {}) {
    constructor(recorder) {
        super(recorder);
        // 引擎元信息
        this.id = 'vosk';
        this.displayName = '本地识别 (Vosk)';
        this.modelSize = '约43MB';
        this.requiresNetwork = true; // 首次需加载库(5.8MB) + 模型(43MB)

        // 模型加载状态
        this._loading = false;
        this._loaded = false;
        this._scriptLoaded = false; // vosk-browser JS 是否已加载

        // Vosk 实例
        this._model = null;        // Vosk.Model 实例（库内部管理 Worker）
        this._recognizer = null;   // KaldiRecognizer 实例

        // 音频采集相关
        this._audioContext = null;
        this._mediaStream = null;
        this._processor = null;
        this._pausedDuration = 0;  // 已暂停时长（用于恢复计时）

        // 回调（start 时注入）
        this._onResult = null;
        this._onPartial = null;
        this._onError = null;

        // partial 文本去重（Vosk partial 会重复发送同一文本）
        this._lastPartial = '';
    }

    isSupported() {
        // 需要 AudioContext、getUserMedia、WebAssembly
        // 不需要 SharedArrayBuffer / COOP / COEP（vosk-browser 非 SIMD 构建，单线程）
        return (window.AudioContext || window.webkitAudioContext) &&
               navigator.mediaDevices && navigator.mediaDevices.getUserMedia &&
               typeof WebAssembly !== 'undefined';
    }

    /**
     * 动态加载 vosk-browser CDN 脚本（只在首次使用时加载，避免增加其他模式的带宽）
     * @returns {Promise<void>}
     */
    _loadVoskScript() {
        if (this._scriptLoaded && window.Vosk) return Promise.resolve();
        return new Promise((resolve, reject) => {
            // 避免重复插入
            if (window.Vosk) {
                this._scriptLoaded = true;
                resolve();
                return;
            }
            const script = document.createElement('script');
            script.src = VOSK_CDN_URL;
            script.async = true;
            script.onload = () => {
                if (window.Vosk) {
                    this._scriptLoaded = true;
                    console.log('[Vosk] vosk-browser 库加载完成');
                    resolve();
                } else {
                    reject(new Error('vosk-browser 加载完成但未暴露 Vosk 全局对象'));
                }
            };
            script.onerror = () => {
                reject(new Error('vosk-browser CDN 加载失败（jsdelivr 不可达？）'));
            };
            document.head.appendChild(script);
        });
    }

    /**
     * 预加载 Vosk 模型
     * 流程：动态加载 vosk-browser JS → createModel（自动下载并解压模型到 IDBFS）
     * 首次加载约 43MB，之后从 IndexedDB 缓存读取（库内部自动判断 extracted.ok 标记）
     */
    async preload(onProgress) {
        if (this._loaded || this._loading) {
            if (this._loading) UI.showToast('Vosk 模型正在加载中，请稍候...');
            return;
        }
        this._loading = true;
        this.status = 'loading';
        // 复用 whisper-model-status 元素（阶段 5 统一 UI 前的临时方案）
        const statusEl = document.getElementById('vosk-model-status') || document.getElementById('whisper-model-status');
        try {
            // 1. 动态加载 vosk-browser 库（约 5.8MB，含 base64 wasm）
            if (statusEl) statusEl.textContent = 'Vosk：正在加载引擎库（约5.8MB）...';
            await this._loadVoskScript();

            // 2. 创建 Model（库内部自动创建 Worker，下载 .zip 并用 libarchive 解压到 IDBFS）
            //    首次下载约 43MB，之后从 IndexedDB 缓存读取（跳过下载，仅初始化 WASM）
            if (statusEl) statusEl.textContent = 'Vosk：正在加载模型（首次约43MB，之后缓存）...';
            if (onProgress) onProgress({ status: 'downloading', progress: 0 });

            this._model = await Vosk.createModel(VOSK_MODEL_URL);

            this._loaded = true;
            this.isReady = true;
            this.status = 'ready';
            console.log('[Vosk] 模型加载完成');
            if (statusEl) statusEl.textContent = 'Vosk 模型状态：已就绪 ✓';
            if (onProgress) onProgress({ status: 'ready', progress: 100 });
            UI.showToast('Vosk 语音识别模型加载完成');
        } catch (err) {
            console.error('[Vosk] 模型加载失败:', err);
            this.status = 'error';
            if (statusEl) statusEl.textContent = 'Vosk 模型状态：加载失败 - ' + err.message;
            UI.showToast('Vosk 模型加载失败：' + err.message);
            this._log('error', 'Vosk模型加载失败', err.message);
        } finally {
            this._loading = false;
        }
    }

    /**
     * 开始实时录音识别
     * Vosk 是流式识别：持续喂入音频，自动在静音边界触发 result 事件
     * 库内部自动管理 Worker 和重采样（接受任意采样率）
     */
    async start({ onResult, onPartial, onError } = {}) {
        // 保存回调
        this._onResult = onResult;
        this._onPartial = onPartial;
        this._onError = onError;

        if (!this._loaded) {
            UI.showToast('Vosk 模型未加载，正在加载...');
            this._log('warn', 'Vosk模型未加载，开始预加载');
            await this.preload();
            if (!this._loaded) return false;
        }

        try {
            // 获取麦克风音频流（单声道，启用回声消除和降噪提升识别质量）
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    channelCount: 1,
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true
                }
            });
            this._mediaStream = stream;

            // 使用原生采样率 AudioContext（Vosk 接受任意采样率，内部自动重采样到 16kHz）
            const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
            this._audioContext = new AudioContextCtor();
            const sampleRate = this._audioContext.sampleRate;
            console.log('[Vosk] AudioContext 采样率:', sampleRate, '(Vosk 内部重采样到 16kHz)');

            // 创建 Recognizer（sampleRate 必填，告诉 Vosk 输入音频的实际采样率）
            this._recognizer = new this._model.KaldiRecognizer(sampleRate);
            this._recognizer.setWords(false); // 不需要词级时间戳（减少开销）
            this._lastPartial = '';

            // final 结果：Vosk 在检测到静音边界时触发，返回完整句子
            this._recognizer.on("result", (message) => {
                const text = (message.result.text || '').trim();
                if (text) {
                    console.log('[Vosk] final:', text);
                    // 通过回调交给 Recorder 写入文本框（与 Whisper 统一的写入路径）
                    if (this._onResult) this._onResult(text);
                    this._lastPartial = '';
                }
            });

            // partial 结果：实时中间结果（用户说话过程中）
            // 当前 Recorder 无 partial 显示区域，先记录但不输出（阶段 5 UI 可扩展）
            this._recognizer.on("partialresult", (message) => {
                const partial = (message.result.partial || '').trim();
                if (partial && partial !== this._lastPartial) {
                    this._lastPartial = partial;
                    // 预留：阶段 5 可通过 onPartial 回调实时显示
                    if (this._onPartial) this._onPartial(partial);
                }
            });

            // 音频采集：ScriptProcessorNode（与 Whisper 保持一致的技术方案）
            const source = this._audioContext.createMediaStreamSource(stream);
            const processor = this._audioContext.createScriptProcessor(4096, 1, 1);
            this._processor = processor;

            // 通过闭包捕获 this 和 recorder（onaudioprocess 回调里 this 不可靠）
            const self = this;
            const recorder = this.recorder;
            processor.onaudioprocess = (e) => {
                // 通过 recorder.isRecording 判断是否仍在录音（与 Whisper 一致）
                if (!recorder || !recorder.isRecording) return;
                const inputData = e.inputBuffer.getChannelData(0);
                // acceptWaveformFloat 接受 Float32Array（-1.0 到 1.0），库内部转 int16 并重采样
                // Vosk Worker 异步处理，此处不阻塞主线程
                try {
                    self._recognizer.acceptWaveformFloat(inputData, sampleRate);
                } catch (err) {
                    // Worker 可能已终止或异常，记录但不中断录音
                    console.warn('[Vosk] acceptWaveformFloat 异常:', err);
                }
            };

            source.connect(processor);
            // ScriptProcessorNode 必须连接 destination 才能触发 onaudioprocess
            // 通过 GainNode 设为 0 音量，既触发处理又不产生回声
            const silentGain = this._audioContext.createGain();
            silentGain.gain.value = 0;
            processor.connect(silentGain);
            silentGain.connect(this._audioContext.destination);

            this.status = 'running';
            console.log('[Vosk] 录音识别已启动');
            return true;
        } catch (err) {
            console.error('[Vosk] 启动失败:', err);
            this._log('error', 'Vosk启动失败', err.message);
            // 清理已获取的资源
            this.stop(true);
            if (this._onError) this._onError(err);
            UI.showToast('Vosk 识别启动失败：' + err.message);
            return false;
        }
    }

    /**
     * 停止识别
     * @param {boolean} isFullStop - true=完全停止（销毁 recognizer），false=暂停（保留 recognizer 供恢复）
     */
    async stop(isFullStop = true) {
        const wasRunning = !!(this._processor || this._mediaStream);
        if (wasRunning) {
            this._log('info', isFullStop ? 'Vosk完全停止' : 'Vosk暂停', '');
        }

        // 停止音频采集
        if (this._processor) {
            this._processor.onaudioprocess = null;
            this._processor.disconnect();
            this._processor = null;
        }
        if (this._audioContext) {
            this._audioContext.close().catch(() => {});
            this._audioContext = null;
        }
        if (this._mediaStream) {
            this._mediaStream.getTracks().forEach(t => t.stop());
            this._mediaStream = null;
        }

        // 完全停止时销毁 recognizer（释放 Worker 资源）
        // 暂停时保留 recognizer，恢复时复用（避免重建开销）
        if (isFullStop && this._recognizer) {
            try { this._recognizer.remove(); } catch (e) {}
            this._recognizer = null;
        }

        this._lastPartial = '';
        this.status = isFullStop ? 'idle' : 'ready';
        // 不 terminate model（保留 IDBFS 缓存，下次 preload 直接用）
    }

    /**
     * 导入音频文件识别
     * Vosk 是流式识别，文件导入方案：分段喂入 + 末尾静音触发最后的 final
     * Vosk 没有 finalResult() 方法（JS 版与 Python 版差异），依赖静音边界自动触发 result
     */
    async importFile(file, onProgress) {
        if (!this._loaded) {
            UI.showToast('Vosk 模型未加载，正在加载...');
            await this.preload();
            if (!this._loaded) return false;
        }

        const progressEl = document.getElementById('audio-import-progress');
        const barEl = document.getElementById('audio-import-bar');
        const statusEl = document.getElementById('audio-import-status');

        if (progressEl) progressEl.style.display = 'block';
        if (statusEl) statusEl.textContent = '正在加载音频文件...';

        try {
            const arrayBuffer = await file.arrayBuffer();
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
            const duration = audioBuffer.duration;
            const sampleRate = audioBuffer.sampleRate;

            if (duration > 7200) {
                UI.showToast('录音文件过长（超过2小时），请截取后重试');
                if (progressEl) progressEl.style.display = 'none';
                audioContext.close();
                return false;
            }

            if (statusEl) statusEl.textContent = `录音时长 ${Math.floor(duration/60)}分${Math.floor(duration%60)}秒，开始Vosk识别...`;

            // 创建临时 recognizer 用于文件识别（与实时录音的 recognizer 隔离）
            const recognizer = new this._model.KaldiRecognizer(sampleRate);
            let fullText = '';

            recognizer.on("result", (message) => {
                const text = (message.result.text || '').trim();
                if (text) fullText += text;
            });

            const textarea = document.getElementById('transcript');
            const existingText = textarea ? textarea.value.trim() : '';
            if (existingText) {
                this.recorder.accumulatedText = existingText + '\n';
            } else {
                this.recorder.accumulatedText = '';
            }

            // 合并为单声道 Float32Array
            const numChannels = audioBuffer.numberOfChannels;
            const totalSamples = audioBuffer.length;
            const monoData = new Float32Array(totalSamples);
            for (let ch = 0; ch < numChannels; ch++) {
                const channelData = audioBuffer.getChannelData(ch);
                for (let i = 0; i < totalSamples; i++) {
                    monoData[i] += channelData[i];
                }
            }
            if (numChannels > 1) {
                for (let i = 0; i < totalSamples; i++) {
                    monoData[i] /= numChannels;
                }
            }

            audioContext.close();

            // 分段喂入（每 30 秒一段，与 Whisper 文件导入一致）
            // Vosk Worker 异步处理，acceptWaveformFloat 不阻塞，持续喂入即可
            const CHUNK_SEC = 30;
            const chunkSamples = Math.floor(sampleRate * CHUNK_SEC);
            const totalChunks = Math.ceil(totalSamples / chunkSamples);

            for (let i = 0; i < totalChunks; i++) {
                const start = i * chunkSamples;
                const end = Math.min(start + chunkSamples, totalSamples);
                const chunk = monoData.subarray(start, end);
                recognizer.acceptWaveformFloat(chunk, sampleRate);

                // 实时更新文本框（显示已识别的 final 文本）
                if (textarea) {
                    textarea.value = this.recorder.accumulatedText + fullText;
                    textarea.scrollTop = textarea.scrollHeight;
                }
                const pct = Math.round(((i + 1) / totalChunks) * 100);
                if (barEl) barEl.style.width = pct + '%';
                if (statusEl) {
                    const endSec = end / sampleRate;
                    statusEl.textContent = `Vosk识别中 ${Math.floor(endSec/60)}:${Math.floor(endSec%60).toString().padStart(2,'0')} / ${Math.floor(duration/60)}:${Math.floor(duration%60).toString().padStart(2,'0')}（已识别 ${fullText.length} 字）`;
                }
                if (onProgress) onProgress(pct);
                // 让出主线程，让 UI 更新和 Vosk Worker 处理 result 事件
                await new Promise(r => setTimeout(r, 0));
            }

            // 喂入 1.5 秒静音触发最后的 final（Vosk 依赖静音边界触发 result）
            const silence = new Float32Array(Math.floor(sampleRate * 1.5));
            recognizer.acceptWaveformFloat(silence, sampleRate);
            // 等待 Worker 处理完最后的 result（Worker postMessage 是异步的）
            await new Promise(r => setTimeout(r, 2000));

            // 最后检查一次文本框
            if (textarea) {
                textarea.value = this.recorder.accumulatedText + fullText;
            }

            recognizer.remove();

            // 完成
            this.recorder.accumulatedText = (this.recorder.accumulatedText + fullText).trim();
            if (textarea) textarea.value = this.recorder.accumulatedText;

            if (barEl) barEl.style.width = '100%';
            if (statusEl) statusEl.textContent = `Vosk识别完成！共识别 ${fullText.length} 字`;
            UI.showToast(`Vosk识别完成，共识别 ${fullText.length} 字`);

            setTimeout(() => {
                if (progressEl) progressEl.style.display = 'none';
                if (barEl) barEl.style.width = '0%';
            }, 3000);

            return true;
        } catch (err) {
            console.error('[Vosk] 文件导入失败:', err);
            UI.showToast('Vosk识别失败：' + (err.message || '不支持的音频格式'));
            if (progressEl) progressEl.style.display = 'none';
            return false;
        }
    }

    /**
     * 记录已暂停的时长（供 Recorder 在 pause 时调用，resume 时扣除）
     */
    setPausedDuration(ms) {
        this._pausedDuration = ms;
    }

    getPausedDuration() {
        return this._pausedDuration || 0;
    }
}
