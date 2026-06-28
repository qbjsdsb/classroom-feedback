// sherpaProvider.js - Sherpa-onnx 本地语音识别 Provider
// 基于 sherpa-onnx WASM（k2-fsa 团队，Apache-2.0）
// 主力模型：SenseVoice-Small（int8 量化，约229MB，50+语种）
// 架构：Silero VAD 检测语音段 → OfflineRecognizer 分段识别（伪流式）
//
// ⚠️ 重要技术限制：
// 1. sherpa-onnx WASM 使用 pthread 多线程，需要 SharedArrayBuffer
// 2. SharedArrayBuffer 需要 crossOriginIsolated 环境（COOP/COEP 头）
// 3. GitHub Pages 默认不发送 COOP/COEP 头，因此 Sherpa 在 GitHub Pages 上不可用
// 4. 需要部署在支持 COOP/COEP 的环境（如 HuggingFace Spaces、Cloudflare Pages）
// 5. 或者修改 sw.js 注入 COOP/COEP 头（使用 coi-serviceworker 方案）
//
// 当 crossOriginIsolated 不可用时，isSupported() 返回 false，
// Auto 降级链会自动跳过 Sherpa，降级到 Vosk/Whisper/浏览器原生。

// 检查基类是否已加载
if (typeof SpeechProvider === 'undefined') {
    console.error('[SherpaProvider] SpeechProvider 基类未加载，请检查 script 加载顺序');
}

// ========== 资源 URL ==========
// JS 包装层从 jsDelivr GitHub 镜像加载（仓库源码，约 15KB + 6KB）
const SHERPA_ASR_JS_URL = 'https://cdn.jsdelivr.net/gh/k2-fsa/sherpa-onnx@master/wasm/asr/sherpa-onnx-asr.js';
const SHERPA_VAD_JS_URL = 'https://cdn.jsdelivr.net/gh/k2-fsa/sherpa-onnx@master/wasm/vad/sherpa-onnx-vad.js';

// Emscripten JS glue + WASM 二进制从 HuggingFace Spaces 加载（官方 demo 托管在此）
// 注意：如果 HuggingFace 不可达，可修改为 ModelScope 镜像：
//   https://www.modelscope.cn/studios/k2-fsa/web-assembly-vad-asr-sherpa-onnx-zh-en-ja-ko-cantonese-sense-voice-small/resolve/master/<file>
const SHERPA_WASM_BASE = 'https://huggingface.co/spaces/k2-fsa/web-assembly-vad-asr-sherpa-onnx-zh-en-ja-ko-cantonese-sense-voice-small/resolve/main';
const SHERPA_WASM_GLUE_URL = `${SHERPA_WASM_BASE}/sherpa-onnx-wasm-main-vad-asr.js`;

// 模型文件从 HuggingFace 模型仓库加载（支持 CORS）
// SenseVoice-Small int8 量化版（约229MB）+ tokens.txt + Silero VAD
const SHERPA_MODEL_BASE = 'https://huggingface.co/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/main';
const SHERPA_MODEL_FILES = {
    'sense-voice.onnx': `${SHERPA_MODEL_BASE}/model.int8.onnx`,
    'tokens.txt': `${SHERPA_MODEL_BASE}/tokens.txt`,
    'silero_vad.onnx': 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx',
};

const SHERPA_MODEL_SIZE = '约229MB（int8量化）';
const SHERPA_IDB_NAME = 'sherpa-models'; // IndexedDB 数据库名
const SHERPA_IDB_STORE = 'files';        // IndexedDB 仓库名

