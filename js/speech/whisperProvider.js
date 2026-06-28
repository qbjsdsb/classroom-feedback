// whisperProvider.js - Whisper 本地 AI 语音识别 Provider
// 基于 transformers.js + whisper-tiny 模型，推理在 Web Worker 中执行避免阻塞 UI
// 从 recorder.js 抽出，实现 SpeechProvider 接口

// 检查基类是否已加载（防御性，避免因 script 顺序问题导致继承失败）
if (typeof SpeechProvider === 'undefined') {
    console.error('[WhisperProvider] SpeechProvider 基类未加载，请检查 script 加载顺序');
}

class WhisperProvider extends (SpeechProvider || class {}) {
    constructor(recorder) {
        super(recorder);
        // 引擎元信息
        this.id = 'whisper';
        this.displayName = '本地AI识别 (Whisper)';
        this.modelSize = '约40MB';
        this.requiresNetwork = true; // 首次需从 CDN 加载 WASM

        // 模型加载状态
        this._loading = false;
        this._loaded = false;

        // Worker 相关（推理移到 Worker 线程，避免阻塞 UI）
        this._worker = null;
        this._workerReady = false;
        this._chunkId = 0;             // 递增的 chunkId（用于结果顺序匹配）
        this._pendingChunks = new Map(); // 待处理队列（chunkId -> {audio, sampleRate, sent, done} | {text, done}）
        this._workerBusy = false;       // Worker 是否正在推理（互斥锁）
        this._nextFlushId = 0;          // 下一个应写入文本框的 chunkId（保证顺序）

        // 音频采集相关
        this._audioContext = null;
        this._mediaStream = null;
        this._processor = null;
        this._audioBuffer = null;       // 重采样后的 16000Hz 缓冲区
        this._bufferIndex = 0;
        this._recognizeInterval = null;
        this._pausedDuration = 0;       // 已暂停时长（用于恢复计时）
        this._resampleCarry = 0;        // 重采样残留（分数累积）

        // 回调（start 时注入）
        this._onResult = null;
        this._onPartial = null;
        this._onError = null;
    }

    isSupported() {
        // 需要 Worker、AudioContext、getUserMedia
        return typeof Worker !== 'undefined' &&
               (window.AudioContext || window.webkitAudioContext) &&
               navigator.mediaDevices && navigator.mediaDevices.getUserMedia;
    }

