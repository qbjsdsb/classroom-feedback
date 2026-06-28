// recorder.js - 录音与语音识别（长时间稳定录音 + macOS适配）

class Recorder {
    constructor() {
        this.recognition = null;
        this.isRecording = false;
        this.shouldRestart = false;
        this.restartDelay = 300;
        this.maxRestartDelay = 5000;
        this.currentDelay = 300;
        this.silenceTimer = null;
        this.silenceThreshold = 180000; // 180秒无语音才自动停止（适配长时间课程，避免正常停顿误触发）
        this.accumulatedText = '';
        this.finalTranscript = '';
        this.interimTranscript = '';
        this.lastFinalCount = 0; // 上次 onresult 时的 final result 数量，用于检测新增
        this._lastProcessedResultIdx = -1; // 已处理的最大 final results 索引（去重保护，-1 表示无）
        this._lastCommittedInterim = ''; // 上次 onend/重启时已提交的 interim 文本（跨实例去重）
        this._dedupPending = false; // 是否有待去重的 final（重启后首个 final 需检查是否与已提交 interim 重复）
        this.sessionStartTime = null;
        this.timerInterval = null;
        this.permissionChecked = false;
        this.hasSpeechApi = false;
        // 长按录音相关
        this.longPressTimer = null;
        this.isLongPress = false;
        this.longPressThreshold = 500;
        this.touchStartY = 0;
        this.touchMoved = false;
        // 绑定的事件处理器引用（用于正确移除）
        this._boundHandlers = {};
        // 长时间录音增强
        this.restartCount = 0;
        this.maxRestarts = 720; // 4小时课程最多允许720次重启（每次约20秒）
        this.segmentCount = 0; // 已完成的识别段数
        this.lastResultTime = Date.now(); // 最后一次识别结果时间
        this.healthCheckInterval = null; // 健康检查定时器
        this._restartTimeout = null; // 重启定时器ID（用于清理）
        this._forcedRebuildTimeout = null; // 健康检查强制重建定时器ID（用于清理）
        this._autoCommitted = false; // 自动commit一次性标志（每次onstart重置，防止重复触发大字符串拼接）
        this._startTimeout = null; // onstart超时检测定时器ID（start()后5秒未触发onstart则重建）
        this._connectingHintTimeout = null; // 连接进度提示定时器ID（启动期间的UI反馈）
        this._isStarting = false; // 防重入锁
        this._manualStop = false; // 手动停止标志，防止 onresult/onend 重复写入
        this._userIntendsToRecord = false; // 用户意图录音（重启期间也保持true，用于健康检查）
        this._networkErrorCount = 0; // 连续网络错误计数
        this._isTransientError = false; // 瞬时错误标志（no-speech/network不计入restartCount）
        this._isPaused = false; // 暂停状态标志（比accumulatedText更可靠地判断是否应恢复）
        this._backgroundTime = null; // 页面切到后台的时间（用于可见性处理）
        this._lastStatusToastMinute = -1; // 上次30分钟状态提示的分钟数（防止重复提示）
        this._importAudio = null; // 当前导入的 audio 元素（用于取消）
        this._importRecognition = null; // 当前导入的 recognition 实例（用于取消）
        this._importAudioCtx = null; // 当前导入的 AudioContext（用于取消）
        this.isMac = /Macintosh/.test(navigator.userAgent); // macOS检测（排除iOS）
        this.isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent); // Safari检测

        // ========== 录音日志系统 ==========
        this._logBuffer = []; // 内存日志（最近500条）
        this._logMaxSize = 500;
        this._logStorageKey = 'recorder_log'; // localStorage 键（仅存 warn/error）
        this._logStorageMaxSize = 50;
        this._persistBuffer = []; // 待持久化缓冲区（防抖批量写入）
        this._persistTimer = null; // 防抖定时器

