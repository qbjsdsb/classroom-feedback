// providerInterface.js - 语音识别 Provider 基类与契约
// 所有引擎（Whisper / Vosk / Sherpa / Browser）实现此接口，由 Recorder 统一调度
// 设计目标：Recorder 只负责 UI 反馈、计时、文本写入；Provider 负责音频采集、模型推理、结果输出
// Provider 通过回调（onResult/onPartial/onError）把识别文本交给 Recorder，不直接操作文本框

class SpeechProvider {
    /**
     * @param {Recorder} recorder - Recorder 实例引用，用于访问共享状态与日志
     */
    constructor(recorder) {
        this.recorder = recorder;
    }

    // ========== 引擎元信息（子类覆盖） ==========
    /** 引擎标识：'whisper' | 'vosk' | 'sherpa' | 'browser' */
    id = 'base';
    /** 显示名称 */
    displayName = '基础引擎';
    /** 模型大小（用于 UI 显示，如 '40MB'） */
    modelSize = '0';
    /** 是否需要联网下载模型 */
    requiresNetwork = false;
    /** 模型是否已加载就绪 */
    isReady = false;
    /** 当前状态：'idle' | 'loading' | 'ready' | 'running' | 'error' */
    status = 'idle';

    // ========== 接口契约（子类实现） ==========

    /**
     * 浏览器能力检测（是否支持此引擎）
     * @returns {boolean}
     */
    isSupported() {
        return true;
    }

    /**
     * 预加载模型（不开始识别）
     * @param {Function} [onProgress] - 进度回调 ({ status, progress, file })
     * @returns {Promise<void>}
     */
    async preload(onProgress) {
        // 子类实现
    }

    /**
     * 开始识别
     * @param {Object} callbacks
     * @param {Function} callbacks.onResult - 最终结果回调，输出一段已识别完成的文本（追加到文本框）
     * @param {Function} [callbacks.onPartial] - 中间结果回调（实时显示，可被后续 onResult 覆盖）
     * @param {Function} [callbacks.onError] - 错误回调 (err: Error)
     * @returns {Promise<boolean>} 是否启动成功
     */
    async start({ onResult, onPartial, onError }) {
        return false;
    }

    /**
     * 停止识别
     * @param {boolean} isFullStop - true=完全停止（清空内部状态），false=暂停（保留状态可恢复）
     * @returns {Promise<void>}
     */
    async stop(isFullStop = true) {
        // 子类实现
    }

    /**
     * 导入音频文件识别（可选，不支持则返回 false）
     * @param {File} file
     * @param {Function} [onProgress] - 进度回调 (pct: number, statusText: string)
     * @returns {Promise<boolean>} 是否处理成功
     */
    async importFile(file, onProgress) {
        return false;
    }

    // ========== 供子类使用的共享辅助方法 ==========

    /**
     * 通过 Recorder 写日志（统一日志格式）
     */
    _log(level, event, extra) {
        if (this.recorder && typeof this.recorder._log === 'function') {
            this.recorder._log(level, event, extra);
        }
    }
}