    /**
     * 预加载 Whisper 模型（在 Worker 线程中加载，避免阻塞 UI）
     */
    async preload(onProgress) {
        if (this._loaded || this._loading) {
            if (this._loading) UI.showToast('模型正在加载中，请稍候...');
            return;
        }
        this._loading = true;
        this.status = 'loading';
        try {
            // 适配 GitHub Pages 子路径部署（如 https://user.github.io/repo/）
            const _loc = window.location.pathname;
            const _basePath = _loc.replace(/[^/]*$/, '').replace(/\/$/, '');
            const _localModelPath = _basePath + '/vendor/whisper-tiny';
            const _wasmPaths = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.4.1/dist/';
            console.log('[Whisper] 站点根路径:', _basePath || '(根部署)');

            const statusEl = document.getElementById('whisper-model-status');
            if (statusEl) statusEl.textContent = '模型状态：正在加载...';

            // 探测本地模型是否可用：GET 请求 config.json 并验证内容
            // Cloudflare Pages 单文件 25MB 限制，30MB 的 onnx 模型不会部署
            // 此时自动切换到远程模式（hf-mirror.com 国内镜像），无需手动配置
            // 注意：Cloudflare Pages 对未部署文件会返回 200 + SPA 兜底页（HTML 内容），
            //       即使扩展名是 .json，content-type 也可能是 application/json（按扩展名推断），
            //       所以必须读取内容并解析 JSON，检查是否包含 whisper 模型配置字段
            let _localFilesOnly = true;
            let _modelPath = _localModelPath;
            let _remoteHost = null;
            try {
                const probeResp = await fetch(_localModelPath + '/config.json');
                if (!probeResp.ok) {
                    throw new Error(`HTTP ${probeResp.status}`);
                }
                const text = await probeResp.text();
                const config = JSON.parse(text);  // SPA 兜底页是 HTML，JSON.parse 会抛错
                // whisper 模型 config.json 必含 model_type 字段（如 "whisper"）
                if (!config || !config.model_type) {
                    throw new Error('config.json 缺少 model_type 字段');
                }
                console.log('[Whisper] 本地模型可用，使用本地模式，model_type=', config.model_type);
            } catch (probeErr) {
                console.warn('[Whisper] 本地模型不可用，切换到远程模式（hf-mirror.com）:', probeErr.message);
                _localFilesOnly = false;
                _modelPath = 'Xenova/whisper-tiny';  // HuggingFace 上的 whisper-tiny 模型 ID
                _remoteHost = 'https://hf-mirror.com/';  // 国内镜像，避免 huggingface.co 被墙
                if (statusEl) statusEl.textContent = '模型状态：从镜像下载（首次约40MB）...';
            }

            // 创建 Worker（type: 'module' 支持 ES module import）
            this._worker = new Worker(_basePath + '/js/whisperWorker.js', { type: 'module' });
            this._workerReady = false;

            // 等待 Worker 加载完成
            const readyPromise = new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error('模型加载超时（120秒），请检查网络后重试'));
                }, 120000);  // 远程下载可能较慢，超时从 60s 提升到 120s

                this._worker.onmessage = (e) => {
                    const msg = e.data;
                    if (msg.type === 'progress') {
                        const progress = msg.progress;
                        // 下载进度通过 statusEl 显示给用户，不再 console.log（避免刷屏）
                        if (statusEl && progress.status) {
                            const pct = progress.progress ? Math.round(progress.progress) : 0;
                            statusEl.textContent = `模型状态：${progress.status} ${pct ? pct + '%' : ''}`;
                        }
                        if (onProgress) onProgress(progress);
                    } else if (msg.type === 'ready') {
                        clearTimeout(timeout);
                        this._workerReady = true;
                        // 切换到识别消息处理器
                        this._worker.onmessage = (e) => this._onWorkerMessage(e);
                        resolve();
                    } else if (msg.type === 'error') {
                        clearTimeout(timeout);
                        reject(new Error(msg.error));
                    }
                };
                this._worker.onerror = (e) => {
                    clearTimeout(timeout);
                    reject(new Error('Worker 加载失败: ' + (e.message || '未知错误')));
                };
            });

            // 发送加载指令
            this._worker.postMessage({
                type: 'load',
                modelPath: _modelPath,
                localModelPath: _basePath + '/vendor',
                localFilesOnly: _localFilesOnly,
                remoteHost: _remoteHost,
                wasmPaths: _wasmPaths
            });

            await readyPromise;

            this._loaded = true;
            this.isReady = true;
            this.status = 'ready';
            if (statusEl) statusEl.textContent = '模型状态：已就绪 ✓';
            UI.showToast('本地AI语音识别模型加载完成');
        } catch (err) {
            console.error('[Whisper] 模型加载失败:', err);
            this.status = 'error';
            const statusEl = document.getElementById('whisper-model-status');
            if (statusEl) statusEl.textContent = '模型状态：加载失败 - ' + err.message;
            UI.showToast('模型加载失败：' + err.message);
            this._log('error', 'Whisper模型加载失败', err.message);
            // 清理失败的 Worker
            if (this._worker) {
                this._worker.terminate();
                this._worker = null;
            }
        } finally {
            this._loading = false;
        }
    }

    /**
     * Worker 消息处理器（识别结果）
     * 按顺序处理结果：如果某个 chunkId 的结果还没返回，先缓存后续结果，
     * 等它返回后按顺序写入（通过 onResult 回调交给 Recorder）
     */
    _onWorkerMessage(e) {
        const msg = e.data;
        if (msg.type === 'result') {
            this._workerBusy = false;
            const chunkId = msg.chunkId;
            const text = msg.text || '';

            // 把结果存入待处理队列
            this._pendingChunks.set(chunkId, { text, done: true });

            // 按顺序写入：从最小 chunkId 开始，把连续完成的结果输出
            this._flushPendingChunks();

            // 处理队列中下一个待识别的 chunk
            this._processNextPendingChunk();
        } else if (msg.type === 'error') {
            console.warn('[WhisperWorker] 识别错误:', msg.error);
            this._workerBusy = false;
            // 跳过当前 chunk，处理下一个
            this._processNextPendingChunk();
        }
    }

    /**
     * 按顺序把已完成的结果通过 onResult 回调输出
     * 保证文本顺序与录音顺序一致（避免 Worker 异步返回导致顺序错乱）
     * 文本去重：如果新文本是已有文本的结尾子串，跳过（Whisper 重复识别）
     */
    _flushPendingChunks() {
        if (this._nextFlushId === undefined) {
            this._nextFlushId = 0;
        }
        while (this._pendingChunks.has(this._nextFlushId)) {
            const item = this._pendingChunks.get(this._nextFlushId);
            this._pendingChunks.delete(this._nextFlushId);
            if (item.text) {
                // 读取 Recorder 的累计文本做去重判断
                const existing = (this.recorder && this.recorder.accumulatedText) || '';
                if (existing.endsWith(item.text)) {
                    // Whisper 重复识别，跳过
                } else {
                    // 通过回调交给 Recorder 写入文本框（解耦：Provider 不直接操作 DOM）
                    if (this._onResult) this._onResult(item.text);
                }
            } else {
                // 空文本跳过
            }
            this._nextFlushId++;
        }
    }

    /**
     * 发送下一个待识别的 chunk 到 Worker
     */
    _processNextPendingChunk() {
        if (this._workerBusy) return;
        for (const [id, item] of this._pendingChunks) {
            if (!item.done && !item.sent) {
                item.sent = true;
                this._workerBusy = true;
                this._worker.postMessage({
                    type: 'transcribe',
                    audio: item.audio,
                    sampleRate: item.sampleRate,
                    chunkId: id
                });
                return;
            }
        }
    }

    /**
     * 开始实时录音识别（Worker 模式：推理在 Worker 线程，主线程不阻塞）
     */
    async start({ onResult, onPartial, onError } = {}) {
        // 保存回调
        this._onResult = onResult;
        this._onPartial = onPartial;
        this._onError = onError;

        if (!this._loaded) {
            UI.showToast('本地AI模型未加载，正在加载...');
            this._log('warn', 'Whisper模型未加载，开始预加载');
            await this.preload();
            if (!this._loaded) return false;
        }

        try {
            // 获取麦克风音频流
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            this._mediaStream = stream;

            // 关键：不要强制 AudioContext 采样率为 16000Hz！
            // 很多浏览器/硬件在 new AudioContext({ sampleRate: 16000 }) 时，
            // createMediaStreamSource 的重采样会静默失败，输出全 0 数据（RMS=0.0000）。
            // 正确做法：让 AudioContext 使用原生采样率，采集后手动重采样到 16000Hz。
            const TARGET_SAMPLE_RATE = 16000; // Whisper 模型要求的采样率
            const CHUNK_DURATION = 5; // 秒（每 5 秒切一段送去 Worker 识别，降低首次识别延迟）
            const TARGET_BUFFER_SIZE = TARGET_SAMPLE_RATE * CHUNK_DURATION; // 80000 样本

            const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
            this._audioContext = new AudioContextCtor(); // 使用默认采样率
            const nativeSampleRate = this._audioContext.sampleRate;
            console.log('[Whisper] AudioContext 原生采样率:', nativeSampleRate, '目标:', TARGET_SAMPLE_RATE);
            const source = this._audioContext.createMediaStreamSource(stream);
            const analyser = this._audioContext.createAnalyser();
            analyser.fftSize = 16384;
            source.connect(analyser);

            // 重置缓冲区和队列状态
            this._audioBuffer = new Float32Array(TARGET_BUFFER_SIZE);
            this._bufferIndex = 0;
            this._pendingChunks = new Map();
            this._chunkId = 0;
            this._nextFlushId = 0;
            this._workerBusy = false;
            this._resampleCarry = 0;

            // 使用 ScriptProcessorNode 采集音频
            const processor = this._audioContext.createScriptProcessor(4096, 1, 1);
            this._processor = processor;

            // 通过闭包捕获 this 和常量（onaudioprocess 回调里 this 不可靠）
            const self = this;
            const recorder = this.recorder;
            processor.onaudioprocess = (e) => {
                // 通过 recorder.isRecording 判断是否仍在录音
                if (!recorder || !recorder.isRecording) return;
                const inputData = e.inputBuffer.getChannelData(0);
                // 重采样：nativeSampleRate → 16000，线性插值 + 分数累积避免边界样本丢失
                const ratio = nativeSampleRate / TARGET_SAMPLE_RATE;
                let pos = self._resampleCarry;
                const resampled = [];
                while (pos < inputData.length) {
                    const idx = Math.floor(pos);
                    const frac = pos - idx;
                    if (idx + 1 < inputData.length) {
                        resampled.push(inputData[idx] * (1 - frac) + inputData[idx + 1] * frac);
                    } else {
                        resampled.push(inputData[idx]);
                    }
                    pos += ratio;
                }
                self._resampleCarry = pos - inputData.length;

                // 写入目标缓冲区，满了就切片送队列
                for (let i = 0; i < resampled.length; i++) {
                    if (self._bufferIndex < TARGET_BUFFER_SIZE) {
                        self._audioBuffer[self._bufferIndex++] = resampled[i];
                    } else {
                        const chunk = self._audioBuffer.slice(0, TARGET_BUFFER_SIZE);
                        self._enqueueChunk(chunk, TARGET_SAMPLE_RATE);
                        self._bufferIndex = 0;
                        self._audioBuffer[self._bufferIndex++] = resampled[i];
                    }
                }
            };
            analyser.connect(processor);
            // 不能直接 connect(destination)，否则麦克风音频会从扬声器播放产生回声/啸叫
            // ScriptProcessorNode 必须连接 destination 才能触发 onaudioprocess
            // 通过 GainNode 设为 0 音量作为中间节点，既触发处理又不产生声音
            const silentGain = this._audioContext.createGain();
            silentGain.gain.value = 0;
            processor.connect(silentGain);
            silentGain.connect(this._audioContext.destination);

            // 定时识别：每 CHUNK_DURATION 秒把缓冲区现有数据送入队列
            // 即使缓冲区没满，也定期识别，避免用户停顿时间长但话已说完
            this._recognizeInterval = setInterval(() => {
                if (!recorder || !recorder.isRecording) return;
                if (this._bufferIndex < TARGET_SAMPLE_RATE * 1.5) return; // 至少 1.5 秒才识别
                const chunk = this._audioBuffer.slice(0, this._bufferIndex);
                this._bufferIndex = 0;
                this._enqueueChunk(chunk, TARGET_SAMPLE_RATE);
            }, CHUNK_DURATION * 1000);

            this.status = 'running';
            return true;
        } catch (err) {
            console.error('[Whisper] 启动失败:', err);
            this._log('error', 'Whisper启动失败', err.message);
            // 清理已获取的资源，避免麦克风指示灯持续亮着
            if (this._mediaStream) {
                this._mediaStream.getTracks().forEach(t => t.stop());
                this._mediaStream = null;
            }
            if (this._audioContext) {
                this._audioContext.close().catch(() => {});
                this._audioContext = null;
            }
            if (this._onError) this._onError(err);
            UI.showToast('本地AI识别启动失败：' + err.message);
            return false;
        }
    }

    /**
     * 把音频分片加入待识别队列，并立即尝试发送给 Worker
     * Worker 一次只处理一个 chunk（互斥），多余的排队等待
     * 队列溢出保护：积压超过 2 个未处理 chunk 时丢弃（避免延迟越来越大）
     */
    _enqueueChunk(audio, sampleRate) {
        let pendingCount = 0;
        for (const item of this._pendingChunks.values()) {
            if (!item.done) pendingCount++;
        }
        if (pendingCount >= 2) {
            console.warn('[Whisper] 队列积压，丢弃音频 chunk（Worker 处理不过来）');
            return;
        }
        const chunkId = this._chunkId++;
        this._pendingChunks.set(chunkId, { audio, sampleRate, sent: false, done: false });
        this._processNextPendingChunk();
    }

    /**
     * 停止识别
     * @param {boolean} isFullStop - true=完全停止（清空缓冲区），false=暂停（保留状态）
     */
    async stop(isFullStop = true) {
        const wasRunning = !!(this._recognizeInterval || this._processor || this._mediaStream);
        if (wasRunning) {
            this._log('info', isFullStop ? 'Whisper完全停止' : 'Whisper暂停', '');
        }
        if (this._recognizeInterval) {
            clearInterval(this._recognizeInterval);
            this._recognizeInterval = null;
        }
        if (this._processor) {
            this._processor.onaudioprocess = null;
            this._processor.disconnect();
            this._processor = null;
        }

        // 关键：停止前把缓冲区剩余数据送入 Worker 识别
        // 否则短录音（< chunk 时长）的数据会被直接丢弃，导致没有任何文字输出
        if (this._audioBuffer && this._bufferIndex >= 16000 * 1) {
            const remainingChunk = this._audioBuffer.slice(0, this._bufferIndex);
            console.log(`[Whisper] 停止前发送剩余缓冲区 ${this._bufferIndex} 样本 (${(this._bufferIndex/16000).toFixed(1)}s)`);
            this._enqueueChunk(remainingChunk, 16000);
        }
        this._bufferIndex = 0;

        if (this._audioContext) {
            this._audioContext.close().catch(() => {});
            this._audioContext = null;
        }
        if (this._mediaStream) {
            this._mediaStream.getTracks().forEach(t => t.stop());
            this._mediaStream = null;
        }
        this._workerBusy = false;
        this.status = isFullStop ? 'idle' : 'ready';

        // 完全停止时清空缓冲区（但不清空 pendingChunks，让剩余 chunk 的结果仍能通过回调写入）
        // 不 terminate Worker（保留 pipeline，下次录音直接用，避免重新加载 40MB 模型）
        if (isFullStop) {
            this._audioBuffer = null;
            this._pausedDuration = 0;
            this._resampleCarry = 0;
            // 不清空 _pendingChunks / _chunkId / _nextFlushId
            // 让 stop 前送入的剩余 chunk 能被 Worker 处理并通过 onResult 写入文本框
        }
    }

    /**
     * 导入音频文件识别（Worker 模式，避免阻塞 UI）
     * 文件导入用独立的 chunkId 空间（负数，避免与实时录音冲突），顺序处理
     */
    async importFile(file, onProgress) {
        if (!this._loaded) {
            UI.showToast('本地AI模型未加载，正在加载...');
            await this.preload();
            if (!this._loaded) return false;
        }

        const progressEl = document.getElementById('audio-import-progress');
        const barEl = document.getElementById('audio-import-bar');
        const statusEl = document.getElementById('audio-import-status');

        if (progressEl) progressEl.style.display = 'block';
        if (statusEl) statusEl.textContent = '正在加载音频文件...';

        // 文件导入用独立的 chunkId 空间（从 -1 递减，避免与实时录音的 chunkId 冲突）
        let fileImportChunkId = -1;
        let fileImportResolver = null;

        // 临时挂载文件导入专用的消息处理器
        const originalHandler = this._worker.onmessage;
        this._worker.onmessage = (e) => {
            const msg = e.data;
            if (msg.type === 'result' && msg.chunkId < 0 && fileImportResolver) {
                fileImportResolver(msg.text || '');
                fileImportResolver = null;
            } else if (msg.type === 'error' && msg.chunkId < 0 && fileImportResolver) {
                console.warn('[Whisper] 文件识别错误:', msg.error);
                fileImportResolver('');
                fileImportResolver = null;
            }
        };

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

            if (statusEl) statusEl.textContent = `录音时长 ${Math.floor(duration/60)}分${Math.floor(duration%60)}秒，开始AI识别...`;

            const textarea = document.getElementById('transcript');
            const existingText = textarea ? textarea.value.trim() : '';
            if (existingText) {
                this.recorder.accumulatedText = existingText + '\n';
            } else {
                this.recorder.accumulatedText = '';
            }

            // 分段处理（每30秒一段）
            const CHUNK_SEC = 30;
            const totalChunks = Math.ceil(duration / CHUNK_SEC);
            let fullText = '';

            for (let i = 0; i < totalChunks; i++) {
                if (!this._loaded) break;

                const start = i * CHUNK_SEC;
                const end = Math.min(start + CHUNK_SEC, duration);
                const startSample = Math.floor(start * audioBuffer.sampleRate);
                const endSample = Math.min(Math.floor(end * audioBuffer.sampleRate), audioBuffer.length);

                const chunkLength = endSample - startSample;
                const float32 = new Float32Array(chunkLength);
                for (let ch = 0; ch < audioBuffer.numberOfChannels; ch++) {
                    const channelData = audioBuffer.getChannelData(ch);
                    for (let j = 0; j < chunkLength; j++) {
                        float32[j] += channelData[startSample + j];
                    }
                }
                if (audioBuffer.numberOfChannels > 1) {
                    for (let j = 0; j < chunkLength; j++) {
                        float32[j] /= audioBuffer.numberOfChannels;
                    }
                }

                // 发送到 Worker 并等待结果
                const text = await new Promise((resolve) => {
                    fileImportResolver = resolve;
                    this._worker.postMessage({
                        type: 'transcribe',
                        audio: float32,
                        sampleRate: audioBuffer.sampleRate,
                        chunkId: fileImportChunkId--
                    });
                });

                if (text) {
                    fullText += text;
                    if (textarea) {
                        textarea.value = this.recorder.accumulatedText + fullText;
                        textarea.scrollTop = textarea.scrollHeight;
                    }
                }

                const pct = Math.round(((i + 1) / totalChunks) * 100);
                if (barEl) barEl.style.width = pct + '%';
                if (statusEl) {
                    statusEl.textContent = `AI识别中 ${Math.floor(end/60)}:${Math.floor(end%60).toString().padStart(2,'0')} / ${Math.floor(duration/60)}:${Math.floor(duration%60).toString().padStart(2,'0')}（已识别 ${fullText.length} 字）`;
                }
                if (onProgress) onProgress(pct, statusEl ? statusEl.textContent : '');
            }

            audioContext.close();

            // 完成
            this.recorder.accumulatedText = (this.recorder.accumulatedText + fullText).trim();
            if (textarea) textarea.value = this.recorder.accumulatedText;

            if (barEl) barEl.style.width = '100%';
            if (statusEl) statusEl.textContent = `AI识别完成！共识别 ${fullText.length} 字`;
            UI.showToast(`本地AI识别完成，共识别 ${fullText.length} 字`);

            setTimeout(() => {
                if (progressEl) progressEl.style.display = 'none';
                if (barEl) barEl.style.width = '0%';
            }, 3000);

            return true;
        } catch (err) {
            console.error('[Whisper] 文件导入失败:', err);
            UI.showToast('AI识别失败：' + (err.message || '不支持的音频格式'));
            if (progressEl) progressEl.style.display = 'none';
            return false;
        } finally {
            // 恢复实时录音的消息处理器
            this._worker.onmessage = originalHandler || ((e) => this._onWorkerMessage(e));
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