        this.initSpeechRecognition();
        // 初始化语音识别 Provider（Whisper 已抽离到 js/speech/whisperProvider.js）
        this._whisperProvider = new WhisperProvider(this);
        this._whisperPausedDuration = 0; // 已暂停时长（resume 时扣除，供 browser/whisper 分支共用）
        this._initVisibilityHandler();
        // 页面卸载前刷新日志缓冲区，避免丢失未持久化的 warn/error 日志
        window.addEventListener('beforeunload', () => this._flushPersistBuffer());
    }

    // ========== 去重锚点管理 ==========
    // 三个去重锚点：_lastProcessedResultIdx（已处理 final 索引）、
    //   _lastCommittedInterim（上次提交的 interim 文本）、_dedupPending（新实例首个 final 是否需去重）
    // 所有创建新 recognition 实例的路径都必须调用其中一个，避免锚点残留导致丢内容或重复内容

    /**
     * 完全重置三个去重锚点（用于 start/stop/resume 等会话级切换）
     */
    _resetDedupAnchors() {
        this._lastProcessedResultIdx = -1;
        this._lastCommittedInterim = '';
        this._dedupPending = false;
    }

    /**
     * 为运行时实例重建重置去重锚点（用于健康检查/可见性/onstart超时/_scheduleRestart 重建）
     * 与 _resetDedupAnchors 的区别：保留 _lastCommittedInterim 并派生 _dedupPending，
     * 让新实例首个 final 能与上次提交的 interim 做跨实例去重（与 onstart 逻辑一致）
     */
    _resetDedupForRebuild() {
        this._lastProcessedResultIdx = -1;
        this._dedupPending = !!this._lastCommittedInterim;
    }

    // ========== 日志系统方法 ==========

    /**
     * 记录日志
     * @param {string} level - 级别：'info'|'warn'|'error'
     * @param {string} event - 事件描述
     * @param {object} extra - 附加信息（可选）
     */
    _log(level, event, extra = null) {
        const now = new Date();
        const time = `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}:${now.getSeconds().toString().padStart(2,'0')}`;
        const state = `isRecording=${this.isRecording},shouldRestart=${this.shouldRestart},restartCount=${this.restartCount}`;
        const provider = (typeof Storage !== 'undefined' && Storage && Storage.getSpeechConfig) ? Storage.getSpeechConfig().provider : 'browser';

        const entry = {
            time,
            level,
            event,
            state,
            provider,
            extra: extra || '',
            _seq: this._logBuffer.length // 序号，用于去重时区分同一秒内的不同条目
        };

        // 内存日志（FIFO）
        this._logBuffer.push(entry);
        if (this._logBuffer.length > this._logMaxSize) {
            this._logBuffer.shift();
        }

        // warn/error 持久化到 localStorage
        if (level === 'warn' || level === 'error') {
            this._persistLog(entry);
        }

        // 控制台同步输出
        const prefix = `[Recorder ${time}] ${level.toUpperCase()}`;
        const msg = extra ? `${prefix} ${event} | ${extra}` : `${prefix} ${event}`;
        if (level === 'error') console.error(msg);
        else if (level === 'warn') console.warn(msg);
        else console.log(msg);
    }

    /** 持久化 warn/error 日志到 localStorage（防抖批量写入） */
    _persistLog(entry) {
        // 先加入缓冲区
        this._persistBuffer.push(entry);

        // 防抖：1秒内的多条日志合并为一次写入，减少 JSON 序列化次数
        if (!this._persistTimer) {
            this._persistTimer = setTimeout(() => {
                this._flushPersistBuffer();
            }, 1000);
        }
    }

    /** 将缓冲区中的日志批量写入 localStorage */
    _flushPersistBuffer() {
        this._persistTimer = null;
        if (this._persistBuffer.length === 0) return;

        try {
            let logs = JSON.parse(localStorage.getItem(this._logStorageKey) || '[]');
            // 批量追加
            for (const entry of this._persistBuffer) {
                logs.push(entry);
            }
            // FIFO 淘汰
            if (logs.length > this._logStorageMaxSize) {
                logs = logs.slice(-this._logStorageMaxSize);
            }
            localStorage.setItem(this._logStorageKey, JSON.stringify(logs));
            this._persistBuffer = [];
        } catch (e) {
            // localStorage 满或不可用，清空缓冲区避免积压
            this._persistBuffer = [];
        }
    }

    /** 获取所有日志（内存 + 持久化，去重合并） */
    getLogs() {
        // 先刷新缓冲区，确保未持久化的日志也被包含
        this._flushPersistBuffer();

        let persisted = [];
        try {
            persisted = JSON.parse(localStorage.getItem(this._logStorageKey) || '[]');
        } catch (e) {}

        // 合并：持久化日志可能包含上一次会话的记录
        // 使用 time|event|level 作为 key 去重（同一秒内相同事件+级别视为重复）
        const allMap = new Map();
        for (const entry of persisted) {
            const key = `${entry.time}|${entry.event}|${entry.level}`;
            allMap.set(key, entry);
        }
        // 内存日志优先（更新），覆盖持久化中的同 key 条目
        for (const entry of this._logBuffer) {
            const key = `${entry.time}|${entry.event}|${entry.level}`;
            allMap.set(key, entry);
        }
        // 按时间排序
        return Array.from(allMap.values()).sort((a, b) => {
            if (a.time !== b.time) return a.time.localeCompare(b.time);
            return (a._seq || 0) - (b._seq || 0);
        });
    }

    /** 导出日志为纯文本格式 */
    exportLogs() {
        const logs = this.getLogs();
        if (logs.length === 0) return '暂无录音日志';

        const header = `录音日志导出 | ${new Date().toLocaleString()} | 平台: ${this.isMac ? 'macOS' : 'Windows'} ${this.isSafari ? 'Safari' : 'Chrome/Edge'}`;
        const lines = logs.map(e => {
            const level = e.level.toUpperCase().padEnd(5);
            const extra = e.extra ? ` | ${e.extra}` : '';
            return `[${e.time}] ${level} ${e.event}${extra}  [${e.state}]`;
        });
        return `${header}\n${'─'.repeat(60)}\n${lines.join('\n')}`;
    }

    /** 清空所有日志 */
    clearLogs() {
        this._logBuffer = [];
        this._persistBuffer = [];
        if (this._persistTimer) {
            clearTimeout(this._persistTimer);
            this._persistTimer = null;
        }
        try { localStorage.removeItem(this._logStorageKey); } catch (e) {}
    }

    /** 清理 SpeechRecognition 实例的事件处理器，打破闭包循环引用 */
    _cleanupRecognition(recognition) {
        if (!recognition) return;
        try {
            recognition.onstart = null;
            recognition.onend = null;
            recognition.onresult = null;
            recognition.onerror = null;
        } catch (e) {}
    }

    initSpeechRecognition() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            this.hasSpeechApi = false;
            return;
        }
        this.hasSpeechApi = true;

        // macOS Safari 适配：Safari 的 SpeechRecognition 有时会忽略 continuous=true
        // 通过更频繁的重启来弥补
        if (this.isSafari) {
            this.restartDelay = 800; // Safari abort()后需要更长冷却时间才能再次start()
            this.silenceThreshold = 60000; // Safari 静音阈值稍短
        }

        this.recognition = this._createRecognition();
    }

    /**
     * 创建新的 SpeechRecognition 实例并绑定所有事件
     * 长时间录音时每次重启都创建新实例，避免旧实例进入不可恢复的异常状态
     * （Web Speech API 已知问题：同一个实例多次 start/stop 循环后会失效）
     */
    _createRecognition() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) return null;

        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = 'zh-CN';
        recognition.maxAlternatives = 1;

        recognition.onstart = () => {
            // 忽略已被替换的旧实例的事件
            if (this.recognition !== recognition) return;
            // onstart 已触发，清除超时检测定时器
            if (this._startTimeout) {
                clearTimeout(this._startTimeout);
                this._startTimeout = null;
            }
            // 清除连接进度提示定时器
            if (this._connectingHintTimeout) {
                clearTimeout(this._connectingHintTimeout);
                this._connectingHintTimeout = null;
            }
            this.isRecording = true;
            this.shouldRestart = true;
            this.currentDelay = this.restartDelay;
            this.lastResultTime = Date.now(); // 重置时间，给新实例30秒干净窗口
            this._autoCommitted = false; // 重置自动commit标志，新实例可以再次触发
            // 重置去重锚点：保留 _lastCommittedInterim 并派生 _dedupPending（跨实例去重）
            this._resetDedupForRebuild();
            if (!this.sessionStartTime) this.sessionStartTime = Date.now();
            this._log('info', '识别实例启动');
            UI.updateRecordButton(true);
            this.startTimer();
            this._startSilenceDetection();
            this._startHealthCheck();
            // 同步启动课堂计时器
            if (recordPage && typeof recordPage.startClassTimer === 'function') {
                recordPage.startClassTimer();
            }
            if (this.segmentCount === 0) {
                UI.showToast('录音已开始，请说话');
            }
        };

        recognition.onend = () => {
            // 忽略已被替换的旧实例的事件（防止陈旧实例触发重复重启级联）
            if (this.recognition !== recognition) return;
            this.isRecording = false;
            this._stopSilenceDetection();
            // 仅在非重启状态下停止健康检查，重启期间保持健康检查运行作为看门狗
            if (!this.shouldRestart || this._manualStop) {
                this._stopHealthCheck();
            }

            // 手动停止时，commitTranscript 已在 pause()/stop() 中调用
            // 此处不再重复提交，避免 accumulatedText 重复叠加
            if (this._manualStop) {
                this._manualStop = false;
                if (!this.shouldRestart) {
                    UI.updateRecordButton(false);
                }
                return;
            }

            // onend 自动重启时提交 final 和 interim，避免丢失用户最后说的话
            // 重复问题通过 onresult 去重逻辑 + 重启时清空旧实例状态来解决
            this.commitTranscript();
            if (!this.shouldRestart) {
                UI.updateRecordButton(false);
            }

            if (this.shouldRestart && this.restartCount < this.maxRestarts) {
                // 瞬时错误（no-speech/network）不消耗正常重启配额
                // 健康检查强制重建通过 shouldRestart=false 跳过此 onend 重启分支，因此不消耗配额
                if (!this._isTransientError) {
                    this.restartCount++;
                }
                const reason = this._isTransientError ? 'transient' : 'normal';
                this._log('info', `识别重启(第${this.restartCount}次)`, `reason=${reason},delay=${this.currentDelay}ms`);
                this._isTransientError = false; // 重置标志
                this.currentDelay = this.restartDelay; // 重置延迟
                this._restartFailCount = 0;
                this._scheduleRestart();
            } else if (this.restartCount >= this.maxRestarts) {
                this._log('warn', '达到最大重启次数，录音自动停止', `restartCount=${this.restartCount}`);
                // 直接调用 stop() 完成完整清理（包括 abort、清理定时器、更新 textarea、停止计时器等）
                // 避免遗漏清理项导致状态不一致
                this.stop();
                UI.showToast('已达到最大录音时长，录音已自动停止', 5000);
            }
        };

        recognition.onresult = (event) => {
            // 忽略已被替换的旧实例的事件
            if (this.recognition !== recognition) return;
            this._resetSilenceDetection();
            this.lastResultTime = Date.now();
            this._networkErrorCount = 0; // 网络恢复，重置网络错误计数

            // 手动停止时，浏览器可能还会触发一次 onresult（将剩余 interim 转 final）
            // 此时 commitTranscript 已在 pause()/stop() 中调用，所有文本已保存到 accumulatedText
            // 直接忽略即可，否则会导致文本重复
            if (this._manualStop) {
                return;
            }

            // 自动commit：一次性触发，防止每次 onresult 都执行大字符串拼接
            // 仅在 results 积累过多且未触发过时执行一次
            if (!this._autoCommitted && event.results.length > 50 && this.lastFinalCount > 30) {
                this._autoCommitted = true; // 标记已触发，本次识别实例内不再重复
                this._log('info', '自动commit', `results=${event.results.length},finalCount=${this.lastFinalCount}`);
                // 仅提交 final 文本，不提交 interim（避免 interim 后续变 final 时重复）
                if (this.finalTranscript) {
                    this.accumulatedText += this.finalTranscript;
                    this.finalTranscript = '';
                }
            }

            // 增量遍历：只处理从 resultIndex 开始的新增/变更结果
            // event.resultIndex 是本次事件中第一个发生变化的索引，之前的未变化无需重新扫描
            // 长时间录音时 event.results 会持续累积，全量遍历 O(n) 导致越来越慢
            const startIdx = (typeof event.resultIndex === 'number') ? event.resultIndex : 0;
            let newFinal = '';
            let newFinalCount = 0;
            let hasInterim = false;

            // 去重保护：某些手机端 Chrome 版本会对同一个 final result 多次触发 onresult
            // （event.resultIndex 指向已处理过的 final），导致重复追加
            // 用 _lastProcessedResultIdx 记录已处理的最大 final results 索引，跳过已处理的 final
            // 注意：interim 仍需处理（浏览器会不断修正同一个 interim），只对 final 去重
            const lastProcessedIdx = this._lastProcessedResultIdx;
            const effectiveStart = Math.max(startIdx, 0);
            let maxFinalIdx = lastProcessedIdx;

            for (let i = effectiveStart; i < event.results.length; i++) {
                const transcript = event.results[i][0].transcript;
                if (event.results[i].isFinal) {
                    // 去重：跳过已经处理过的 final result（索引 <= lastProcessedIdx）
                    if (i <= lastProcessedIdx) {
                        // 该 final 已处理过，跳过避免重复
                        continue;
                    }
                    newFinalCount++;
                    newFinal += transcript;
                    if (i > maxFinalIdx) maxFinalIdx = i;
                } else {
                    // 只取最后一个 interim（浏览器会不断修正同一个 interim result）
                    this.interimTranscript = transcript;
                    hasInterim = true;
                }
            }

            // 更新已处理的最大 final results 索引（仅记录 final，interim 不计）
            this._lastProcessedResultIdx = maxFinalIdx;

            // 如果本次事件中没有新的 interim，说明之前的 interim 已转为 final 或被清除
            // 需要清空 interimTranscript，避免显示过时的临时文本
            if (!hasInterim) {
                this.interimTranscript = '';
            }

            // 跨实例去重：重启后首个 final 可能包含上次 onend 已提交的 interim 内容
            // 场景：手机端 Chrome onend 触发时提交了 interim，重启后新实例重新识别
            // 到同一段语音并输出 final，导致内容重复。此处去除重复部分。
            if (this._dedupPending && newFinal && this._lastCommittedInterim) {
                const committed = this._lastCommittedInterim;
                // 情况1：新 final 以已提交的 interim 开头（重新识别包含完整旧内容）
                // 去除前缀，只保留新内容
                if (newFinal.startsWith(committed)) {
                    newFinal = newFinal.substring(committed.length);
                    this._log('info', '跨实例去重:去除重复前缀', `committed=${committed.length}字`);
                }
                // 情况2：已提交的 interim 以新 final 开头（interim 比最终识别更完整）
                // 跳过整个 final，避免重复
                else if (committed.startsWith(newFinal)) {
                    newFinal = '';
                    this._log('info', '跨实例去重:跳过重复final', `final被interim包含`);
                }
                // 情况3：两者不完全匹配，保留 final（可能是用户继续说的新内容）
                // 去重只针对首字精确匹配的情况，避免误删合法内容
                this._dedupPending = false;
                this._lastCommittedInterim = '';
            } else if (this._dedupPending) {
                // 没有新 final（只有 interim 或无结果），清除去重状态
                // 避免 _lastCommittedInterim 长期残留影响后续逻辑
                this._dedupPending = false;
                this._lastCommittedInterim = '';
            }

            // 增量追加新的 final 文本
            if (newFinal) {
                this.finalTranscript += newFinal;
                this.lastFinalCount += newFinalCount;
                this.segmentCount += newFinalCount;
            }

            this.updateDisplay();
        };

        recognition.onerror = (event) => {
            // 忽略已被替换的旧实例的事件
            if (this.recognition !== recognition) return;
            switch (event.error) {
                case 'network':
                    // 网络短暂波动是正常现象，自动重启即可
                    // 但连续多次网络错误需要提示用户并增加重启延迟，避免快速循环消耗资源
                    this._networkErrorCount = (this._networkErrorCount || 0) + 1;
                    this.shouldRestart = true;
                    this._isTransientError = true; // 瞬时错误，不计入restartCount
                    this._log('warn', `网络错误(第${this._networkErrorCount}次)`, `delay=${this.currentDelay}ms`);
                    if (this._networkErrorCount >= 5) {
                        // 连续5次网络错误，增加重启延迟避免快速循环
                        this.currentDelay = Math.max(this.currentDelay, 3000);
                        UI.showToast('网络连接不稳定，语音识别可能中断', 3000);
                    } else if (this._networkErrorCount === 3) {
                        // 连续3次网络错误，温和提示
                        UI.showToast('网络波动，正在自动重连...', 2000);
                    }
                    break;
                case 'not-allowed':
                    this._log('error', '麦克风权限被拒绝');
                    UI.showToast('请允许使用麦克风权限');
                    this.shouldRestart = false;
                    this._userIntendsToRecord = false; // 致命错误，阻止 visibilitychange 重建
                    this.showPermissionHelp();
                    break;
                case 'no-speech':
                    // 长时间课程中偶尔没有语音是正常的，继续重启
                    this.shouldRestart = true;
                    this._isTransientError = true; // 瞬时错误，不计入restartCount
                    this._log('info', '无语音输入(no-speech)');
                    break;
                case 'aborted':
                    // 用户主动停止或切换页面
                    this.shouldRestart = false;
                    this._log('info', '识别被中止(aborted)');
                    break;
                case 'audio-capture':
                    this._log('error', '麦克风被占用');
                    UI.showToast('麦克风被占用，请检查其他应用');
                    this.shouldRestart = false;
                    this._userIntendsToRecord = false; // 致命错误，阻止 visibilitychange 重建
                    break;
                case 'service-not-allowed':
                    this._log('error', '语音识别服务不可用', this.isMac ? 'macOS' : 'other');
                    // 语音识别服务不可用
                    UI.showToast('语音识别服务不可用，请检查系统设置');
                    this.shouldRestart = false;
                    this._userIntendsToRecord = false; // 致命错误，阻止 visibilitychange 重建
                    if (this.isMac) {
                        this.showMacSpeechHelp();
                    } else {
                        UI.showToast('请检查浏览器或系统设置中是否允许了语音识别');
                    }
                    break;
                default:
                    this._log('error', `未知错误: ${event.error}`);
                    UI.showToast('语音识别出错: ' + event.error);
                    // 非致命错误继续重启
                    this.shouldRestart = true;
            }
        };

        return recognition;
    }

    // ========== 健康检查（长时间录音稳定性保障）==========

    _startHealthCheck() {
        this._stopHealthCheck();
        this._healthCheckFailCount = 0; // 健康检查失败计数
        // Safari 识别会话更短更不稳定，需要更频繁的检查
        // 非 Safari 也需要健康检查：Chrome 的 SpeechRecognition 可能静默失效（不触发 onend/onerror）
        // 但阈值不能太短，否则正常停顿（让学生做题等）会误触发重启导致断断续续
        const checkInterval = 15000; // 15秒检查一次
        const healthThreshold = this.isSafari ? 45000 : 60000; // Safari 45秒，其他 60秒
        // 定期检查识别是否还在正常工作
        this.healthCheckInterval = setInterval(() => {
            // 基于 _userIntendsToRecord 而非 isRecording
            // 这样重启期间（isRecording=false）健康检查仍然有效
            if (!this._userIntendsToRecord) return;

            // 如果正在重启（_scheduleRestart 排队中），跳过本次检查，避免竞争
            if (this._restartTimeout) return;

            const timeSinceLastResult = Date.now() - this.lastResultTime;
            const duration = this.getRecordingDuration();

            // 如果超过阈值没有识别结果且用户意图录音，可能是识别卡住了
            if (timeSinceLastResult > healthThreshold && this._userIntendsToRecord) {
                this._healthCheckFailCount++;
                this._log('warn', `健康检查:长时间无结果(第${this._healthCheckFailCount}次)`, `elapsed=${Math.round(timeSinceLastResult/1000)}s`);

                if (this._healthCheckFailCount >= 3) {
                    // 连续3次健康检查都失败（约3分钟无结果），recognition 实例很可能已异常
                    this._log('warn', '健康检查连续3次失败，强制重建实例');
                    // 先设置 shouldRestart = false，防止 abort() 触发的 onend 重复重启
                    this.shouldRestart = false;
                    // 提交 final 和 interim，避免丢失用户最后说的话
                    this.commitTranscript();
                    // 先 abort 旧实例，确保完全停止
                    try { this.recognition.abort(); } catch (e) {}
                    this._cleanupRecognition(this.recognition); // 打破闭包循环引用
                    // Safari 的 abort() 可能不触发 onend，手动更新状态
                    this.isRecording = false;
                    // 等待300ms确保旧实例完全释放（某些浏览器需要更长时间释放资源）
                    this._forcedRebuildTimeout = setTimeout(() => {
                        this._forcedRebuildTimeout = null;
                        if (!this._userIntendsToRecord) return;
                        this.recognition = this._createRecognition();
                        this.lastFinalCount = 0;
                        this._resetDedupForRebuild(); // 重置去重锚点（保留跨实例去重状态）
                        this.currentDelay = this.restartDelay;
                        this.lastResultTime = Date.now(); // 重置时间，给新实例干净窗口
                        this.shouldRestart = true; // 恢复重启标志
                        try {
                            this.recognition.start();
                            this._setStartTimeout(); // 设置 onstart 超时检测
                            this._healthCheckFailCount = 0;
                            this._restartFailCount = 0;
                        } catch (e) {
                            console.error('[Recorder] 强制重建后启动失败，启动持续重试:', e);
                            this._scheduleRestart();
                        }
                    }, 300);
                }
                // 首次和第二次失败：只记录警告，不中断识别
                // 课堂中正常停顿（让学生做题等）不应触发重启，避免断断续续
            } else {
                this._healthCheckFailCount = 0;
            }

            // 每30分钟显示一次录音状态（让用户知道还在录音）
            if (duration > 0 && duration % 1800 < 15 && duration > 60) {
                const mins = Math.floor(duration / 60);
                // 防止同一分钟内重复提示（健康检查间隔10-15秒可能命中两次）
                if (mins !== this._lastStatusToastMinute) {
                    this._lastStatusToastMinute = mins;
                    UI.showToast(`录音进行中，已录制 ${mins} 分钟`);
                }
            }
        }, checkInterval);
    }

    _stopHealthCheck() {
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
            this.healthCheckInterval = null;
        }
    }

    /**
     * 设置 onstart 超时检测：recognition.start() 后 5 秒未触发 onstart 则重建实例
     * 解决 start() 不抛异常但 onstart 永远不触发的"静默失败"问题
     * 正常情况下 onstart 在 1-2 秒内触发，5 秒足够判断异常
     */
    _setStartTimeout() {
        if (this._startTimeout) {
            clearTimeout(this._startTimeout);
        }
        // 连接进度提示：闲置后首次录音时，Web Speech API 需重新连接 Google 服务器
        // onstart 触发可能要数秒，期间给用户进度反馈避免以为卡死
        if (!this.isRecording && this._userIntendsToRecord) {
            const statusEl = document.querySelector('.record-status');
            if (statusEl) {
                statusEl.textContent = '正在连接语音识别服务...';
                // 3秒后若仍未启动，提示网络较慢
                this._connectingHintTimeout = setTimeout(() => {
                    if (!this.isRecording && this._userIntendsToRecord) {
                        const el = document.querySelector('.record-status');
                        if (el) el.textContent = '连接较慢，正在重试...';
                    }
                }, 3000);
            }
        }
        this._startTimeout = setTimeout(() => {
            this._startTimeout = null;
            if (this._connectingHintTimeout) {
                clearTimeout(this._connectingHintTimeout);
                this._connectingHintTimeout = null;
            }
            // 仅在 start() 成功但 onstart 未触发时才重建
            // isRecording=false 说明 onstart 没有触发，_userIntendsToRecord=true 说明用户仍在录音
            if (!this.isRecording && this._userIntendsToRecord) {
                this._log('warn', 'onstart超时(5秒)，重建实例');
                this.shouldRestart = false;
                this.commitTranscript();
                try { this.recognition.abort(); } catch (e) {}
                this._cleanupRecognition(this.recognition);
                this.isRecording = false;
                this.recognition = this._createRecognition();
                this.lastFinalCount = 0;
                this.currentDelay = this.restartDelay;
                this.lastResultTime = Date.now();
                this.shouldRestart = true;
                // onstart 超时实例从未真正运行，其 interimTranscript 是上一实例残留，
                // commitTranscript 提交的 _lastCommittedInterim 不可信，清空避免新实例首个 final 被误去重
                this._lastCommittedInterim = '';
                this._scheduleRestart();
            }
        }, 5000);
    }

    // ========== 页面可见性处理（浏览器后台节流适配）==========

    _initVisibilityHandler() {
        document.addEventListener('visibilitychange', () => {
            if (!this._userIntendsToRecord) return;

            if (document.hidden) {
                // 页面切到后台：记录时间，清理定时器避免积压或在后台触发
                this._log('info', '页面切到后台');
                this._backgroundTime = Date.now();
                if (this._restartTimeout) {
                    clearTimeout(this._restartTimeout);
                    this._restartTimeout = null;
                }
                if (this._forcedRebuildTimeout) {
                    clearTimeout(this._forcedRebuildTimeout);
                    this._forcedRebuildTimeout = null;
                }
            } else {
                // 页面切回前台：检查是否需要重启识别
                const backgroundDuration = this._backgroundTime ? (Date.now() - this._backgroundTime) : 0;
                this._backgroundTime = null;

                // 后台超过30秒，识别很可能已经失效，直接重建
                if (backgroundDuration > 30000 && this._userIntendsToRecord) {
                    this._log('warn', '页面后台超过30秒，重建实例', `bg=${Math.round(backgroundDuration/1000)}s`);
                    this.shouldRestart = false; // 防止 abort 触发的 onend 重复调度
                    // 提交 final 和 interim，避免丢失用户最后说的话
                    this.commitTranscript();
                    try { this.recognition.abort(); } catch (e) {}
                    this._cleanupRecognition(this.recognition); // 打破闭包循环引用
                    this.isRecording = false;
                    this.recognition = this._createRecognition();
                    this.lastFinalCount = 0;
                    this._resetDedupForRebuild(); // 重置去重锚点（保留跨实例去重状态，commitTranscript 已写入 _lastCommittedInterim）
                    this.lastResultTime = Date.now();
                    this.currentDelay = this.restartDelay;
                    this.shouldRestart = true;
                    try {
                        this.recognition.start();
                        this._setStartTimeout(); // 补 onstart 超时安全网（与其他重建路径一致）
                    } catch (e) {
                        this._scheduleRestart();
                    }
                } else if (backgroundDuration > 5000 && this._userIntendsToRecord) {
                    // 后台5-30秒，重置 lastResultTime 让健康检查重新计时
                    this._log('info', '页面后台5-30秒恢复', `bg=${Math.round(backgroundDuration/1000)}s`);
                    this.lastResultTime = Date.now();
                }
            }
        });
    }

    /**
     * 调度 recognition 重启（持续重试直到成功、用户停止或达到上限）
     * 解决 Web Speech API 长时间使用后实例失效、start() 抛异常的问题
     */
    _scheduleRestart() {
        // 清理可能已存在的旧定时器，避免多个重启并行
        if (this._restartTimeout) {
            clearTimeout(this._restartTimeout);
            this._restartTimeout = null;
        }
        const delay = this.currentDelay;
        this._restartTimeout = setTimeout(() => {
            this._restartTimeout = null;
            if (!this._userIntendsToRecord) return;

            // 先确保旧实例完全停止，避免 "already started" 错误
            // 设置 shouldRestart = false 防止 abort() 触发的 onend 重复调度
            this.shouldRestart = false;
            // 提交 final 和 interim，避免丢失用户最后说的话
            this.commitTranscript();
            try { this.recognition.abort(); } catch (e) {}
            this._cleanupRecognition(this.recognition); // 打破闭包循环引用
            // Safari 的 abort() 可能不触发 onend，手动更新状态
            this.isRecording = false;

            // 每次重启都创建新的 recognition 实例
            this.recognition = this._createRecognition();
            // 重置 lastFinalCount，因为新实例的 event.results 从空开始
            this.lastFinalCount = 0;
            this._resetDedupForRebuild(); // 重置去重锚点（保留跨实例去重状态）
            this.lastResultTime = Date.now(); // 重置时间，给新实例干净窗口
            this.shouldRestart = true; // 恢复重启标志

            try {
                this.recognition.start();
                // start 成功，重置延迟为初始值
                this.currentDelay = this.restartDelay;
                this._restartFailCount = 0;
                this._log('info', '重启成功');
                // 设置 onstart 超时检测：5秒内未触发 onstart 则重建
                this._setStartTimeout();
                // onstart 会启动健康检查，此处无需重复启动
            } catch (e) {
                this._restartFailCount = (this._restartFailCount || 0) + 1;
                this._log('error', `重启失败(第${this._restartFailCount}次)`, e.message);

                // 连续失败超过20次，停止重试，避免无限循环消耗资源
                if (this._restartFailCount >= 20) {
                    this._log('error', '连续重启失败超过20次，停止重试');
                    this.shouldRestart = false;
                    this._userIntendsToRecord = false;
                    this._stopHealthCheck();
                    this.stopTimer();
                    UI.updateRecordButton(false);
                    UI.showToast('语音识别持续无法启动，请检查浏览器设置后重新录音', 5000);
                    return;
                }

                // 指数退避，最大 5 秒（缩短上限，加快恢复）
                this.currentDelay = Math.min(this.currentDelay * 1.5, 5000);

                // 连续失败 3 次提示用户
                if (this._restartFailCount === 3) {
                    UI.showToast('语音识别正在重新连接，请稍候...', 3000);
                }

                // 继续重试
                this._scheduleRestart();
            }
        }, delay);
    }

    // ========== 录音统计信息 ==========

    getRecordingStats() {
        const duration = this.getRecordingDuration();
        const mins = Math.floor(duration / 60);
        const text = this.accumulatedText + this.finalTranscript + this.interimTranscript;
        const charCount = text.length;
        return {
            duration,
            durationStr: `${mins}分${duration % 60}秒`,
            restartCount: this.restartCount,
            segmentCount: this.segmentCount,
            charCount,
            isRecording: this.isRecording
        };
    }

    // ========== 检查麦克风权限 ==========
    // 优化：避免重复 getUserMedia 调用（旧代码 checkPermission 调用一次，
    // start() 又调用一次，第二次因第一次刚释放设备而等待）
    // 改为只查询权限状态，不实际获取流。getUserMedia 在 start() 中执行一次即可
    async checkPermission() {
        // 检查浏览器是否支持 getUserMedia
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            return { granted: false, reason: 'not-supported', error: '浏览器不支持麦克风访问' };
        }

        // 仅查询权限状态，不获取流（避免重复获取/释放设备导致的延迟）
        // 注意：permissions.query 在部分浏览器上较慢，但比 getUserMedia 快
        if (navigator.permissions && navigator.permissions.query) {
            try {
                const result = await navigator.permissions.query({ name: 'microphone' });
                if (result.state === 'denied') {
                    return { granted: false, reason: 'denied' };
                }
                if (result.state === 'prompt') {
                    return { granted: false, reason: 'prompt' };
                }
                // granted：已授权，继续返回 granted（getUserMedia 在 start 中执行）
            } catch (e) {
                // permissions.query 不支持时，走 getUserMedia 探测
            }
        }

        // 已授权或无法查询权限状态：返回 granted，实际 getUserMedia 在 start() 中执行
        this.permissionChecked = true;
        return { granted: true };
    }

    startTimer() {
        this.stopTimer();
        this.timerInterval = setInterval(() => {
            const duration = this.getRecordingDuration();
            const hours = Math.floor(duration / 3600);
            const mins = Math.floor((duration % 3600) / 60);
            const secs = duration % 60;
            const statusEl = document.querySelector('.record-status');
            const timerEl = document.getElementById('recording-timer');

            // 超过1小时显示小时
            let timeStr;
            if (hours > 0) {
                timeStr = `${hours}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
            } else {
                timeStr = `${mins}:${secs.toString().padStart(2, '0')}`;
            }

            if (statusEl) {
                const stats = this.getRecordingStats();
                statusEl.textContent = `正在录音 ${timeStr}（已识别${stats.charCount}字）`;
            }
            if (timerEl) {
                timerEl.textContent = timeStr;
                timerEl.style.display = 'block';
            }
        }, 1000);
    }

    stopTimer() {
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }
        const timerEl = document.getElementById('recording-timer');
        if (timerEl) timerEl.style.display = 'none';
    }

    _startSilenceDetection() {
        this._resetSilenceDetection();
    }

    _resetSilenceDetection() {
        if (this.silenceTimer) clearTimeout(this.silenceTimer);
        this.silenceTimer = setTimeout(() => {
            // 静音检测：长时间没有语音输入
            // 不再完全停止录音，而是提示用户并让健康检查接管重启
            if (this._userIntendsToRecord) {
                console.log('[Recorder] 长时间未检测到语音输入');
                // 不调用 stop()，让健康检查机制处理重启
                // 只更新 lastResultTime，避免健康检查误判
                this.lastResultTime = Date.now();
            }
        }, this.silenceThreshold);
    }

    _stopSilenceDetection() {
        if (this.silenceTimer) {
            clearTimeout(this.silenceTimer);
            this.silenceTimer = null;
        }
    }

    getRecordingDuration() {
        if (!this.sessionStartTime) return 0;
        return Math.floor((Date.now() - this.sessionStartTime) / 1000);
    }

    updateDisplay() {
        // 节流：限制更新频率，避免频繁DOM操作导致卡顿
        // 文本越长，节流间隔越大
        const totalLength = (this.accumulatedText || '').length + (this.finalTranscript || '').length + (this.interimTranscript || '').length;
        let throttleMs = 0;
        if (totalLength > 20000) {
            throttleMs = 500; // 超长文本：500ms
        } else if (totalLength > 8000) {
            throttleMs = 200; // 长文本：200ms
        }

        if (throttleMs > 0) {
            if (this._updateDisplayPending) return;
            this._updateDisplayPending = true;
            setTimeout(() => {
                this._updateDisplayPending = false;
                this._doUpdateDisplay();
            }, throttleMs);
        } else {
            this._doUpdateDisplay();
        }
    }

    _doUpdateDisplay() {
        const textarea = document.getElementById('transcript');
        if (!textarea) return;
        const displayText = this.accumulatedText + this.finalTranscript + this.interimTranscript;
        // 避免重复赋值：只有文本实际变化时才更新 textarea
        // 长文本场景下 textarea.value 赋值开销随文本长度增长
        if (textarea.value === displayText) return;
        textarea.value = displayText;
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        // 自动滚动到底部，但只在用户没有手动滚动时
        const isScrolledToBottom = textarea.scrollHeight - textarea.scrollTop - textarea.clientHeight < 50;
        if (isScrolledToBottom) {
            // 使用 requestAnimationFrame 避免频繁滚动导致的性能问题
            requestAnimationFrame(() => {
                if (textarea) textarea.scrollTop = textarea.scrollHeight;
            });
        }
    }

    commitTranscript(includeInterim = true) {
        if (this.finalTranscript) {
            this.accumulatedText += this.finalTranscript;
            this.finalTranscript = '';
        }
        // 将最后的 interim 文本也保存，避免丢失用户停止时还未确认的内容
        // 注意：仅在手动停止（pause/stop）时提交 interim
        // onend 自动重启时不应提交 interim（新实例会重新识别同一段语音，导致重复）
        if (includeInterim && this.interimTranscript) {
            // 记录已提交的 interim，用于重启后跨实例去重
            // 新实例可能重新识别到相同内容，需从首个 final 中去除重复部分
            this._lastCommittedInterim = this.interimTranscript;
            this.accumulatedText += this.interimTranscript;
            this.interimTranscript = '';
        }
        // 超长文本保护：如果 accumulatedText 超过 50000 字，保留开头和结尾，中间用省略号
        const MAX_ACCUMULATED = 50000;
        if (this.accumulatedText.length > MAX_ACCUMULATED) {
            const head = this.accumulatedText.substring(0, 20000);
            const tail = this.accumulatedText.substring(this.accumulatedText.length - 20000);
            this.accumulatedText = head + '\n\n[... 中间内容已省略（内容过长）...]\n\n' + tail;
            this._log('warn', '转录文本超过50000字，已自动截断保留首尾', `total=${this.accumulatedText.length}`);
            UI.showToast('转录文本过长，中间部分已省略保留首尾', 5000);
        }
    }

    async start() {
        // 防重入保护：避免 async 等待期间重复调用
        if (this._isStarting) return;
        if (this.isRecording) return;

        // start() 始终是全新开始（暂停恢复由 resume() 处理）
        this._isPaused = false;

        // 清理上一会话可能残留的定时器，防止陈旧回调 abort 新实例
        // （重启循环期间用户点开始，旧 _restartTimeout 回调会 abort 刚 start 的新实例）
        if (this._restartTimeout) {
            clearTimeout(this._restartTimeout);
            this._restartTimeout = null;
        }
        if (this._forcedRebuildTimeout) {
            clearTimeout(this._forcedRebuildTimeout);
            this._forcedRebuildTimeout = null;
        }
        if (this._startTimeout) {
            clearTimeout(this._startTimeout);
            this._startTimeout = null;
        }
        if (this._connectingHintTimeout) {
            clearTimeout(this._connectingHintTimeout);
            this._connectingHintTimeout = null;
        }
        this._stopHealthCheck(); // 停止上一会话遗留的健康检查，防止其触发新的强制重建

        // 检查当前选择的语音识别提供商
        const speechConfig = Storage.getSpeechConfig();
        this._log('info', '开始录音', `provider=${speechConfig.provider}`);
        if (speechConfig.provider === 'whisper') {
            // 使用本地AI识别
            this._isStarting = true; // 防重入保护
            // 即时 UI 反馈：getUserMedia 是异步的，等待期间立即更新按钮状态
            // 避免用户以为卡死而重复点击（双击会导致 toggle 走 pause 分支）
            UI.updateRecordButton(true);
            const statusEl = document.querySelector('.record-status');
            if (statusEl) statusEl.textContent = '正在启动本地AI识别...';
            try {
                this.shouldRestart = false; // Whisper不需要自动重启
                this._userIntendsToRecord = true; // 标记用户意图录音（语义一致性）
                this.sessionStartTime = Date.now();
                const textarea = document.getElementById('transcript');
                if (textarea) {
                    this.accumulatedText = textarea.value.trim();
                    if (this.accumulatedText) this.accumulatedText += '\n';
                }
                // 启动课堂计时器（原 startWhisperRecognition 内部逻辑，现由 Recorder 统一管理）
                if (recordPage && typeof recordPage.startClassTimer === 'function') {
                    recordPage.startClassTimer();
                }
                const started = await this._whisperProvider.start({
                    onResult: (text) => this._appendResult(text),
                    onError: (err) => this._log('error', 'Whisper识别错误', err.message)
                });
                this.isRecording = started;
                if (started) {
                    if (statusEl) statusEl.textContent = '正在录音，点击暂停';
                    this.startTimer();
                } else {
                    // 启动失败：恢复按钮状态
                    UI.updateRecordButton(false);
                    this.sessionStartTime = null;
                    this._userIntendsToRecord = false; // 启动失败，清除意图标志
                }
            } catch (err) {
                // 未预期异常：清理所有状态，防止残留
                UI.updateRecordButton(false);
                this._userIntendsToRecord = false;
                this.sessionStartTime = null;
                this.isRecording = false;
                this._log('error', 'Whisper启动异常', err.message);
                UI.showToast('本地AI识别启动异常：' + err.message);
            } finally {
                this._isStarting = false; // 无论成功或异常，都释放防重入锁
            }
            return;
        }

        if (!this.hasSpeechApi) {
            UI.showToast('您的浏览器不支持语音识别，请直接输入课堂内容');
            this.showNoSpeechApiTip();
            return;
        }

        this._isStarting = true;
        try {
            // 即时反馈：点击后立即显示"正在启动"，避免用户以为卡死
            // Web Speech API 的 recognition.start() 是异步的，onstart 触发可能要几秒
            // （浏览器闲置后到 Google 语音服务器的连接断开，需重新建立）
            const statusEl = document.querySelector('.record-status');
            if (statusEl) statusEl.textContent = '正在启动语音识别...';

            // 先检查权限（仅查询状态，不获取流，避免重复 getUserMedia）
            const perm = await this.checkPermission();
            if (!perm.granted) {
                if (perm.reason === 'denied') {
                    this._log('error', '麦克风权限被拒绝(start)');
                    UI.showToast('麦克风权限被拒绝，请在浏览器设置中允许访问');
                    this.showPermissionHelp();
                } else if (perm.reason === 'no-device') {
                    this._log('error', '未检测到麦克风设备');
                    UI.showToast('未检测到麦克风设备');
                } else if (perm.reason === 'not-supported') {
                    this._log('error', '浏览器不支持麦克风访问');
                    UI.showToast('当前浏览器不支持麦克风访问，请使用 Edge、Chrome 或 Safari 浏览器');
                } else if (perm.reason === 'prompt') {
                    // 继续尝试，会弹出权限请求
                } else {
                    this._log('error', '无法访问麦克风', perm.error || '未知错误');
                    UI.showToast('无法访问麦克风：' + (perm.error || '未知错误'));
                }
                if (perm.reason !== 'prompt') return;
            }

            try {
                // getUserMedia 同时完成权限确认和设备获取（合并为一次调用）
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                stream.getTracks().forEach(t => t.stop());

                // 全新开始：读取文本框已有内容作为基础
                const textarea = document.getElementById('transcript');
                if (textarea) {
                    this.accumulatedText = textarea.value.trim();
                    if (this.accumulatedText) this.accumulatedText += '\n';
                }

                this.finalTranscript = '';
                this.interimTranscript = '';
                this._manualStop = false; // 确保新录音会话不受残留标志影响
                this.sessionStartTime = Date.now();
                this.restartCount = 0;
                this.segmentCount = 0;
                this.currentDelay = this.restartDelay;
                this.lastFinalCount = 0;
                this._resetDedupAnchors(); // 全新录音会话，完全重置去重锚点
                this.lastResultTime = Date.now();
                this.shouldRestart = true;
                this._userIntendsToRecord = true; // 标记用户意图录音
                this._restartFailCount = 0;
                this._networkErrorCount = 0; // 新录音会话，重置网络错误计数
                this._isTransientError = false; // 新录音会话，重置瞬时错误标志
                this._lastStatusToastMinute = -1; // 新录音会话，重置状态提示去重

                // 创建新的 recognition 实例，避免旧实例状态残留
                this.recognition = this._createRecognition();
                try {
                    this.recognition.start();
                    this._setStartTimeout(); // 设置 onstart 超时检测
                } catch (startErr) {
                    // start() 失败可能是浏览器限制或实例异常
                    // 通过 _scheduleRestart 持续重试
                    this._log('warn', 'recognition.start()失败', startErr.message);
                    UI.showToast('正在启动语音识别，请稍候...', 2000);
                    this._scheduleRestart();
                }
            } catch (err) {
                if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
                    this._log('error', 'getUserMedia权限被拒绝');
                    UI.showToast('麦克风权限被拒绝，请检查浏览器设置');
                    this.showPermissionHelp();
                } else {
                    this._log('error', 'getUserMedia失败', err.message);
                    UI.showToast('无法访问麦克风：' + err.message);
                }
            }
        } finally {
            this._isStarting = false;
        }
    }

    showNoSpeechApiTip() {
        const recordStatus = document.querySelector('.record-status');
        if (recordStatus) {
            recordStatus.innerHTML = '<span style="color: var(--warning);">⚠️ 浏览器不支持语音识别</span>';
        }
        UI.showToast('您的浏览器不支持语音转文字功能，请直接在下方文本框中输入课堂内容');
    }

    showPermissionHelp() {
        let helpText = `麦克风权限开启方法：\n\n`;
        
        if (this.isMac) {
            helpText += `macOS 系统：\n`;
            helpText += `1. 打开「系统设置」→「隐私与安全性」→「麦克风」\n`;
            helpText += `2. 确保浏览器（Edge/Chrome/Safari）已勾选\n`;
            helpText += `3. 如果使用 Safari，还需：Safari 菜单 → 设置 → 网站 → 麦克风 → 允许\n`;
            helpText += `4. 刷新页面后重试\n\n`;
        }

        helpText += `Edge/Chrome：\n`;
        helpText += `1. 点击地址栏左侧的 🔒 图标\n`;
        helpText += `2. 找到"麦克风"选项\n`;
        helpText += `3. 选择"允许"\n`;
        helpText += `4. 刷新页面后重试\n\n`;

        if (this.isSafari) {
            helpText += `Safari 浏览器额外设置：\n`;
            helpText += `1. Safari 菜单 → 设置（或偏好设置）→ 网站\n`;
            helpText += `2. 找到本网站，点击麦克风设置\n`;
            helpText += `3. 选择"允许"\n`;
            helpText += `4. 确保 macOS 系统设置中也允许了 Safari 使用麦克风\n`;
        }

        helpText += `\n如果仍无法使用，您也可以直接在文本框中输入课堂内容。`;
        alert(helpText);
    }

    // macOS Safari 语音识别帮助
    showMacSpeechHelp() {
        let helpText = `macOS 语音识别服务不可用，请检查以下设置：\n\n`;
        helpText += `1. 打开「系统设置」→「隐私与安全性」→「语音识别」\n`;
        helpText += `2. 确保已开启"语音识别"选项\n`;
        helpText += `3. 确保已勾选 Safari 浏览器\n`;
        helpText += `   （Chrome 不使用 Apple 语音服务，不会出现在此列表中）\n\n`;
        helpText += `4. 如果使用 Safari：\n`;
        helpText += `   Safari 菜单 → 设置（或偏好设置）→ 网站 → 语音识别\n`;
        helpText += `   确保已允许\n\n`;
        helpText += `5. 确保 Mac 已连接互联网（Safari 语音识别需要联网）\n\n`;
        helpText += `6. 如仍无法使用，请在系统设置中开启「键盘」→「听写」功能\n\n`;
        helpText += `7. 如果以上设置都正确但仍无法使用：\n`;
        helpText += `   建议使用 Edge 浏览器（macOS 版）\n`;
        helpText += `   Edge 的语音识别兼容性更好，Chrome 也可以正常使用\n\n`;
        helpText += `您也可以直接在文本框中输入课堂内容。`;
        alert(helpText);
    }

    // ========== 录音文件导入（语音转文字）==========

    async importAudioFile(file) {
        this._log('info', '导入录音文件', `name=${file.name},size=${(file.size/1024).toFixed(0)}KB`);
        const speechConfig = Storage.getSpeechConfig();
        if (speechConfig.provider === 'whisper') {
            await this._whisperProvider.importFile(file);
            return;
        }

        if (!this.hasSpeechApi) {
            UI.showToast('您的浏览器不支持语音识别，无法导入录音文件');
            return;
        }

        const progressEl = document.getElementById('audio-import-progress');
        const barEl = document.getElementById('audio-import-bar');
        const statusEl = document.getElementById('audio-import-status');

        if (progressEl) progressEl.style.display = 'block';
        if (statusEl) statusEl.textContent = '正在加载录音文件...';

        // 资源引用提升到 try 外，使 finally 能兜底清理（防止异常路径泄漏 AudioContext/ObjectURL）
        let audioContext = null;
        let audioUrl = null;
        let audioCtx2 = null;
        let audio = null;

        try {
            // 读取录音文件为 ArrayBuffer
            const arrayBuffer = await file.arrayBuffer();
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
            const duration = audioBuffer.duration;

            if (duration > 7200) {
                this._log('warn', '录音文件过长', `duration=${Math.floor(duration)}s`);
                UI.showToast('录音文件过长（超过2小时），请截取后重试');
                if (progressEl) progressEl.style.display = 'none';
                return;
            }

            if (statusEl) statusEl.textContent = `录音时长 ${Math.floor(duration/60)}分${Math.floor(duration%60)}秒，开始转换...`;

            // 获取当前文本框内容
            const textarea = document.getElementById('transcript');
            const existingText = textarea ? textarea.value.trim() : '';
            if (existingText) {
                this.accumulatedText = existingText + '\n';
            } else {
                this.accumulatedText = '';
            }
            this.finalTranscript = '';
            this.interimTranscript = '';
            this.lastFinalCount = 0;

            // 创建 audio 元素播放文件，通过扬声器输出让 SpeechRecognition 捕获
            // 注意：SpeechRecognition 只能识别麦克风输入，无法直接传入音频流
            // 所以需要通过扬声器播放，麦克风捕获回声来间接识别
            audioContext.close(); // 解码完成，关闭第一个 AudioContext
            audioContext = null; // 标记已关闭，finally 不再重复关闭
            audioUrl = URL.createObjectURL(file);
            audio = new Audio(audioUrl);

            // 创建第二个 AudioContext 用于播放控制
            audioCtx2 = new (window.AudioContext || window.webkitAudioContext)();
            const sourceNode = audioCtx2.createMediaElementSource(audio);
            sourceNode.connect(audioCtx2.destination); // 输出到扬声器

            // 创建新的 SpeechRecognition 实例用于文件导入
            const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
            const fileRecognition = new SpeechRecognition();
            fileRecognition.continuous = true;
            fileRecognition.interimResults = true;
            fileRecognition.lang = 'zh-CN';
            fileRecognition.maxAlternatives = 1;

            let fileTranscript = '';
            let isConverting = true;

            fileRecognition.onresult = (event) => {
                let text = '';
                for (let i = 0; i < event.results.length; i++) {
                    if (event.results[i].isFinal) {
                        text += event.results[i][0].transcript;
                    }
                }
                if (text) {
                    // text 已包含所有 final 结果的累积，直接替换而非追加
                    fileTranscript = text;
                    // 实时更新文本框
                    if (textarea) {
                        textarea.value = this.accumulatedText + fileTranscript;
                        textarea.scrollTop = textarea.scrollHeight;
                    }
                    if (statusEl) {
                        statusEl.textContent = `转换中... 已识别 ${fileTranscript.length} 字`;
                    }
                }
            };

            fileRecognition.onerror = (event) => {
                console.warn('[Recorder] 文件导入识别错误:', event.error);
                if (event.error === 'aborted') return;
                if (event.error !== 'no-speech') {
                    // 非致命错误，继续
                }
            };

            // 启动识别和播放
            this._importRecognition = fileRecognition;
            this._importAudio = audio;
            this._importAudioCtx = audioCtx2;
            await fileRecognition.start();
            audio.play();

            // 更新进度
            const updateProgress = () => {
                if (!isConverting) return;
                if (audio.duration && audio.currentTime) {
                    const pct = Math.min((audio.currentTime / audio.duration) * 100, 100);
                    if (barEl) barEl.style.width = pct + '%';
                    const mins = Math.floor(audio.currentTime / 60);
                    const secs = Math.floor(audio.currentTime % 60);
                    if (statusEl) {
                        statusEl.textContent = `转换中 ${mins}:${secs.toString().padStart(2,'0')} / ${Math.floor(audio.duration/60)}:${Math.floor(audio.duration%60).toString().padStart(2,'0')}（已识别 ${fileTranscript.length} 字）`;
                    }
                }
                requestAnimationFrame(updateProgress);
            };
            updateProgress();

            // 等待播放结束
            await new Promise((resolve) => {
                audio.onended = resolve;
                audio.onerror = resolve;
            });

            isConverting = false;
            try { await fileRecognition.stop(); } catch (e) {}

            // 完成处理：业务对象清理（资源释放统一交由 finally）
            this._importRecognition = null;
            this._importAudio = null;
            this._importAudioCtx = null;

            // 将结果写入文本框
            if (textarea) {
                this.accumulatedText = (textarea.value.trim() || this.accumulatedText + fileTranscript).trim();
                textarea.value = this.accumulatedText;
            }

            if (barEl) barEl.style.width = '100%';
            if (statusEl) statusEl.textContent = `转换完成！共识别 ${fileTranscript.length} 字`;
            UI.showToast(`录音导入完成，共识别 ${fileTranscript.length} 字`);

            setTimeout(() => {
                if (progressEl) progressEl.style.display = 'none';
                if (barEl) barEl.style.width = '0%';
            }, 3000);

        } catch (err) {
            this._log('error', '文件导入失败', err.message);
            console.error('[Recorder] 文件导入失败:', err);
            // 业务对象清理（资源释放统一交由 finally）
            if (this._importRecognition) {
                try { this._importRecognition.abort(); } catch(e) {}
                this._importRecognition = null;
            }
            if (this._importAudio) {
                try { this._importAudio.pause(); } catch(e) {}
                this._importAudio.src = '';
                this._importAudio = null;
            }
            if (this._importAudioCtx) {
                // 此处置 null，实际 close 由 finally 统一执行避免重复
                this._importAudioCtx = null;
            }
            UI.showToast('录音导入失败：' + (err.message || '不支持的音频格式'));
            if (progressEl) progressEl.style.display = 'none';
        } finally {
            // 统一兜底清理 AudioContext 和 ObjectURL，防止任何异常路径泄漏
            // （AudioContext 泄漏会耗尽浏览器单页实例上限导致音频功能不可用；
            //  ObjectURL 泄漏会持有 File 强引用阻止 GC，大文件耗尽内存）
            if (audioContext) {
                try { audioContext.close(); } catch(e) {}
                audioContext = null;
            }
            if (audioCtx2) {
                try { audioCtx2.close(); } catch(e) {}
                audioCtx2 = null;
            }
            if (audioUrl) {
                URL.revokeObjectURL(audioUrl);
                audioUrl = null;
            }
        }
    }

    // ========== Whisper 本地AI语音识别 ==========

    getProviderName(provider) {
        const names = { browser: '浏览器内置', whisper: '本地AI识别' };
        return names[provider] || provider;
    }

    // Whisper 状态字段与模型加载逻辑已移至 js/speech/whisperProvider.js
    // Recorder 通过 this._whisperProvider 调度，文本写入通过 _appendResult 回调

    /**
     * 预加载 Whisper 模型（代理到 WhisperProvider）
     */
    async preloadWhisper(onProgress) {
        return this._whisperProvider.preload(onProgress);
    }

    /**
     * 追加一段识别结果到文本框（供 Provider 通过 onResult 回调调用）
     * 文本写入逻辑统一在此，Provider 不直接操作 DOM
     */
    _appendResult(text) {
        if (!text) return;
        this.accumulatedText += text;
        this.updateDisplay();
        const textarea = document.getElementById('transcript');
        if (textarea) {
            textarea.value = this.accumulatedText;
            textarea.scrollTop = textarea.scrollHeight;
        }
    }

    stop() {
        this._log('info', '停止录音', `duration=${this.getRecordingDuration()}s,restarts=${this.restartCount}`);
        this.shouldRestart = false;
        this._userIntendsToRecord = false; // 清除用户意图录音标志
        this._manualStop = true; // 标记手动停止，防止 onresult/onend 重复写入
        this._isPaused = false; // 完全停止，清除暂停状态
        this._stopSilenceDetection();
        this._stopHealthCheck();
        // 清理 onstart 超时检测定时器
        if (this._startTimeout) {
            clearTimeout(this._startTimeout);
            this._startTimeout = null;
        }
        // 清理连接进度提示定时器
        if (this._connectingHintTimeout) {
            clearTimeout(this._connectingHintTimeout);
            this._connectingHintTimeout = null;
        }
        // 清理可能排队的重启定时器
        if (this._restartTimeout) {
            clearTimeout(this._restartTimeout);
            this._restartTimeout = null;
        }
        // 清理可能排队的强制重建定时器
        if (this._forcedRebuildTimeout) {
            clearTimeout(this._forcedRebuildTimeout);
            this._forcedRebuildTimeout = null;
        }
        // 清理可能正在进行的音频导入
        if (this._importRecognition) {
            try { this._importRecognition.abort(); } catch(e) {}
            this._importRecognition = null;
        }
        if (this._importAudio) {
            this._importAudio.pause();
            this._importAudio.src = '';
            this._importAudio = null;
        }
        if (this._importAudioCtx) {
            try { this._importAudioCtx.close(); } catch(e) {}
            this._importAudioCtx = null;
        }

        const speechConfig = Storage.getSpeechConfig();
        if (speechConfig.provider === 'whisper') {
            // Whisper 模式：立即停止音频采集和 UI，不等待 Worker 处理完 pending chunks
            // （pending chunks 的结果仍会通过 Provider 回调写入，但不再阻塞 stop）
            this._whisperProvider.stop();
            this.commitTranscript();
            this.stopTimer();

            const textarea = document.getElementById('transcript');
            if (textarea) {
                textarea.value = this.accumulatedText.trim();
                textarea.dispatchEvent(new Event('input', { bubbles: true }));
            }

            // 立即更新 UI（按钮 + 状态）
            UI.updateRecordButton(false);
            const statusEl = document.querySelector('.record-status');
            if (statusEl) statusEl.textContent = '点击开始录制课堂内容';
            const stopBtn = document.getElementById('btn-stop-record');
            if (stopBtn) stopBtn.style.display = 'none';

            // 同步停止课堂计时器并保存时长
            if (recordPage && typeof recordPage.stopClassTimer === 'function') {
                recordPage.stopClassTimer();
            }

            // 显示录音统计
            const stats = this.getRecordingStats();
            if (stats.duration > 10) {
                UI.showToast(`录音已停止（${stats.durationStr}，${stats.charCount}字）`);
            } else {
                UI.showToast('录音已停止');
            }

            // 完全停止：清空所有状态
            this.finalTranscript = '';
            this.interimTranscript = '';
            this.accumulatedText = '';
            this.sessionStartTime = null;
            this.restartCount = 0;
            this.segmentCount = 0;

            // 不 terminate Worker（保留 pipeline，下次录音直接用）
            return;
        }

        // 浏览器模式：原有的 SpeechRecognition 停止逻辑
        // 兜底停止 Whisper（防止 Whisper 资源残留）
        this._whisperProvider.stop();
        this.commitTranscript();
        this.stopTimer();

        // 停止语音识别（无论 isRecording 状态如何，都要确保停止）
        // 仅使用 abort()，避免 stop()+abort() 双重触发 onend
        if (this.recognition) {
            try { this.recognition.abort(); } catch (e) {}
            this._cleanupRecognition(this.recognition); // 打破闭包循环引用
        }

        // 停止后创建新的 recognition 实例，为下次录音准备
        // 避免旧实例在异常状态下被复用导致下次录音失败
        this.recognition = this._createRecognition();

        const textarea = document.getElementById('transcript');
        if (textarea) {
            textarea.value = this.accumulatedText.trim();
            // 触发 input 事件，确保字数统计和草稿自动保存同步
            textarea.dispatchEvent(new Event('input', { bubbles: true }));
        }

        // 同步停止课堂计时器并保存时长
        if (recordPage && typeof recordPage.stopClassTimer === 'function') {
            recordPage.stopClassTimer();
        }

        // 显示录音统计
        const stats = this.getRecordingStats();
        if (stats.duration > 10) {
            UI.showToast(`录音已停止（${stats.durationStr}，${stats.charCount}字）`);
        } else {
            UI.showToast('录音已停止');
        }

        // 完全停止：清空所有状态
        this.finalTranscript = '';
        this.interimTranscript = '';
        this.accumulatedText = '';
        this.sessionStartTime = null;
        this.restartCount = 0;
        this.segmentCount = 0;
        this.lastFinalCount = 0;
        this._resetDedupAnchors(); // 完全重置去重锚点
        this.isRecording = false;
    }

    toggle() {
        // 用 _userIntendsToRecord 而非 isRecording 判断用户是否在录音：
        // 重启循环期间 isRecording=false 但 _userIntendsToRecord=true，
        // 此时点击应走 pause()（停止当前会话），而非 start()（会重置时长/计数）
        if (this._userIntendsToRecord) {
            this.pause();
        } else {
            // 用 _isPaused 标志判断是否恢复（比 accumulatedText 更可靠）
            // stop() 会清空 _isPaused，pause() 会设置 _isPaused
            if (this._isPaused) {
                this.resume();
            } else {
                this.start();
            }
        }
    }

    // 暂停录音（保留已识别内容，可恢复）
    pause() {
        // 用 _userIntendsToRecord 判断：重启循环期间 isRecording=false 但用户仍在录音，应允许暂停
        if (!this._userIntendsToRecord) return;

        this._log('info', '暂停录音', `charCount=${(this.accumulatedText+this.finalTranscript).length}`);
        this.shouldRestart = false;
        this._userIntendsToRecord = false; // 暂停后停止健康检查和自动重启
        this._manualStop = true; // 标记手动停止，防止 onresult/onend 重复写入
        this._isPaused = true; // 标记暂停状态，toggle()据此判断是否应恢复
        this._stopSilenceDetection();
        this._stopHealthCheck();
        // 清理 onstart 超时检测定时器
        if (this._startTimeout) {
            clearTimeout(this._startTimeout);
            this._startTimeout = null;
        }
        // 清理连接进度提示定时器
        if (this._connectingHintTimeout) {
            clearTimeout(this._connectingHintTimeout);
            this._connectingHintTimeout = null;
        }

        // 清理可能排队的重启定时器
        if (this._restartTimeout) {
            clearTimeout(this._restartTimeout);
            this._restartTimeout = null;
        }
        // 清理可能排队的强制重建定时器
        if (this._forcedRebuildTimeout) {
            clearTimeout(this._forcedRebuildTimeout);
            this._forcedRebuildTimeout = null;
        }

        // 停止语音识别（但不清空内容）
        // 使用 abort() 立即终止，比 stop() 更快响应暂停
        // commitTranscript 已在下方调用，不会丢失文本
        if (this.recognition) {
            try { this.recognition.abort(); } catch (e) {}
            this._cleanupRecognition(this.recognition); // 打破闭包循环引用
        }
        // 暂停后创建新的 recognition 实例，为恢复录音准备
        this.recognition = this._createRecognition();
        
        // 停止 Whisper 识别（暂停模式，保留缓冲区）
        if (this._whisperProvider && this._whisperProvider.status === 'running') {
            this._whisperProvider.stop(false);
        }
        
        this.commitTranscript();
        this.stopTimer();
        
        // 立即更新文本框，确保显示正确（不依赖异步回调）
        const textarea = document.getElementById('transcript');
        if (textarea) {
            textarea.value = this.accumulatedText.trim();
        }
        
        // 记录已暂停的时长（Whisper恢复时需要）
        if (this.sessionStartTime) {
            this._whisperPausedDuration = Date.now() - this.sessionStartTime;
        }
        
        this.isRecording = false;
        
        // 同步暂停课堂计时器
        if (recordPage && typeof recordPage.pauseClassTimer === 'function') {
            recordPage.pauseClassTimer();
        }
        
        // 显示停止按钮
        const stopBtn = document.getElementById('btn-stop-record');
        if (stopBtn) stopBtn.style.display = 'inline-block';
        
        UI.updateRecordButton(false, true);
        UI.showToast('录音已暂停，点击继续');
    }

    // 恢复录音
    async resume() {
        if (this.isRecording) return;

        this._log('info', '恢复录音', `provider=${Storage.getSpeechConfig().provider}`);
        this._isPaused = false; // 清除暂停状态

        // 同步用户在暂停期间对文本框的编辑到 accumulatedText
        // 避免用户手动编辑文本框后恢复录音，编辑内容被覆盖丢失
        const textarea = document.getElementById('transcript');
        if (textarea) {
            this.accumulatedText = textarea.value.trim();
            if (this.accumulatedText) this.accumulatedText += '\n';
        }

        // 隐藏停止按钮
        const stopBtn = document.getElementById('btn-stop-record');
        if (stopBtn) stopBtn.style.display = 'none';

        // 同步恢复课堂计时器
        if (recordPage && typeof recordPage.startClassTimer === 'function') {
            recordPage.startClassTimer();
        }

        const speechConfig = Storage.getSpeechConfig();
        if (speechConfig.provider === 'whisper') {
            this.sessionStartTime = Date.now() - (this._whisperPausedDuration || 0);
            const started = await this._whisperProvider.start({
                onResult: (text) => this._appendResult(text),
                onError: (err) => this._log('error', 'Whisper识别错误', err.message)
            });
            if (started) {
                this.startTimer();
                this.isRecording = true;
                UI.updateRecordButton(true);
            } else {
                // Whisper 启动失败，重置暂停状态并提示用户
                this._isPaused = false;
                this._log('error', 'Whisper恢复录音失败');
                UI.showToast('恢复录音失败，请重试');
                UI.updateRecordButton(false);
            }
            return;
        }
        
        if (!this.hasSpeechApi) {
            UI.showToast('您的浏览器不支持语音识别');
            return;
        }
        
        // 恢复之前的计时（不重置sessionStartTime，扣除暂停时长）
        if (!this.sessionStartTime) {
            this.sessionStartTime = Date.now();
        } else if (this._whisperPausedDuration) {
            // 扣除暂停时长，确保录音时长不包含暂停时间
            this.sessionStartTime = Date.now() - this._whisperPausedDuration;
            this._whisperPausedDuration = 0;
        }
        
        this.finalTranscript = '';
        this.interimTranscript = '';
        this._manualStop = false; // 确保恢复录音不受残留标志影响
        this._userIntendsToRecord = true; // 恢复后启用健康检查和自动重启
        this.lastFinalCount = 0;
        this._resetDedupAnchors(); // 恢复录音，完全重置去重锚点
        this.lastResultTime = Date.now();
        this.shouldRestart = true;
        this.currentDelay = this.restartDelay;
        this._restartFailCount = 0;
        this._networkErrorCount = 0; // 恢复录音，重置网络错误计数
        this._isTransientError = false; // 恢复录音，重置瞬时错误标志
        this._healthCheckFailCount = 0; // 恢复录音，重置健康检查失败计数

        // 创建新的 recognition 实例，避免旧实例状态残留
        this.recognition = this._createRecognition();
        try {
            this.recognition.start();
            this._setStartTimeout(); // 设置 onstart 超时检测
            // 启动成功后开启健康检查
            this._startHealthCheck();
        } catch (err) {
            // start() 失败，通过 _scheduleRestart 持续重试
            this._log('warn', 'resume() recognition.start()失败', err.message);
            UI.showToast('正在恢复语音识别，请稍候...', 2000);
            this._scheduleRestart();
        }
    }

    // ========== 长按录音支持 ==========

    bindLongPressEvents() {
        const btn = document.getElementById('btn-record');
        if (!btn) return;

        // 先移除旧的事件监听器
        this._unbindLongPressEvents(btn);

        // 创建并缓存绑定后的处理器引用
        this._boundHandlers.touchstart = this._onTouchStart.bind(this);
        this._boundHandlers.touchend = this._onTouchEnd.bind(this);
        this._boundHandlers.touchcancel = this._onTouchCancel.bind(this);
        this._boundHandlers.touchmove = this._onTouchMove.bind(this);
        this._boundHandlers.mousedown = this._onMouseDown.bind(this);
        this._boundHandlers.mouseup = this._onMouseUp.bind(this);
        this._boundHandlers.mouseleave = this._onMouseLeave.bind(this);
        this._boundHandlers.contextmenu = (e) => e.preventDefault();

        // 触摸事件（手机端）
        btn.addEventListener('touchstart', this._boundHandlers.touchstart, { passive: false });
        btn.addEventListener('touchend', this._boundHandlers.touchend, { passive: false });
        btn.addEventListener('touchcancel', this._boundHandlers.touchcancel, { passive: false });
        btn.addEventListener('touchmove', this._boundHandlers.touchmove, { passive: false });

        // 鼠标事件（电脑端，包括 macOS）
        btn.addEventListener('mousedown', this._boundHandlers.mousedown);
        btn.addEventListener('mouseup', this._boundHandlers.mouseup);
        btn.addEventListener('mouseleave', this._boundHandlers.mouseleave);

        btn.addEventListener('contextmenu', this._boundHandlers.contextmenu);
    }

    _unbindLongPressEvents(btn) {
        if (!btn) btn = document.getElementById('btn-record');
        if (!btn) return;
        const h = this._boundHandlers;
        if (h.touchstart) btn.removeEventListener('touchstart', h.touchstart);
        if (h.touchend) btn.removeEventListener('touchend', h.touchend);
        if (h.touchcancel) btn.removeEventListener('touchcancel', h.touchcancel);
        if (h.touchmove) btn.removeEventListener('touchmove', h.touchmove);
        if (h.mousedown) btn.removeEventListener('mousedown', h.mousedown);
        if (h.mouseup) btn.removeEventListener('mouseup', h.mouseup);
        if (h.mouseleave) btn.removeEventListener('mouseleave', h.mouseleave);
        if (h.contextmenu) btn.removeEventListener('contextmenu', h.contextmenu);
    }

    _onTouchStart(e) {
        e.preventDefault();
        this.touchMoved = false;
        this.touchStartY = e.touches[0].clientY;
        this.isLongPress = false;

        this.longPressTimer = setTimeout(() => {
            this.isLongPress = true;
            this._startRecordingVisual();
        }, this.longPressThreshold);
    }

    _onTouchMove(e) {
        if (Math.abs(e.touches[0].clientY - this.touchStartY) > 20) {
            this.touchMoved = true;
            // 用 _userIntendsToRecord 而非 isRecording：重启循环期间 isRecording=false 但用户仍在长按录音，
            // 此时滑动应能取消（与 _onTouchEnd/_onMouseUp/_onTouchCancel/_onMouseLeave 行为一致）
            if (this.isLongPress && this._userIntendsToRecord) {
                this.stop();
                this._cancelLongPress();
            }
        }
    }

    _onTouchEnd(e) {
        e.preventDefault();
        if (this.isLongPress) {
            if (this._userIntendsToRecord) {
                this.stop();
            }
        } else {
            this._cancelLongPress();
            this.toggle();
        }
        this._resetLongPress();
    }

    _onTouchCancel(e) {
        this._cancelLongPress();
        if (this._userIntendsToRecord) {
            this.stop();
        }
        this._resetLongPress();
    }

    _onMouseDown(e) {
        if (e.button !== 0) return;
        this.isLongPress = false;
        this.longPressTimer = setTimeout(() => {
            this.isLongPress = true;
            this._startRecordingVisual();
        }, this.longPressThreshold);
    }

    _onMouseUp(e) {
        if (e.button !== 0) return;
        if (this.isLongPress) {
            if (this._userIntendsToRecord) {
                this.stop();
            }
        } else {
            this._cancelLongPress();
            this.toggle();
        }
        this._resetLongPress();
    }

    _onMouseLeave(e) {
        if (this.isLongPress && this._userIntendsToRecord) {
            this.stop();
        }
        this._cancelLongPress();
        this._resetLongPress();
    }

    _onClick(e) {
        e.preventDefault();
        e.stopPropagation();
    }

    _startRecordingVisual() {
        const btn = document.getElementById('btn-record');
        if (btn) {
            btn.classList.add('recording-active');
        }
        this.start();
    }

    _cancelLongPress() {
        if (this.longPressTimer) {
            clearTimeout(this.longPressTimer);
            this.longPressTimer = null;
        }
    }

    _resetLongPress() {
        this._cancelLongPress();
        this.isLongPress = false;
        this.touchMoved = false;
        const btn = document.getElementById('btn-record');
        if (btn) {
            btn.classList.remove('recording-active');
        }
    }
}

const recorder = new Recorder();