class SherpaProvider extends (SpeechProvider || class {}) {
    constructor(recorder) {
        super(recorder);
        this.id = 'sherpa';
        this.displayName = '本地识别 (Sherpa-onnx)';
        this.modelSize = SHERPA_MODEL_SIZE;
        this.requiresNetwork = true; // 首次需加载 WASM(10MB) + 模型(229MB)

        // 模型加载状态
        this._loading = false;
        this._loaded = false;
        this._scriptsLoaded = false; // JS 包装层是否已加载

        // sherpa-onnx 实例
        this._module = null;       // Emscripten Module 对象
        this._vad = null;          // VoiceActivityDetector 实例
        this._recognizer = null;   // OfflineRecognizer 实例
        this._buffer = null;       // CircularBuffer 实例

        // 音频采集
        this._audioContext = null;
        this._mediaStream = null;
        this._processor = null;
        this._pausedDuration = 0;

        // 重采样状态（从原生采样率 → 16kHz）
        this._nativeSampleRate = 0;
        this._ratio = 0;
        this._offset = 0;
        this._lastSample = 0;

        // 回调
        this._onResult = null;
        this._onPartial = null;
        this._onError = null;
    }

    isSupported() {
        // sherpa-onnx WASM 需要 SharedArrayBuffer（pthread 多线程）
        // SharedArrayBuffer 需要 crossOriginIsolated 环境
        // 还需要 AudioContext 和 getUserMedia
        return typeof SharedArrayBuffer !== 'undefined' &&
               self.crossOriginIsolated === true &&
               (window.AudioContext || window.webkitAudioContext) &&
               navigator.mediaDevices && navigator.mediaDevices.getUserMedia &&
               typeof WebAssembly !== 'undefined';
    }

