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
        // 关键参数说明：
        // - chunk_length_s: 30（transformers.js 内部切分窗口，传比音频更长的值避免内部二次切分）
        // - return_timestamps: true（让 pipeline 内部按 VAD 切分，避免静音段产生重复 token 幻觉）
        // - language: 'chinese', task: 'transcribe'
        const result = await pipeline(audio, {
            sampling_rate: sampleRate,
            language: 'chinese',
            task: 'transcribe',
            chunk_length_s: 30,
            return_timestamps: true
        });

        let text = '';
        if (result && result.text) {
            text = result.text.trim();
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
