// whisperWorker.js - Whisper 模型推理 Web Worker
// 将 ONNX 模型推理从主线程移到 Worker 线程，避免阻塞 UI
// 主线程通过 postMessage 发送音频数据，Worker 返回识别文本

let pipeline = null;
let isLoading = false;

/**
 * 加载 Whisper pipeline
 * @param {Object} payload
 * @param {string} payload.modelPath - 模型完整路径（绕过 transformers.js v3.4.1 的 localModelPath bug）
 * @param {string} payload.wasmPaths - ONNX Runtime WASM 文件路径
 * @param {string} payload.localModelPath - env.localModelPath（保留兼容）
 */
async function loadPipeline({ modelPath, wasmPaths, localModelPath }) {
    if (pipeline || isLoading) return;
    isLoading = true;
    try {
        // Worker 中 import transformers.js（ES module）
        const transformers = await import('../vendor/transformers.min.js');

        // 配置环境
        if (transformers.env) {
            transformers.env.allowLocalModels = true;
            transformers.env.allowRemoteModels = false;
            if (localModelPath) transformers.env.localModelPath = localModelPath;

            // ONNX Runtime WASM 路径
            const onnxEnv = transformers.env.backends?.onnx;
            if (onnxEnv) {
                if (!onnxEnv.wasm) onnxEnv.wasm = {};
                if (wasmPaths) onnxEnv.wasm.wasmPaths = wasmPaths;
            }
        }

        console.log('[WhisperWorker] 开始加载 pipeline, modelPath=', modelPath);

        // 传完整路径作为 modelId，绕过 transformers.js v3.4.1 localModelPath bug
        pipeline = await transformers.pipeline(
            'automatic-speech-recognition',
            modelPath,
            {
                local_files_only: true,
                progress_callback: (progress) => {
                    self.postMessage({ type: 'progress', progress });
                }
            }
        );

        console.log('[WhisperWorker] pipeline 加载完成');
        self.postMessage({ type: 'ready' });
    } catch (err) {
        console.error('[WhisperWorker] 加载失败:', err);
        self.postMessage({ type: 'error', error: err.message, stack: err.stack });
    } finally {
        isLoading = false;
    }
}

/**
 * 执行一次识别
 * @param {Object} payload
 * @param {Float32Array} payload.audio - 音频数据
 * @param {number} payload.sampleRate - 采样率
 * @param {number} payload.chunkId - 分片ID（用于主线程去重和顺序匹配）
 */
async function transcribe({ audio, sampleRate, chunkId }) {
    if (!pipeline) {
        self.postMessage({ type: 'error', error: 'pipeline 未加载', chunkId });
        return;
    }
    try {
        // 简单 VAD：计算音频 RMS 能量，静音段直接返回空文本
        // Whisper 对静音/低能量音频容易产生"我我我""你你你"等重复 token 幻觉
        let sumSq = 0;
        for (let i = 0; i < audio.length; i++) {
            sumSq += audio[i] * audio[i];
        }
        const rms = Math.sqrt(sumSq / audio.length);
        console.log(`[WhisperWorker] chunkId=${chunkId} 音频时长=${(audio.length/sampleRate).toFixed(1)}s RMS=${rms.toFixed(4)}`);
        // RMS < 0.003 视为静音（降低阈值，避免误判低增益麦克风的正常说话为静音）
        if (rms < 0.003) {
            console.log(`[WhisperWorker] chunkId=${chunkId} 静音跳过`);
            self.postMessage({ type: 'result', text: '', chunkId });
            return;
        }

        // 关键参数说明：
        // - chunk_length_s: 不传（让 transformers.js 用默认值，避免与音频长度不匹配导致内部切分异常）
        // - return_timestamps: false（实时识别不需要时间戳，避免 chunks 返回导致处理复杂化）
        // - language: 'chinese', task: 'transcribe'
        // - max_new_tokens: 限制生成长度，避免静音段产生超长重复 token
        const audioDuration = audio.length / sampleRate;
        const result = await pipeline(audio, {
            sampling_rate: sampleRate,
            language: 'chinese',
            task: 'transcribe',
            return_timestamps: false,
            // 限制最大生成 token 数：中文每字约 1-2 token，10 秒音频最多约 100 字
            // 避免模型在静音/噪声段无限生成重复 token
            max_new_tokens: Math.min(200, Math.floor(audioDuration * 25))
        });

        let text = '';
        if (result && result.text) {
            text = result.text.trim();
            console.log(`[WhisperWorker] chunkId=${chunkId} 识别结果: "${text}"`);
            // 去除 Whisper 常见的幻觉重复模式：
            // 连续重复相同字符（如"我我我我我"、"。。。。。。"）
            text = text.replace(/(.)\1{4,}/g, '$1$1');
            // 去除连续重复的短句（如"你好你好你好你好"）
            text = text.replace(/(.{2,8}?)\1{2,}/g, '$1');
        } else {
            console.log(`[WhisperWorker] chunkId=${chunkId} 识别结果为空`);
        }

        self.postMessage({ type: 'result', text, chunkId });
    } catch (err) {
        console.error('[WhisperWorker] 识别出错:', err);
        self.postMessage({ type: 'error', error: err.message, chunkId });
    }
}

// 消息处理
self.addEventListener('message', async (e) => {
    const { type, ...payload } = e.data;
    switch (type) {
        case 'load':
            await loadPipeline(payload);
            break;
        case 'transcribe':
            await transcribe(payload);
            break;
        case 'clear':
            // 不卸载 pipeline（卸载后重新加载很慢），仅用于重置 Worker 状态
            break;
    }
});