    /**
     * 获取不支持的原因（用于错误提示）
     */
    getUnsupportedReason() {
        if (typeof SharedArrayBuffer === 'undefined' || self.crossOriginIsolated !== true) {
            return 'Sherpa-onnx 需要 Cross-Origin Isolated 环境（COOP/COEP 头）。' +
                   'GitHub Pages 默认不支持。请部署到 HuggingFace Spaces、Cloudflare Pages，' +
                   '或修改 sw.js 注入 COOP/COEP 头（coi-serviceworker 方案）。';
        }
        if (!(window.AudioContext || window.webkitAudioContext)) {
            return '浏览器不支持 AudioContext';
        }
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            return '浏览器不支持 getUserMedia';
        }
        if (typeof WebAssembly === 'undefined') {
            return '浏览器不支持 WebAssembly';
        }
        return '';
    }

    // ========== IndexedDB 封装（模型文件缓存） ==========

    _openDB() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(SHERPA_IDB_NAME, 1);
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(SHERPA_IDB_STORE)) {
                    db.createObjectStore(SHERPA_IDB_STORE);
                }
            };
            req.onsuccess = (e) => resolve(e.target.result);
            req.onerror = (e) => reject(e.target.error);
        });
    }

    async _idbGet(key) {
        try {
            const db = await this._openDB();
            return new Promise((resolve, reject) => {
                const tx = db.transaction(SHERPA_IDB_STORE, 'readonly');
                const req = tx.objectStore(SHERPA_IDB_STORE).get(key);
                req.onsuccess = (e) => resolve(e.target.result || null);
                req.onerror = (e) => reject(e.target.error);
            });
        } catch (e) { return null; }
    }

    async _idbSet(key, value) {
        try {
            const db = await this._openDB();
            return new Promise((resolve, reject) => {
                const tx = db.transaction(SHERPA_IDB_STORE, 'readwrite');
                tx.objectStore(SHERPA_IDB_STORE).put(value, key);
                tx.oncomplete = () => resolve();
                tx.onerror = (e) => reject(e.target.error);
            });
        } catch (e) { /* IndexedDB 不可用时静默失败，每次都重新下载 */ }
    }

    /**
     * 下载文件并缓存到 IndexedDB（如果已有缓存则直接返回）
     * @param {string} filename - MEMFS 中的文件名
     * @param {string} url - 下载 URL
     * @param {function} onProgress - 进度回调 (0-100)
     * @returns {Promise<ArrayBuffer>}
     */
    async _fetchOrCache(filename, url, onProgress) {
        // 1. 检查 IndexedDB 缓存
        const cached = await this._idbGet(filename);
        if (cached) {
            if (onProgress) onProgress(100);
            return cached;
        }

        // 2. 没有缓存，下载文件
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`下载 ${filename} 失败: HTTP ${response.status}`);
        }

        const total = parseInt(response.headers.get('content-length') || '0');
        if (!response.body || !total || !onProgress) {
            // 无法流式读取进度，直接读取完整 ArrayBuffer
            const buf = await response.arrayBuffer();
            await this._idbSet(filename, buf);
            if (onProgress) onProgress(100);
            return buf;
        }

        // 3. 流式读取（带进度反馈）
        const reader = response.body.getReader();
        const chunks = [];
        let received = 0;
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            received += value.length;
            if (onProgress) onProgress(Math.round(received / total * 100));
        }
        const buf = new Uint8Array(received);
        let pos = 0;
        for (const chunk of chunks) {
            buf.set(chunk, pos);
            pos += chunk.length;
        }

        // 4. 缓存到 IndexedDB
        await this._idbSet(filename, buf.buffer);
        return buf.buffer;
    }

    // ========== 脚本动态加载 ==========

    _loadScript(url) {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = url;
            script.async = true;
            script.onload = resolve;
            script.onerror = () => reject(new Error(`加载脚本失败: ${url}`));
            document.head.appendChild(script);
        });
    }

    /**
     * 加载 JS 包装层（sherpa-onnx-asr.js + sherpa-onnx-vad.js）
     * 这些文件定义了 OfflineRecognizer、Vad、CircularBuffer 等类
     */
    async _loadWrapperScripts() {
        if (this._scriptsLoaded) return;
        if (typeof OfflineRecognizer === 'undefined') {
            await this._loadScript(SHERPA_ASR_JS_URL);
        }
        if (typeof createVad === 'undefined') {
            await this._loadScript(SHERPA_VAD_JS_URL);
        }
        this._scriptsLoaded = true;
    }

    /**
     * 加载 Emscripten JS glue 并初始化 WASM
     * Emscripten JS glue 会读取 window.Module 配置，初始化 WASM，完成后调用 onRuntimeInitialized
     */
    _initWasm() {
        return new Promise(async (resolve, reject) => {
            // 设置 Module 全局变量（Emscripten JS glue 会读取）
            // 注意：Module 必须在加载 JS glue 之前设置
            window.Module = {
                // locateFile: 指定 .wasm 文件的加载路径
                // Emscripten JS glue 会调用此函数获取 .wasm 文件 URL
                locateFile: function(path) {
                    // .wasm 和 .data 文件从 HF Spaces 加载
                    // 注意：我们不加载 .data 文件（模型文件用 FS.writeFile 注入）
                    // Emscripten 在 .data 文件 fetch 失败时会输出警告但不阻止初始化
                    return `${SHERPA_WASM_BASE}/${path}`;
                },

                // preRun: 在 WASM 初始化前执行，用于注入模型文件到 MEMFS
                preRun: [
                    (module) => {
                        // 模型文件已通过 _modelFiles 缓存，写入 MEMFS
                        if (this._modelFiles) {
                            for (const [filename, data] of Object.entries(this._modelFiles)) {
                                try {
                                    module.FS.writeFile(`./${filename}`, new Uint8Array(data));
                                } catch (e) {
                                    console.error(`[Sherpa] MEMFS 注入失败: ${filename}`, e);
                                }
                            }
                        }
                    }
                ],

                // onRuntimeInitialized: WASM 初始化完成后调用
                onRuntimeInitialized: function() {
                    resolve(window.Module);
                },

                // 打印和错误回调
                // print（WASM stdout）静默：内部诊断日志对用户无意义
                // printErr（WASM stderr）保留为 warn：异常排查有用
                print: function() {},
                printErr: function(text) { console.warn('[Sherpa/WASM]', text); },

                // 初始内存（sherpa-onnx 需要较大内存）
                INITIAL_MEMORY: 512 * 1024 * 1024, // 512MB
                ALLOW_MEMORY_GROWTH: true,
            };

            // 设置超时保护（WASM 初始化可能因网络问题卡住）
            const timeout = setTimeout(() => {
                reject(new Error('Sherpa WASM 初始化超时（可能是网络问题或 .wasm 文件不可达）'));
            }, 120000); // 2 分钟超时

            // 保存原始 resolve 以便超时后清理
            const originalResolve = resolve;
            resolve = (val) => {
                clearTimeout(timeout);
                originalResolve(val);
            };

            try {
                // 动态加载 Emscripten JS glue
                // 这会触发 WASM 初始化，完成后调用 onRuntimeInitialized
                await this._loadScript(SHERPA_WASM_GLUE_URL);
            } catch (err) {
                clearTimeout(timeout);
                reject(new Error(`加载 Sherpa WASM JS glue 失败: ${err.message}`));
            }
        });
    }

    /**
     * 预加载 Sherpa 模型
     * 流程：
     * 1. 检测 crossOriginIsolated 环境
     * 2. 加载 JS 包装层
     * 3. 下载模型文件（IndexedDB 缓存）
     * 4. 初始化 WASM（注入模型到 MEMFS）
     * 5. 创建 VAD 和 OfflineRecognizer
     */
    async preload(onProgress) {
        if (this._loaded || this._loading) {
            if (this._loading) UI.showToast('Sherpa 模型正在加载中，请稍候...');
            return;
        }

        // 环境检测
        if (!this.isSupported()) {
            const reason = this.getUnsupportedReason();
            this.status = 'error';
            UI.showToast(reason);
            this._log('error', 'Sherpa不支持', reason);
            return;
        }

        this._loading = true;
        this.status = 'loading';
        const statusEl = document.getElementById('sherpa-model-status') || document.getElementById('whisper-model-status');

        try {
            // 1. 加载 JS 包装层
            if (statusEl) statusEl.textContent = 'Sherpa：正在加载 JS 包装层...';
            await this._loadWrapperScripts();

            // 2. 下载模型文件（IndexedDB 缓存）
            if (statusEl) statusEl.textContent = 'Sherpa：正在加载模型文件（首次约229MB，之后缓存）...';
            this._modelFiles = {};
            const filenames = Object.keys(SHERPA_MODEL_FILES);
            for (let i = 0; i < filenames.length; i++) {
                const filename = filenames[i];
                const url = SHERPA_MODEL_FILES[filename];
                if (statusEl) {
                    const pct = Math.round((i / filenames.length) * 100);
                    statusEl.textContent = `Sherpa：加载模型文件 ${i + 1}/${filenames.length} (${filename})...`;
                }
                const data = await this._fetchOrCache(filename, url, (p) => {
                    if (onProgress) {
                        const overall = Math.round(((i + p / 100) / filenames.length) * 100);
                        onProgress({ status: 'downloading', progress: overall });
                    }
                });
                this._modelFiles[filename] = data;
            }

            // 3. 初始化 WASM
            if (statusEl) statusEl.textContent = 'Sherpa：正在初始化 WASM 运行时...';
            this._module = await this._initWasm();

            // 4-6. 创建 VAD / CircularBuffer / OfflineRecognizer
            this._createRecognizer();

            this._loaded = true;
            this.isReady = true;
            this.status = 'ready';
            if (statusEl) statusEl.textContent = 'Sherpa 模型状态：已就绪 ✓';
            if (onProgress) onProgress({ status: 'ready', progress: 100 });
            UI.showToast('Sherpa 语音识别模型加载完成');
        } catch (err) {
            console.error('[Sherpa] 模型加载失败:', err);
            this.status = 'error';
            if (statusEl) statusEl.textContent = 'Sherpa 模型状态：加载失败 - ' + err.message;
            UI.showToast('Sherpa 模型加载失败：' + err.message);
            this._log('error', 'Sherpa模型加载失败', err.message);
        } finally {
            this._loading = false;
        }
    }

    /**
     * 创建 VAD / CircularBuffer / OfflineRecognizer
     * 复用 _module（WASM 运行时）和 _modelFiles（已缓存的模型文件）
     * - preload 首次创建
     * - start 检测到 recognizer 为 null 时重建（stop(isFullStop=true) 会释放）
     */
    _createRecognizer() {
        if (!this._module) {
            throw new Error('WASM 运行时未初始化，无法创建 recognizer');
        }

        // VAD：使用默认配置（Silero VAD, threshold=0.5, windowSize=512=32ms@16kHz）
        this._vad = createVad(this._module);

        // CircularBuffer（30 秒容量）
        this._buffer = new CircularBuffer(30 * 16000, this._module);

        // OfflineRecognizer（SenseVoice 配置）
        const config = {
            modelConfig: {
                debug: 0,
                tokens: './tokens.txt',
                senseVoice: {
                    model: './sense-voice.onnx',
                    useInverseTextNormalization: 1, // 启用 ITN（标点恢复）
                },
            },
        };
        this._recognizer = new OfflineRecognizer(config, this._module);
    }

    // ========== 音频重采样（原生采样率 → 16kHz） ==========

    _resetResampler(nativeSampleRate) {
        this._nativeSampleRate = nativeSampleRate;
        this._ratio = nativeSampleRate / 16000;
        this._offset = 0;
        this._lastSample = 0;
    }

    /**
     * 线性插值重采样（从原生采样率 → 16kHz）
     * @param {Float32Array} input - 输入音频（-1.0 到 1.0）
     * @returns {Float32Array} 16kHz 重采样后的音频
     */
    _downsample(input) {
        const outputLength = Math.floor((input.length + this._offset) / this._ratio);
        const output = new Float32Array(outputLength);
        let inIdx = 0;
        let outIdx = 0;

        while (outIdx < outputLength) {
            const srcPos = this._offset + outIdx * this._ratio;
            const srcIdx = Math.floor(srcPos);
            const frac = srcPos - srcIdx;

            // 线性插值
            const s0 = srcIdx < input.length ? input[srcIdx] : this._lastSample;
            const s1 = srcIdx + 1 < input.length ? input[srcIdx + 1] : (srcIdx < input.length ? input[srcIdx] : this._lastSample);
            output[outIdx] = s0 + (s1 - s0) * frac;
            outIdx++;
        }

        // 保存状态（处理跨 buffer 边界）
        this._offset += input.length - outputLength * this._ratio;
        if (input.length > 0) {
            this._lastSample = input[input.length - 1];
        }

        return output;
    }

    // ========== VAD + OfflineRecognizer 识别流程 ==========

    /**
     * 处理 VAD 输出的语音段：喂入 OfflineRecognizer 解码并返回结果
     */
    _processSpeechSegment(segment) {
        if (!segment || !segment.samples || segment.samples.length === 0) return;

        try {
            const stream = this._recognizer.createStream();
            stream.acceptWaveform(16000, segment.samples);
            this._recognizer.decode(stream);
            const result = this._recognizer.getResult(stream);
            stream.free();

            const text = (result.text || '').trim();
            if (text) {
                if (this._onResult) this._onResult(text);
            }
        } catch (err) {
            console.error('[Sherpa] 解码失败:', err);
            this._log('error', 'Sherpa解码失败', err.message);
        }
    }

    /**
     * 处理缓冲区中的音频：喂入 VAD，取出语音段识别
     * 每次 windowSize(512) 样本喂入 VAD，检测到完整语音段后识别
     */
    _processBuffer() {
        if (!this._vad || !this._buffer) return;

        const windowSize = this._vad.config.sileroVad.windowSize; // 512 (32ms@16kHz)

        while (this._buffer.size() > windowSize) {
            // 取 windowSize 样本喂入 VAD
            const s = this._buffer.get(this._buffer.head(), windowSize);
            this._vad.acceptWaveform(s);
            this._buffer.pop(windowSize);

            // 取出所有已检测到的语音段
            while (!this._vad.isEmpty()) {
                const segment = this._vad.front();
                this._vad.pop();
                this._processSpeechSegment(segment);
            }
        }
    }

    // ========== Provider 接口实现 ==========

    async start({ onResult, onPartial, onError } = {}) {
        this._onResult = onResult;
        this._onPartial = onPartial;
        this._onError = onError;

        if (!this._loaded) {
            UI.showToast('Sherpa 模型未加载，正在加载...');
            this._log('warn', 'Sherpa模型未加载，开始预加载');
            await this.preload();
            if (!this._loaded) return false;
        }

        // stop(isFullStop=true) 会释放 recognizer/vad/buffer 但保留 _module 和 _modelFiles
        // 此处检测到 recognizer 为 null 时重建（复用 WASM 运行时和模型缓存，无需重新下载）
        if (!this._recognizer || !this._vad || !this._buffer) {
            try {
                this._createRecognizer();
                this._log('info', 'Sherpa recognizer 重建完成（复用 WASM 与模型缓存）');
            } catch (err) {
                console.error('[Sherpa] recognizer 重建失败:', err);
                this._log('error', 'Sherpa recognizer 重建失败', err.message);
                UI.showToast('Sherpa 重建识别器失败：' + err.message);
                return false;
            }
        }

        try {
            // 获取麦克风音频
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    channelCount: 1,
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                }
            });
            this._mediaStream = stream;

            // 使用原生采样率 AudioContext（手动重采样到 16kHz）
            const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
            this._audioContext = new AudioContextCtor();
            this._resetResampler(this._audioContext.sampleRate);
            console.log('[Sherpa] AudioContext 采样率:', this._audioContext.sampleRate, '→ 重采样到 16kHz');

            // 音频采集：ScriptProcessorNode
            const source = this._audioContext.createMediaStreamSource(stream);
            const processor = this._audioContext.createScriptProcessor(4096, 1, 1);
            this._processor = processor;

            const self = this;
            const recorder = this.recorder;
            processor.onaudioprocess = (e) => {
                if (!recorder || !recorder.isRecording) return;

                // 获取单声道音频
                const inputData = e.inputBuffer.getChannelData(0);

                // 重采样到 16kHz
                const samples = self._downsample(inputData);

                // 喂入 CircularBuffer
                self._buffer.push(samples);

                // 处理 VAD + 识别
                self._processBuffer();
            };

            source.connect(processor);
            // ScriptProcessorNode 必须连接 destination 才能触发 onaudioprocess
            const silentGain = this._audioContext.createGain();
            silentGain.gain.value = 0;
            processor.connect(silentGain);
            silentGain.connect(this._audioContext.destination);

            // 重置 VAD 状态
            this._vad.reset();
            this._buffer.reset();

            this.status = 'running';
            return true;
        } catch (err) {
            console.error('[Sherpa] 启动失败:', err);
            this._log('error', 'Sherpa启动失败', err.message);
            this.stop(true);
            if (this._onError) this._onError(err);
            UI.showToast('Sherpa 识别启动失败：' + err.message);
            return false;
        }
    }

    async stop(isFullStop = true) {
        const wasRunning = !!(this._processor || this._mediaStream);
        if (wasRunning) {
            this._log('info', isFullStop ? 'Sherpa完全停止' : 'Sherpa暂停', '');
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

        // flush VAD 缓冲区（处理最后的语音段）
        if (this._vad && isFullStop) {
            try {
                this._vad.flush();
                // 处理 flush 后剩余的语音段
                while (!this._vad.isEmpty()) {
                    const segment = this._vad.front();
                    this._vad.pop();
                    this._processSpeechSegment(segment);
                }
            } catch (e) {
                console.warn('[Sherpa] VAD flush 异常:', e);
            }
        }

        // 完全停止时释放 VAD 和 recognizer
        if (isFullStop) {
            if (this._vad) {
                try { this._vad.free(); } catch (e) {}
                this._vad = null;
            }
            if (this._recognizer) {
                try { this._recognizer.free(); } catch (e) {}
                this._recognizer = null;
            }
            if (this._buffer) {
                try { this._buffer.free(); } catch (e) {}
                this._buffer = null;
            }
        }

        this.status = isFullStop ? 'idle' : 'ready';
    }

    async importFile(file, onProgress) {
        if (!this._loaded) {
            UI.showToast('Sherpa 模型未加载，正在加载...');
            await this.preload();
            if (!this._loaded) return false;
        }

        // 与 start() 同理：stop(isFullStop=true) 释放 recognizer 后需重建
        if (!this._recognizer || !this._vad || !this._buffer) {
            try {
                this._createRecognizer();
            } catch (err) {
                console.error('[Sherpa] importFile recognizer 重建失败:', err);
                UI.showToast('Sherpa 重建识别器失败：' + err.message);
                return false;
            }
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

            if (duration > 7200) {
                UI.showToast('录音文件过长（超过2小时），请截取后重试');
                if (progressEl) progressEl.style.display = 'none';
                audioContext.close();
                return false;
            }

            if (statusEl) statusEl.textContent = `录音时长 ${Math.floor(duration/60)}分${Math.floor(duration%60)}秒，开始Sherpa识别...`;

            // 合并为单声道
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

            // 如果采样率不是 16kHz，需要重采样
            let samples = monoData;
            if (audioBuffer.sampleRate !== 16000) {
                this._resetResampler(audioBuffer.sampleRate);
                samples = this._downsample(monoData);
            }
            audioContext.close();

            const existingText = document.getElementById('transcript');
            const existingValue = existingText ? existingText.value.trim() : '';
            if (existingValue) {
                this.recorder.accumulatedText = existingValue + '\n';
            } else {
                this.recorder.accumulatedText = '';
            }

            // 重置 VAD
            this._vad.reset();
            this._buffer.reset();

            // 分段处理（每 10 秒喂入 VAD，避免一次性处理太多数据）
            const CHUNK_SEC = 10;
            const chunkSamples = 16000 * CHUNK_SEC;
            const totalChunks = Math.ceil(samples.length / chunkSamples);

            for (let i = 0; i < totalChunks; i++) {
                const start = i * chunkSamples;
                const end = Math.min(start + chunkSamples, samples.length);
                const chunk = samples.subarray(start, end);

                // 喂入 CircularBuffer
                this._buffer.push(chunk);
                // 处理 VAD + 识别
                this._processBuffer();

                const pct = Math.round(((i + 1) / totalChunks) * 100);
                if (barEl) barEl.style.width = pct + '%';
                if (statusEl) {
                    const endSec = end / 16000;
                    statusEl.textContent = `Sherpa识别中 ${Math.floor(endSec/60)}:${Math.floor(endSec%60).toString().padStart(2,'0')} / ${Math.floor(duration/60)}:${Math.floor(duration%60).toString().padStart(2,'0')}`;
                }
                if (onProgress) onProgress(pct);
                // 让出主线程
                await new Promise(r => setTimeout(r, 0));
            }

            // flush VAD，处理最后的语音段
            this._vad.flush();
            while (!this._vad.isEmpty()) {
                const segment = this._vad.front();
                this._vad.pop();
                this._processSpeechSegment(segment);
            }

            // 更新文本框
            const textarea = document.getElementById('transcript');
            if (textarea) {
                textarea.value = this.recorder.accumulatedText;
                textarea.scrollTop = textarea.scrollHeight;
            }

            if (barEl) barEl.style.width = '100%';
            if (statusEl) statusEl.textContent = `Sherpa识别完成！`;
            UI.showToast('Sherpa识别完成');

            setTimeout(() => {
                if (progressEl) progressEl.style.display = 'none';
                if (barEl) barEl.style.width = '0%';
            }, 3000);

            return true;
        } catch (err) {
            console.error('[Sherpa] 文件导入失败:', err);
            UI.showToast('Sherpa识别失败：' + (err.message || '不支持的音频格式'));
            if (progressEl) progressEl.style.display = 'none';
            return false;
        }
    }

    setPausedDuration(ms) {
        this._pausedDuration = ms;
    }

    getPausedDuration() {
        return this._pausedDuration || 0;
    }
}
