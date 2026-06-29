// settingsPage.js - 设置页（包含科目管理、反馈模块设置、风格自定义）

class SettingsPage {
    constructor() {
        this.container = document.getElementById('settings-page');
        this.apiKeyValid = null;
    }

    render() {
        const apiKey = Storage.getApiKey();
        const style = Storage.getStyle();
        const speechConfig = Storage.getSpeechConfig();

        this.container.innerHTML = `
            <header>
                <button class="back-btn" onclick="app.navigate('students')" aria-label="返回学生管理">←</button>
                <h1>⚙️ 设置</h1>
            </header>

            <div class="settings-sections">
                <!-- API Key 设置 -->
                <section class="settings-group">
                    <h3 style="font-size:1.05rem;font-weight:700;">🔑 API Key</h3>
                    <div class="form-group">
                        <label for="api-key" class="sr-only">API Key</label>
                        <input type="password" id="api-key" name="api-key" placeholder="请输入您的 DeepSeek API Key…"
                               autocomplete="off"
                               aria-label="API Key"
                               value="${escapeHtml(apiKey) || ''}">
                        <div style="display:flex;gap:8px;margin-top:8px;">
                            <button type="button" id="btn-toggle-key" class="secondary-btn" style="font-size:0.8rem;padding:6px 10px;" aria-label="显示或隐藏 API Key">
                                👁️ 显示/隐藏
                            </button>
                            <button type="button" id="apikey-help" style="background:none;border:none;color:var(--primary);font-size:0.8rem;text-decoration:none;font-weight:500;align-self:center;cursor:pointer;padding:0;font:inherit;" aria-label="如何获取 API Key">
                                ❓ 如何获取？
                            </button>
                        </div>
                        <div id="api-key-status" aria-live="polite" aria-atomic="true"></div>
                        <details class="advanced-settings" style="margin-top:10px;">
                            <summary style="font-size:0.85rem;color:var(--text-muted);cursor:pointer;">高级设置</summary>
                            <div class="advanced-content" style="margin-top:8px;">
                                <label for="api-base-url" style="font-size:0.85rem;display:block;margin-bottom:4px;">API 基础地址（可选）</label>
                                <input type="text" id="api-base-url" name="api-base-url" placeholder="https://api.deepseek.com"
                                       autocomplete="off"
                                       aria-label="API 基础地址"
                                       value="${escapeHtml(Storage.getApiBaseUrl()) || ''}" style="font-size:0.9rem;padding:8px;">
                                <p class="hint-text" style="font-size:0.75rem;margin-top:4px;">使用 DeepSeek 可留空；使用兼容接口请填写完整地址</p>
                            </div>
                        </details>
                    </div>
                </section>

                <!-- 语音识别设置 -->
                <section class="settings-group">
                    <h3 style="font-size:1.05rem;font-weight:700;">🎤 语音识别</h3>
                    <div class="form-group">
                        <div class="speech-provider-list">
                            <label class="style-option ${speechConfig.provider === 'auto' ? 'active' : ''}">
                                <input type="radio" name="speech-provider" value="auto" ${speechConfig.provider === 'auto' ? 'checked' : ''}>
                                <span class="style-icon">⚡</span>
                                <span class="style-name">智能选择</span>
                                <span class="style-desc">自动降级，推荐</span>
                            </label>
                            <label class="style-option ${speechConfig.provider === 'sherpa' ? 'active' : ''}">
                                <input type="radio" name="speech-provider" value="sherpa" ${speechConfig.provider === 'sherpa' ? 'checked' : ''}>
                                <span class="style-icon">🎯</span>
                                <span class="style-name">Sherpa</span>
                                <span class="style-desc">最准，需COOP/COEP</span>
                            </label>
                            <label class="style-option ${speechConfig.provider === 'vosk' ? 'active' : ''}">
                                <input type="radio" name="speech-provider" value="vosk" ${speechConfig.provider === 'vosk' ? 'checked' : ''}>
                                <span class="style-icon">🎙️</span>
                                <span class="style-name">Vosk</span>
                                <span class="style-desc">流式实时，43MB</span>
                            </label>
                            <label class="style-option ${speechConfig.provider === 'whisper' ? 'active' : ''}">
                                <input type="radio" name="speech-provider" value="whisper" ${speechConfig.provider === 'whisper' ? 'checked' : ''}>
                                <span class="style-icon">🤖</span>
                                <span class="style-name">Whisper</span>
                                <span class="style-desc">离线，99+语言，40MB</span>
                            </label>
                            <label class="style-option ${speechConfig.provider === 'browser' ? 'active' : ''}">
                                <input type="radio" name="speech-provider" value="browser" ${speechConfig.provider === 'browser' ? 'checked' : ''}>
                                <span class="style-icon">🌐</span>
                                <span class="style-name">浏览器内置</span>
                                <span class="style-desc">免费，需联网</span>
                            </label>
                        </div>
                    </div>
                    <div id="speech-config-fields" style="margin-top:10px;">
                        ${this.renderSpeechConfigFields(speechConfig)}
                    </div>
                </section>

                <!-- 反馈风格设置 -->
                <section class="settings-group">
                    <h3 style="font-size:1.05rem;font-weight:700;">🎨 反馈风格</h3>
                    <div class="form-group">
                        <label style="font-size:0.85rem;color:var(--text-muted);margin-bottom:8px;">语气风格</label>
                        <div class="style-options">
                            <label class="style-option ${style.tone === 'friendly' ? 'active' : ''}">
                                <input type="radio" name="tone" value="friendly" ${style.tone === 'friendly' ? 'checked' : ''}>
                                <span class="style-icon">😊</span>
                                <span class="style-name">亲切</span>
                            </label>
                            <label class="style-option ${style.tone === 'formal' ? 'active' : ''}">
                                <input type="radio" name="tone" value="formal" ${style.tone === 'formal' ? 'checked' : ''}>
                                <span class="style-icon">👔</span>
                                <span class="style-name">正式</span>
                            </label>
                            <label class="style-option ${style.tone === 'concise' ? 'active' : ''}">
                                <input type="radio" name="tone" value="concise" ${style.tone === 'concise' ? 'checked' : ''}>
                                <span class="style-icon">⚡</span>
                                <span class="style-name">简洁</span>
                            </label>
                            <label class="style-option ${style.tone === 'detailed' ? 'active' : ''}">
                                <input type="radio" name="tone" value="detailed" ${style.tone === 'detailed' ? 'checked' : ''}>
                                <span class="style-icon">📝</span>
                                <span class="style-name">详细</span>
                            </label>
                            <label class="style-option ${style.tone === 'humorous' ? 'active' : ''}">
                                <input type="radio" name="tone" value="humorous" ${style.tone === 'humorous' ? 'checked' : ''}>
                                <span class="style-icon">😄</span>
                                <span class="style-name">幽默</span>
                            </label>
                            <label class="style-option ${style.tone === 'encouraging' ? 'active' : ''}">
                                <input type="radio" name="tone" value="encouraging" ${style.tone === 'encouraging' ? 'checked' : ''}>
                                <span class="style-icon">💪</span>
                                <span class="style-name">鼓励</span>
                            </label>
                        </div>
                    </div>

                    <!-- 从原"更多设置"移出的开关 -->
                    <div class="form-group compact" style="margin-top:12px;">
                        <label class="toggle-label">
                            <input type="checkbox" id="use-bullet-points" ${style.useBulletPoints ? 'checked' : ''}>
                            <span class="toggle-switch"></span>
                            <span>允许分点输出</span>
                        </label>
                    </div>

                    <div class="form-group compact" style="margin-top:8px;">
                        <label class="toggle-label">
                            <input type="checkbox" id="use-emoji" ${style.useEmoji ? 'checked' : ''}>
                            <span class="toggle-switch"></span>
                            <span>使用 Emoji 表情</span>
                        </label>
                    </div>
                    <div class="form-group emoji-position-group compact" style="margin-left:32px;${style.useEmoji ? '' : 'display:none;'}">
                        <label style="font-size:0.8rem;color:var(--text-muted);">Emoji 位置</label>
                        <div class="style-options" style="margin-top:6px;">
                            <label class="style-option ${style.emojiPosition === 'content' ? 'active' : ''}" style="padding:6px 10px;">
                                <input type="radio" name="emoji-position" value="content" ${style.emojiPosition === 'content' ? 'checked' : ''}>
                                <span class="style-name" style="font-size:0.8rem;">融入内容</span>
                            </label>
                            <label class="style-option ${style.emojiPosition === 'title' ? 'active' : ''}" style="padding:6px 10px;">
                                <input type="radio" name="emoji-position" value="title" ${style.emojiPosition === 'title' ? 'checked' : ''}>
                                <span class="style-name" style="font-size:0.8rem;">标题后</span>
                            </label>
                            <label class="style-option ${style.emojiPosition === 'end' ? 'active' : ''}" style="padding:6px 10px;">
                                <input type="radio" name="emoji-position" value="end" ${style.emojiPosition === 'end' ? 'checked' : ''}>
                                <span class="style-name" style="font-size:0.8rem;">模块末尾</span>
                            </label>
                        </div>
                    </div>

                    <div class="form-group compact" style="margin-top:8px;">
                        <label class="toggle-label">
                            <input type="checkbox" id="name-shorten" ${style.nameShorten !== false ? 'checked' : ''}>
                            <span class="toggle-switch"></span>
                            <span>姓名截取（三字名取后两字）</span>
                        </label>
                    </div>

                    <div class="form-group compact" style="margin-top:8px;">
                        <label class="toggle-label">
                            <input type="checkbox" id="strict-input" ${style.strictInput !== false ? 'checked' : ''}>
                            <span class="toggle-switch"></span>
                            <span>严格遵循输入内容（不编造）</span>
                        </label>
                    </div>

                    <div class="form-group compact" style="margin-top:8px;">
                        <label class="toggle-label">
                            <input type="checkbox" id="include-parent-help" ${style.includeParentHelp ? 'checked' : ''}>
                            <span class="toggle-switch"></span>
                            <span>包含"请家长协助"内容</span>
                        </label>
                    </div>

                    <div class="form-group compact" style="margin-top:8px;">
                        <label class="toggle-label">
                            <input type="checkbox" id="use-custom-date" name="use-custom-date" ${style.useCustomDate ? 'checked' : ''}>
                            <span class="toggle-switch" aria-hidden="true"></span>
                            <span>使用自定义日期</span>
                        </label>
                        <div class="custom-date-input" style="margin-top:6px;${style.useCustomDate ? '' : 'display:none;'}">
                            <label for="custom-date" class="sr-only">自定义日期</label>
                            <input type="date" id="custom-date" name="custom-date" aria-label="自定义日期" value="${style.customDate || ''}">
                        </div>
                    </div>

                    <!-- 按模块字数 -->
                    <div class="form-group compact" style="margin-top:12px;">
                        <label style="font-size:0.85rem;">按模块字数</label>
                        <div id="module-lengths-list" class="module-lengths-list" style="margin-top:6px;">
                            ${this.renderModuleLengthsList(style)}
                        </div>
                    </div>
                </section>

                <!-- 科目管理 -->
                <section class="settings-group">
                    <h3 style="font-size:1.05rem;font-weight:700;">📚 科目管理</h3>
                    <div id="subjects-list" class="subjects-manage-list">
                        ${this.renderSubjectsList()}
                    </div>
                    <button id="btn-add-subject" class="secondary-btn" style="margin-top:10px;">+ 添加科目</button>
                </section>

                <!-- Prompt 模板库 -->
                <section class="settings-group">
                    <h3 style="font-size:1.05rem;font-weight:700;">📋 Prompt 模板库</h3>
                    <p class="hint-text" style="margin-top:4px;margin-bottom:6px;">保存和管理可复用的 Prompt 模板，在生成反馈时快速应用</p>
                    <p class="hint-text" style="margin-top:4px;margin-bottom:10px;">提示：可在录音页面通过「选择模板」快速应用模板，或使用下方「临时备注」添加一次性要求</p>
                    <div style="display:flex;gap:8px;margin-bottom:12px;">
                        <button id="btn-add-prompt-template" class="secondary-btn" style="flex:1;">+ 新建模板</button>
                    </div>
                    <div id="prompt-templates-list">
                        ${this.renderPromptTemplatesList()}
                    </div>

                    <!-- 临时备注 -->
                    <div class="form-group" style="margin-top:16px;">
                        <label for="custom-prompt" style="font-size:0.85rem;display:block;margin-bottom:4px;">临时备注（每次生成反馈时追加）</label>
                        <textarea id="custom-prompt" name="custom-prompt" placeholder="例如：本次课特别强调计算准确性…"
                            aria-label="临时备注，每次生成反馈时追加"
                            style="width:100%;min-height:60px;padding:10px;border:2px solid var(--border);border-radius:var(--radius-sm);font-size:0.9rem;font-family:inherit;resize:vertical;margin-top:4px;">${style.customPrompt || ''}</textarea>
                    </div>

                    <!-- 科目专属设置 -->
                    <div style="margin-top:16px;">
                        <label style="font-size:0.9rem;font-weight:600;">科目专属设置</label>
                        <div id="subject-templates-list" style="margin-top:8px;">
                            ${this.renderSubjectSettingsList()}
                        </div>
                    </div>
                </section>

                <!-- 反馈模块设置 -->
                <section class="settings-group">
                    <h3 style="font-size:1.05rem;font-weight:700;">📋 反馈模块</h3>
                    <div id="modules-list" class="modules-manage-list">
                        ${this.renderModulesList()}
                    </div>
                    <button id="btn-add-module" class="secondary-btn" style="margin-top:10px;">+ 添加自定义模块</button>
                </section>

                <!-- 主题设置 -->
                <section class="settings-group">
                    <h3 style="font-size:1.05rem;font-weight:700;">🎨 界面主题</h3>
                    <div class="theme-selector" id="theme-selector">
                        <button class="theme-option ${Storage.getTheme() === 'default' ? 'active' : ''}" data-theme="default">
                            <span class="theme-dot" style="background: linear-gradient(135deg, #6366F1, #8B5CF6);"></span>
                            <span>默认紫</span>
                        </button>
                        <button class="theme-option ${Storage.getTheme() === 'warm' ? 'active' : ''}" data-theme="warm">
                            <span class="theme-dot" style="background: linear-gradient(135deg, #D97706, #F59E0B);"></span>
                            <span>温暖橙</span>
                        </button>
                        <button class="theme-option ${Storage.getTheme() === 'green' ? 'active' : ''}" data-theme="green">
                            <span class="theme-dot" style="background: linear-gradient(135deg, #059669, #10B981);"></span>
                            <span>清新绿</span>
                        </button>
                        <button class="theme-option ${Storage.getTheme() === 'dark' ? 'active' : ''}" data-theme="dark">
                            <span class="theme-dot" style="background: linear-gradient(135deg, #1E293B, #334155);"></span>
                            <span>深色</span>
                        </button>
                    </div>
                </section>

                <!-- 录音日志 -->
                <section class="settings-group">
                    <h3 style="font-size:1.05rem;font-weight:700;">📋 录音日志</h3>
                    <p class="hint-text" style="margin-top:4px;margin-bottom:10px;">查看录音过程中的运行日志，便于排查问题</p>
                    <div style="display:flex;gap:8px;flex-wrap:wrap;">
                        <button id="btn-view-logs" class="secondary-btn" style="flex:1;min-width:120px;">🔍 查看日志</button>
                        <button id="btn-export-logs" class="secondary-btn" style="flex:1;min-width:120px;">📤 导出日志</button>
                        <button id="btn-clear-logs" class="danger-btn" style="flex:1;min-width:120px;">🗑️ 清空日志</button>
                    </div>
                </section>

                <!-- 数据管理 -->
                <section class="settings-group">
                    <h3 style="font-size:1.05rem;font-weight:700;">💾 数据管理</h3>
                    ${this._renderBackupStatus()}
                    <div style="display:flex;gap:8px;flex-wrap:wrap;">
                        <button id="btn-export" class="secondary-btn" style="flex:1;min-width:120px;">📤 导出</button>
                        <button id="btn-import" class="secondary-btn" style="flex:1;min-width:120px;">📥 导入</button>
                        <input type="file" id="import-file" accept=".json" style="display:none">
                    </div>
                    <button id="btn-clear-all" class="danger-btn" style="margin-top:10px;width:100%;">🗑️ 清空所有数据</button>
                </section>

                <p class="hint-text" style="text-align:center;margin-top:8px;font-size:0.75rem;">
                    课堂反馈助手 v1.9 · 纯前端应用，数据保存在本地
                </p>
            </div>
        `;

        this.bindEvents();
        this.checkApiKey();
    }

    renderModuleLengthsList(style) {
        const modules = Storage.getModules();
        const lengths = style.moduleLengths || {};

        return modules.map((m, i) => {
            const len = lengths[m.name] || { min: 50, max: 150 };
            return `
                <div class="module-length-item" style="display:flex;gap:8px;align-items:center;margin-bottom:8px;padding:8px;background:var(--bg);border-radius:var(--radius-sm);">
                    <span style="min-width:80px;font-size:0.9rem;">${escapeHtml(m.name)}</span>
                    <div style="display:flex;gap:8px;flex:1;align-items:center;">
                        <label for="module-min-${i}" class="sr-only">${escapeHtml(m.name)} 最小字数</label>
                        <input type="number" id="module-min-${i}" class="module-min-length" data-module="${escapeHtml(m.name)}" value="${len.min}" min="10" max="1000" inputmode="numeric"
                            aria-label="${escapeHtml(m.name)} 最小字数"
                            style="flex:1;padding:6px;border:2px solid var(--border);border-radius:var(--radius-sm);font-size:0.85rem;">
                        <span style="color:var(--text-muted);font-size:0.85rem;" aria-hidden="true">-</span>
                        <label for="module-max-${i}" class="sr-only">${escapeHtml(m.name)} 最大字数</label>
                        <input type="number" id="module-max-${i}" class="module-max-length" data-module="${escapeHtml(m.name)}" value="${len.max}" min="50" max="5000" inputmode="numeric"
                            aria-label="${escapeHtml(m.name)} 最大字数"
                            style="flex:1;padding:6px;border:2px solid var(--border);border-radius:var(--radius-sm);font-size:0.85rem;">
                    </div>
                    <span style="font-size:0.75rem;color:var(--text-muted);" aria-hidden="true">字</span>
                </div>
            `;
        }).join('');
    }

    renderSpeechConfigFields(config) {
        if (config.provider === 'auto') {
            return `
                <div style="padding:12px;background:var(--bg);border-radius:var(--radius-sm);border:1px solid var(--border-light);">
                    <p class="hint-text" style="margin-bottom:8px;">
                        ⚡ <strong>智能选择</strong>（自动降级，推荐大多数用户）
                    </p>
                    <p class="hint-text" style="margin-bottom:6px;">
                        按优先级自动选择最优可用的本地引擎，都不支持时降级到浏览器内置：<br>
                        ① Sherpa-onnx（SenseVoice，50+语种，需 COOP/COEP 环境）<br>
                        ② Vosk（流式实时输出，模型约43MB）<br>
                        ③ Whisper（离线，99+语言，模型约40MB）<br>
                        ④ 浏览器内置（需联网）
                    </p>
                    <p class="hint-text" style="margin-bottom:0;">
                        ℹ️ GitHub Pages 默认不支持 Sherpa（无 COOP/COEP 头），将自动降级到 Vosk。
                        录音开始时控制台日志会显示实际选中的引擎。
                    </p>
                </div>
            `;
        }

        if (config.provider === 'browser') {
            return `<p class="hint-text">使用浏览器内置语音识别（Web Speech API），无需额外配置。推荐使用 Edge 浏览器获得最佳效果，Chrome 也可以正常使用。</p>`;
        }

        if (config.provider === 'sherpa') {
            return `
                <div style="padding:12px;background:var(--bg);border-radius:var(--radius-sm);border:1px solid var(--border-light);">
                    <p class="hint-text" style="margin-bottom:8px;">
                        🎯 <strong>Sherpa-onnx 语音识别</strong>（SenseVoice-Small，int8 量化）
                    </p>
                    <p class="hint-text" style="margin-bottom:6px;">
                        ✅ 50+语种，中文识别准确率最高<br>
                        ✅ 70ms/10s 音频推理，实时性好<br>
                        ✅ 内置 ITN 标点恢复，无需后处理<br>
                        ⚠️ 首次需下载 WASM(10MB) + 模型(229MB)，之后缓存<br>
                        ⚠️ 需要 Cross-Origin Isolated 环境（COOP/COEP 头）<br>
                        ⚠️ GitHub Pages 默认不支持，需部署到 HF Spaces / Cloudflare Pages
                    </p>
                    <div id="sherpa-model-status" style="margin-top:8px;padding:8px;background:var(--bg-secondary);border-radius:var(--radius-sm);font-size:0.85rem;color:var(--text-muted);">
                        模型状态：未加载
                    </div>
                    <button id="btn-preload-sherpa" class="secondary-btn" style="margin-top:8px;width:100%;">预加载 Sherpa 模型（首次使用建议提前下载）</button>
                </div>
            `;
        }

        if (config.provider === 'vosk') {
            return `
                <div style="padding:12px;background:var(--bg);border-radius:var(--radius-sm);border:1px solid var(--border-light);">
                    <p class="hint-text" style="margin-bottom:8px;">
                        🎙️ <strong>Vosk 语音识别</strong>（Kaldi WASM，离线运行）
                    </p>
                    <p class="hint-text" style="margin-bottom:6px;">
                        ✅ 流式实时输出，边说边出文字<br>
                        ✅ 模型小（约43MB），加载快<br>
                        ✅ 兼容性好，Safari 表现佳，无需 COOP/COEP<br>
                        ⚠️ 首次需加载库(5.8MB) + 模型(43MB)，之后缓存<br>
                        ⚠️ 中文识别准确率略低于 Sherpa/Whisper
                    </p>
                    <div id="vosk-model-status" style="margin-top:8px;padding:8px;background:var(--bg-secondary);border-radius:var(--radius-sm);font-size:0.85rem;color:var(--text-muted);">
                        模型状态：未加载
                    </div>
                    <button id="btn-preload-vosk" class="secondary-btn" style="margin-top:8px;width:100%;">预加载 Vosk 模型（首次使用建议提前下载）</button>
                </div>
            `;
        }

        if (config.provider === 'whisper') {
            return `
                <div style="padding:12px;background:var(--bg);border-radius:var(--radius-sm);border:1px solid var(--border-light);">
                    <p class="hint-text" style="margin-bottom:8px;">
                        🤖 <strong>本地AI语音识别</strong>（基于 OpenAI Whisper 模型）
                    </p>
                    <p class="hint-text" style="margin-bottom:6px;">
                        ✅ 完全离线运行，无需联网，隐私安全<br>
                        ✅ 支持99+语言，中文识别准确率高<br>
                        ⚠️ 首次使用需下载模型文件（约40MB），请耐心等待<br>
                        ⚠️ 推荐使用 Edge 浏览器，Chrome 也可以正常使用，设备性能越好识别越快
                    </p>
                    <div id="whisper-model-status" style="margin-top:8px;padding:8px;background:var(--bg-secondary);border-radius:var(--radius-sm);font-size:0.85rem;color:var(--text-muted);">
                        模型状态：未加载
                    </div>
                    <button id="btn-preload-whisper" class="secondary-btn" style="margin-top:8px;width:100%;">预加载模型（首次使用建议提前下载）</button>
                </div>
            `;
        }

        return `<p class="hint-text">请选择一个语音识别引擎</p>`;
    }

    /**
     * 绑定各引擎的预加载按钮
     * 由于 renderSpeechConfigFields 用 innerHTML 重新渲染，切换引擎后需重新绑定
     * 使用可选链 + recorder 存在性检查，避免 recorder 未初始化时报错
     */
    _bindPreloadButtons() {
        // 统一的预加载封装：按钮 disabled + 进度条渲染
        const setupPreload = (btnId, statusId, preloadFn, displayName) => {
            const btn = document.getElementById(btnId);
            if (!btn) return;
            btn.addEventListener('click', async () => {
                if (typeof recorder === 'undefined' || !preloadFn) return;
                // 按钮 disable + 文案
                const originalText = btn.textContent;
                btn.disabled = true;
                btn.textContent = '下载中…';
                // 准备进度条容器
                const statusEl = document.getElementById(statusId);
                let barEl = statusEl ? statusEl.querySelector('.preload-progress-bar') : null;
                if (statusEl && !barEl) {
                    barEl = document.createElement('div');
                    barEl.className = 'preload-progress-bar';
                    const fill = document.createElement('div');
                    fill.className = 'preload-progress-fill';
                    barEl.appendChild(fill);
                    statusEl.appendChild(barEl);
                }
                const onProgress = (p) => {
                    const pct = (p && typeof p.progress === 'number') ? Math.max(0, Math.min(100, Math.round(p.progress))) : 0;
                    const statusText = (p && p.status) ? p.status : '';
                    if (statusEl) {
                        const labelMap = { downloading: '下载中', ready: '已就绪' };
                        const label = labelMap[statusText] || statusText;
                        const txt = `模型状态：${label}${pct > 0 && statusText !== 'ready' ? ' ' + pct + '%' : ''}`;
                        // 保留进度条 DOM，只更新文案和填充宽度
                        if (barEl) {
                            // textContent 会清空子节点，所以先取走进度条再写文案再放回
                            barEl.remove();
                            statusEl.textContent = txt;
                            statusEl.appendChild(barEl);
                            const fill = barEl.querySelector('.preload-progress-fill');
                            if (fill) fill.style.width = (statusText === 'ready' ? 100 : pct) + '%';
                        } else {
                            statusEl.textContent = txt;
                        }
                    }
                };
                try {
                    await preloadFn.call(recorder, onProgress);
                } catch (err) {
                    UI.showToast(`${displayName} 模型加载失败：` + err.message);
                } finally {
                    btn.disabled = false;
                    btn.textContent = originalText;
                }
            });
        };

        setupPreload('btn-preload-whisper', 'whisper-model-status',
            recorder && recorder.preloadWhisper ? recorder.preloadWhisper.bind(recorder) : null, 'Whisper');
        setupPreload('btn-preload-vosk', 'vosk-model-status',
            recorder && recorder.preloadVosk ? recorder.preloadVosk.bind(recorder) : null, 'Vosk');
        setupPreload('btn-preload-sherpa', 'sherpa-model-status',
            recorder && recorder.preloadSherpa ? recorder.preloadSherpa.bind(recorder) : null, 'Sherpa');
    }

    renderSubjectsList() {
        const subjects = store.getSubjects();
        if (subjects.length === 0) {
            return '<p class="hint-text">暂无科目，请点击下方添加</p>';
        }
        return subjects.map((s, i) => `
            <div class="manage-item" data-id="${s.id}" data-type="subject">
                <div class="manage-item-info">
                    <span class="color-dot" style="background: ${escapeHtml(s.color)}"></span>
                    <span class="manage-item-name">${escapeHtml(s.name)}</span>
                </div>
                <div class="manage-item-actions">
                    <input type="color" class="color-picker" value="${escapeHtml(s.color)}" aria-label="科目颜色"
                           onchange="settingsPage.updateSubjectColor('${s.id}', this.value)">
                    <button class="delete-btn" onclick="settingsPage.deleteSubject('${s.id}')" aria-label="删除科目 ${escapeHtml(s.name)}">🗑️</button>
                </div>
            </div>
        `).join('');
    }

    renderModulesList() {
        const modules = Storage.getModules();
        return modules.map((m, i) => `
            <div class="manage-item" data-index="${i}" style="flex-direction:column;align-items:flex-start;gap:6px;">
                <div style="display:flex;align-items:center;gap:8px;width:100%;">
                    <input type="checkbox" ${m.enabled ? 'checked' : ''}
                           onchange="settingsPage.toggleModule(${i})">
                    <span class="manage-item-name">${escapeHtml(m.name)}</span>
                    <div style="margin-left:auto;display:flex;gap:2px;">
                        <button class="sort-btn" onclick="settingsPage.moveModule(${i}, -1)" ${i === 0 ? 'disabled style="opacity:0.3;cursor:default;"' : ''} title="上移" aria-label="上移模块 ${escapeHtml(m.name)}">↑</button>
                        <button class="sort-btn" onclick="settingsPage.moveModule(${i}, 1)" ${i === modules.length - 1 ? 'disabled style="opacity:0.3;cursor:default;"' : ''} title="下移" aria-label="下移模块 ${escapeHtml(m.name)}">↓</button>
                        ${m.custom ? `<button class="delete-btn" onclick="settingsPage.deleteModule(${i})" aria-label="删除模块 ${escapeHtml(m.name)}">🗑️</button>` : ''}
                    </div>
                </div>
                ${m.custom ? `
                <input type="text" class="module-desc-input" data-module-index="${i}"
                       placeholder="描述该模块应生成什么内容（如：针对家长的配合建议）"
                       value="${escapeHtml(m.description || '')}"
                       style="width:100%;padding:6px 10px;border:1px solid var(--border);border-radius:var(--radius-sm);font-size:0.8rem;margin-left:28px;">
                ` : ''}
            </div>
        `).join('');
    }

    /** 科目专属设置列表（替代原 renderSubjectTemplatesList） */
    renderSubjectSettingsList() {
        const subjects = store.getSubjects();
        if (subjects.length === 0) {
            return '<p class="hint-text" style="margin-top:4px;">暂无科目，请先添加科目</p>';
        }
        return subjects.map(s => {
            const template = store.getSubjectTemplate(s.id);
            const hasTemplate = template && template.prompt;
            return `
                <div class="manage-item" style="display:flex;align-items:center;gap:10px;padding:10px 0;">
                    <span class="color-dot" style="background:${escapeHtml(s.color)};width:12px;height:12px;"></span>
                    <span class="manage-item-name" style="flex:1;">${escapeHtml(s.name)}</span>
                    ${hasTemplate
                        ? '<span style="font-size:0.75rem;color:var(--success);background:rgba(16,185,129,0.1);padding:2px 8px;border-radius:10px;">已配置</span>'
                        : '<span style="font-size:0.75rem;color:var(--text-muted);background:var(--bg);padding:2px 8px;border-radius:10px;">未配置</span>'}
                    <button class="text-btn subject-edit-btn" data-subject-id="${s.id}" style="font-size:0.8rem;">编辑</button>
                    <button class="text-btn subject-apply-template-btn" data-subject-id="${s.id}" style="font-size:0.8rem;color:var(--primary);">从模板应用</button>
                </div>
            `;
        }).join('');
    }

    /** 编辑科目专属模板（底部弹窗） */
    showSubjectTemplateEditor(subjectId) {
        const subject = store.getSubjectById(subjectId);
        if (!subject) return;
        const existing = store.getSubjectTemplate(subjectId);
        const currentPrompt = existing && existing.prompt ? existing.prompt : '';

        UI.showBottomSheet(`
            <div class="bottom-sheet-header">
                <h3>编辑科目模板 - ${escapeHtml(subject.name)}</h3>
            </div>
            <div class="form-section">
                <div class="form-group">
                    <label>科目专属 Prompt</label>
                    <textarea id="subject-template-editor" placeholder="例如：数学科目需要强调解题思路、公式推导过程、计算准确性等..."
                        style="width:100%;min-height:120px;padding:10px;border:2px solid var(--border);border-radius:var(--radius-sm);font-size:0.9rem;font-family:inherit;resize:vertical;margin-top:4px;">${escapeHtml(currentPrompt)}</textarea>
                </div>
                <div style="display:flex;gap:10px;">
                    <button id="btn-st-cancel" class="secondary-btn" style="flex:1;">取消</button>
                    <button id="btn-st-save" class="primary-btn" style="flex:1;">保存</button>
                    ${currentPrompt ? '<button id="btn-st-clear" class="danger-btn" style="flex:1;">清空模板</button>' : ''}
                </div>
            </div>
        `);

        requestAnimationFrame(() => {
            document.getElementById('btn-st-cancel')?.addEventListener('click', () => {
                UI.closeBottomSheet();
            });

            document.getElementById('btn-st-save')?.addEventListener('click', () => {
                const prompt = document.getElementById('subject-template-editor')?.value.trim();
                if (prompt) {
                    store.setSubjectTemplate(subjectId, { prompt, updatedAt: new Date().toISOString() });
                    UI.showToast('科目模板已保存');
                } else {
                    store.deleteSubjectTemplate(subjectId);
                    UI.showToast('科目模板已清空');
                }
                UI.closeBottomSheet();
                this.render();
            });

            document.getElementById('btn-st-clear')?.addEventListener('click', () => {
                store.deleteSubjectTemplate(subjectId);
                UI.showToast('科目模板已清空');
                UI.closeBottomSheet();
                this.render();
            });
        });
    }

    /** 从模板库选择模板应用到指定科目 */
    showApplyTemplateToSubjectPicker(subjectId) {
        const subject = store.getSubjectById(subjectId);
        if (!subject) return;
        const templates = store.getPromptTemplates();

        if (templates.length === 0) {
            UI.showToast('暂无模板，请先创建模板');
            return;
        }

        UI.showBottomSheet(`
            <div class="bottom-sheet-header">
                <h3>选择模板应用到 ${escapeHtml(subject.name)}</h3>
            </div>
            <p style="font-size:0.85rem;color:var(--text-muted);margin-bottom:12px;">选择一个模板，其 Prompt 将追加到该科目的专属模板中</p>
            <div class="template-apply-list">
                ${templates.map(t => `
                    <button type="button" class="template-apply-item" data-template-id="${escapeHtml(t.id)}" style="display:flex;align-items:center;gap:10px;padding:12px;border:1.5px solid var(--border);border-radius:var(--radius-sm);margin-bottom:8px;cursor:pointer;transition:background 0.15s;background:var(--surface);width:100%;text-align:left;font:inherit;color:inherit;" aria-label="应用模板 ${escapeHtml(t.name)}">
                        <span style="flex:1;">
                            <span style="font-weight:500;">${escapeHtml(t.name)}</span>
                            <span style="font-size:0.75rem;color:var(--text-muted);margin-left:6px;">${escapeHtml(t.category)}</span>
                        </span>
                    </button>
                `).join('')}
            </div>
        `);

        requestAnimationFrame(() => {
            document.querySelectorAll('.template-apply-item').forEach(el => {
                el.addEventListener('click', () => {
                    const templateId = el.dataset.templateId;
                    const template = store.getPromptTemplateById(templateId);
                    if (!template) return;

                    const existing = store.getSubjectTemplate(subjectId);
                    const existingPrompt = existing && existing.prompt ? existing.prompt : '';
                    const newPrompt = existingPrompt
                        ? existingPrompt + '\n\n' + template.prompt
                        : template.prompt;

                    store.setSubjectTemplate(subjectId, { prompt: newPrompt, updatedAt: new Date().toISOString() });
                    UI.closeBottomSheet();
                    UI.showToast(`已将「${template.name}」应用到 ${subject.name}`);
                    this.render();
                });
                el.addEventListener('mouseenter', () => {
                    el.style.background = 'var(--primary-soft)';
                });
                el.addEventListener('mouseleave', () => {
                    el.style.background = '';
                });
            });
        });
    }

    renderPromptTemplatesList() {
        const templates = store.getPromptTemplates();
        if (templates.length === 0) {
            return '<p class="hint-text" style="margin-top:4px;">暂无模板，点击上方新建</p>';
        }
        // 按分类分组
        const categories = [...new Set(templates.map(t => t.category))];
        return categories.map(cat => {
            const catTemplates = templates.filter(t => t.category === cat);
            return `
                <details class="settings-collapsible" open style="margin-bottom:10px;">
                    <summary style="font-size:0.9rem;font-weight:600;">${escapeHtml(cat)} <span style="font-size:0.8rem;color:var(--text-muted);font-weight:normal;">(${catTemplates.length})</span></summary>
                    <div class="collapsible-content" style="padding-top:8px;">
                        ${catTemplates.map(t => this._renderPromptTemplateCard(t)).join('')}
                    </div>
                </details>
            `;
        }).join('');
    }

    _renderPromptTemplateCard(t) {
        const preview = t.prompt.length > 80 ? t.prompt.substring(0, 80) + '...' : t.prompt;
        return `
            <div class="prompt-template-card" data-template-id="${escapeHtml(t.id)}" style="padding:12px;border:1.5px solid var(--border);border-radius:var(--radius-sm);margin-bottom:8px;background:var(--bg);">
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
                    <span style="font-weight:600;font-size:0.9rem;color:var(--text);">${escapeHtml(t.name)}</span>
                    ${t.isDefault ? '<span style="font-size:0.7rem;color:var(--primary);background:var(--primary-soft);padding:1px 6px;border-radius:8px;">预置</span>' : ''}
                </div>
                ${t.description ? `<p style="font-size:0.8rem;color:var(--text-muted);margin-bottom:4px;">${escapeHtml(t.description)}</p>` : ''}
                <p style="font-size:0.8rem;color:var(--text-secondary);line-height:1.5;margin-bottom:8px;">${escapeHtml(preview)}</p>
                <div style="display:flex;gap:6px;flex-wrap:wrap;">
                    <button class="text-btn prompt-apply-btn" data-template-id="${escapeHtml(t.id)}" title="应用到科目">应用到科目</button>
                    <button class="text-btn prompt-edit-btn" data-template-id="${escapeHtml(t.id)}">编辑</button>
                    <button class="text-btn prompt-copy-btn" data-template-id="${escapeHtml(t.id)}" style="color:var(--text-secondary);">复制</button>
                    ${!t.isDefault ? `<button class="text-btn prompt-delete-btn" data-template-id="${escapeHtml(t.id)}" style="color:var(--danger);">删除</button>` : ''}
                </div>
            </div>
        `;
    }

    showPromptTemplateForm(template = null) {
        const isEdit = !!template;
        const title = isEdit ? '编辑模板' : '新建模板';
        const categories = ['反馈风格', '家长沟通', '问题导向', '学科特色'];

        UI.showBottomSheet(`
            <div class="bottom-sheet-header">
                <h3>${title}</h3>
            </div>
            <div class="form-section">
                <div class="form-group">
                    <label>模板名称 <span style="color:var(--danger);">*</span></label>
                    <input type="text" id="pt-name" placeholder="例如：表扬鼓励型" value="${isEdit ? escapeHtml(template.name) : ''}" style="width:100%;padding:12px;border:2px solid var(--border);border-radius:var(--radius-sm);font-size:1rem;">
                </div>
                <div class="form-group">
                    <label>描述</label>
                    <input type="text" id="pt-description" placeholder="简要描述模板用途" value="${isEdit ? escapeHtml(template.description || '') : ''}" style="width:100%;padding:12px;border:2px solid var(--border);border-radius:var(--radius-sm);font-size:1rem;">
                </div>
                <div class="form-group">
                    <label>分类</label>
                    <select id="pt-category" style="width:100%;padding:12px;border:2px solid var(--border);border-radius:var(--radius-sm);font-size:1rem;background:var(--surface);color:var(--text);appearance:none;">
                        ${categories.map(c => `<option value="${c}" ${isEdit && template.category === c ? 'selected' : ''}>${c}</option>`).join('')}
                    </select>
                </div>
                <div class="form-group">
                    <label>Prompt 内容 <span style="color:var(--danger);">*</span></label>
                    <textarea id="pt-prompt" placeholder="请输入模板的 Prompt 内容..." style="width:100%;min-height:120px;padding:10px;border:2px solid var(--border);border-radius:var(--radius-sm);font-size:0.9rem;font-family:inherit;resize:vertical;">${isEdit ? escapeHtml(template.prompt) : ''}</textarea>
                </div>
                <div style="display:flex;gap:10px;">
                    <button id="btn-pt-cancel" class="secondary-btn" style="flex:1;">取消</button>
                    <button id="btn-pt-save" class="primary-btn" style="flex:1;">保存</button>
                </div>
            </div>
        `);

        requestAnimationFrame(() => {
            document.getElementById('btn-pt-cancel')?.addEventListener('click', () => {
                UI.closeBottomSheet();
            });

            document.getElementById('btn-pt-save')?.addEventListener('click', () => {
                const name = document.getElementById('pt-name')?.value.trim();
                const description = document.getElementById('pt-description')?.value.trim();
                const category = document.getElementById('pt-category')?.value;
                const prompt = document.getElementById('pt-prompt')?.value.trim();

                if (!name) {
                    UI.showToast('请输入模板名称');
                    return;
                }
                if (!prompt) {
                    UI.showToast('请输入 Prompt 内容');
                    return;
                }

                if (isEdit) {
                    store.updatePromptTemplate(template.id, { name, description, category, prompt });
                    UI.showToast('模板已更新');
                } else {
                    store.addPromptTemplate({ name, description, category, prompt });
                    UI.showToast('模板已创建');
                }
                UI.closeBottomSheet();
                this.render();
            });
        });
    }

    showApplyTemplateToSubject(templateId) {
        const subjects = store.getSubjects();
        const template = store.getPromptTemplateById(templateId);
        if (!template) return;

        if (subjects.length === 0) {
            UI.showToast('暂无科目，请先添加科目');
            return;
        }

        UI.showBottomSheet(`
            <div class="bottom-sheet-header">
                <h3>应用模板到科目</h3>
            </div>
            <p style="font-size:0.85rem;color:var(--text-muted);margin-bottom:12px;">将「${escapeHtml(template.name)}」的 Prompt 追加到指定科目的专属模板中</p>
            <div class="subject-apply-list">
                ${subjects.map(s => {
                    const existing = store.getSubjectTemplate(s.id);
                    return `
                        <button type="button" class="subject-apply-item" data-subject-id="${escapeHtml(s.id)}" style="display:flex;align-items:center;gap:10px;padding:12px;border:1.5px solid var(--border);border-radius:var(--radius-sm);margin-bottom:8px;cursor:pointer;transition:background 0.15s;background:var(--surface);width:100%;text-align:left;font:inherit;color:inherit;" aria-label="为科目 ${escapeHtml(s.name)} 选择模板">
                            <span class="color-dot" style="background:${escapeHtml(s.color)};" aria-hidden="true"></span>
                            <span style="flex:1;font-weight:500;">${escapeHtml(s.name)}</span>
                            ${existing && existing.prompt ? '<span style="font-size:0.75rem;color:var(--warning);">已有模板</span>' : '<span style="font-size:0.75rem;color:var(--success);">未配置</span>'}
                        </button>
                    `;
                }).join('')}
            </div>
        `);

        requestAnimationFrame(() => {
            document.querySelectorAll('.subject-apply-item').forEach(el => {
                el.addEventListener('click', () => {
                    const subjectId = el.dataset.subjectId;
                    const subject = store.getSubjectById(subjectId);
                    if (!subject) return;

                    const existing = store.getSubjectTemplate(subjectId);
                    const existingPrompt = existing && existing.prompt ? existing.prompt : '';
                    // 追加模板 prompt 到科目模板
                    const newPrompt = existingPrompt
                        ? existingPrompt + '\n\n' + template.prompt
                        : template.prompt;

                    store.setSubjectTemplate(subjectId, { prompt: newPrompt, updatedAt: new Date().toISOString() });
                    UI.closeBottomSheet();
                    UI.showToast(`已应用到 ${subject.name}`);
                    this.render();
                });
                el.addEventListener('mouseenter', () => {
                    el.style.background = 'var(--primary-soft)';
                });
                el.addEventListener('mouseleave', () => {
                    el.style.background = '';
                });
            });
        });
    }

    async checkApiKey() {
        const apiKey = Storage.getApiKey();
        const statusEl = document.getElementById('api-key-status');
        if (!statusEl) return;

        if (!apiKey) {
            statusEl.innerHTML = '';
            return;
        }

        statusEl.innerHTML = '<span class="api-key-status" style="color:var(--text-muted);">⏳ 验证中...</span>';

        const baseUrl = Storage.getApiBaseUrl() || 'https://api.deepseek.com';
        try {
            const response = await fetch(`${baseUrl}/models`, {
                method: 'GET',
                headers: { 'Authorization': `Bearer ${apiKey}` }
            });

            if (response.ok) {
                statusEl.innerHTML = '<span class="api-key-status valid">✅ API Key 有效</span>';
                this.apiKeyValid = true;
            } else {
                statusEl.innerHTML = '<span class="api-key-status invalid">❌ API Key 无效或已过期</span>';
                this.apiKeyValid = false;
            }
        } catch (e) {
            statusEl.innerHTML = '<span class="api-key-status invalid">❌ 验证失败，请检查网络</span>';
            this.apiKeyValid = false;
        }
    }

    /**
     * 静默保存所有设置（不含 Toast 和 API Key 验证，由调用方决定反馈）
     * 从原保存按钮逻辑提取，供各控件的即时保存调用
     */
    _saveSettingsSilent() {
        const apiKey = document.getElementById('api-key')?.value.trim() || '';
        const apiBaseUrl = document.getElementById('api-base-url')?.value.trim() || '';
        Storage.setApiKey(apiKey);
        // apiBaseUrl 无论是否为空都保存，以支持清空自定义地址回退到默认值
        Storage.setApiBaseUrl(apiBaseUrl);

        // 保存风格设置
        const toneEl = document.querySelector('input[name="tone"]:checked');
        const currentStyle = Storage.getStyle();
        const minLength = currentStyle.minLength || 50;
        const maxLength = currentStyle.maxLength || 150;
        const nameShorten = document.getElementById('name-shorten')?.checked ?? true;
        const useEmoji = document.getElementById('use-emoji')?.checked ?? false;
        const emojiPosition = document.querySelector('input[name="emoji-position"]:checked')?.value || 'content';
        const useBulletPoints = document.getElementById('use-bullet-points')?.checked ?? false;
        const includeParentHelp = document.getElementById('include-parent-help')?.checked ?? false;
        const strictInput = document.getElementById('strict-input')?.checked ?? true;
        const customPrompt = document.getElementById('custom-prompt')?.value.trim() || '';
        const useCustomDate = document.getElementById('use-custom-date')?.checked ?? false;
        const customDate = document.getElementById('custom-date')?.value || '';

        const moduleLengths = {};
        document.querySelectorAll('.module-length-item').forEach(item => {
            const moduleName = item.querySelector('.module-min-length')?.dataset.module;
            const min = parseInt(item.querySelector('.module-min-length')?.value) || 50;
            const max = parseInt(item.querySelector('.module-max-length')?.value) || 150;
            if (moduleName) {
                moduleLengths[moduleName] = { min, max };
            }
        });

        Storage.saveStyle({
            tone: toneEl ? toneEl.value : 'formal',
            minLength, maxLength, moduleLengths,
            nameShorten, useEmoji, emojiPosition, useBulletPoints,
            includeParentHelp, strictInput, customPrompt,
            useCustomDate, customDate, language: 'zh'
        });

        // 保存模块状态
        const modules = [];
        document.querySelectorAll('.modules-manage-list .manage-item').forEach(item => {
            const checkbox = item.querySelector('input[type="checkbox"]');
            const name = item.querySelector('.manage-item-name').textContent;
            const isCustom = item.querySelector('.delete-btn') !== null;
            const descInput = item.querySelector('.module-desc-input');
            const description = descInput ? descInput.value.trim() : '';
            modules.push({
                name,
                enabled: checkbox.checked,
                custom: isCustom,
                ...(isCustom && description ? { description } : {})
            });
        });
        Storage.saveModules(modules);
    }

    bindEvents() {
        // 显示/隐藏 API Key
        document.getElementById('btn-toggle-key')?.addEventListener('click', () => {
            const input = document.getElementById('api-key');
            input.type = input.type === 'password' ? 'text' : 'password';
        });

        document.getElementById('apikey-help')?.addEventListener('click', (e) => {
            e.preventDefault();
            app.openHelpModal();
        });

        // ===== 即时保存（去掉保存按钮，全部即时生效 + Toast）=====

        // API Key 防抖即时保存 + 重新验证
        let apiKeyTimer = null;
        const apiKeyInput = document.getElementById('api-key');
        apiKeyInput?.addEventListener('input', () => {
            clearTimeout(apiKeyTimer);
            apiKeyTimer = setTimeout(() => {
                Storage.setApiKey(apiKeyInput.value.trim());
                UI.showToast('API Key 已保存', 'info');
                this.checkApiKey();
            }, 600);
        });

        // API Base URL 防抖即时保存 + 重新验证
        let apiBaseUrlTimer = null;
        const apiBaseUrlInput = document.getElementById('api-base-url');
        apiBaseUrlInput?.addEventListener('input', () => {
            clearTimeout(apiBaseUrlTimer);
            apiBaseUrlTimer = setTimeout(() => {
                Storage.setApiBaseUrl(apiBaseUrlInput.value.trim());
                UI.showToast('API 地址已保存', 'info');
                this.checkApiKey();
            }, 600);
        });

        // 风格选项（tone、emoji 位置）即时保存
        const instantSaveSelectors = [
            'input[name="tone"]',
            'input[name="emoji-position"]',
            '#use-bullet-points',
            '#use-emoji',
            '#name-shorten',
            '#strict-input',
            '#include-parent-help',
            '#use-custom-date',
            '#custom-date',
            '.modules-manage-list input[type="checkbox"]'
        ];
        instantSaveSelectors.forEach(selector => {
            this.container.querySelectorAll(selector).forEach(el => {
                el.addEventListener('change', () => {
                    this._saveSettingsSilent();
                    UI.showToast('设置已保存', 'info');
                });
            });
        });

        // 文本类输入防抖即时保存（custom-prompt、模块字数、模块描述）
        let textSaveTimer = null;
        const debouncedTextSave = () => {
            clearTimeout(textSaveTimer);
            textSaveTimer = setTimeout(() => {
                this._saveSettingsSilent();
                UI.showToast('设置已保存', 'info');
            }, 600);
        };
        this.container.querySelectorAll('#custom-prompt, .module-length-item input, .module-desc-input').forEach(el => {
            el.addEventListener('input', debouncedTextSave);
        });

        // 风格选项点击效果
        document.querySelectorAll('.style-option').forEach(option => {
            option.addEventListener('click', () => {
                const parent = option.parentElement;
                parent.querySelectorAll('.style-option').forEach(o => o.classList.remove('active'));
                option.classList.add('active');
                const radio = option.querySelector('input[type="radio"]');
                if (radio) radio.checked = true;
            });
        });

        // Emoji 开关联动
        document.getElementById('use-emoji')?.addEventListener('change', (e) => {
            const posGroup = document.querySelector('.emoji-position-group');
            if (posGroup) {
                posGroup.style.display = e.target.checked ? 'block' : 'none';
            }
        });

        // 自定义日期开关联动
        document.getElementById('use-custom-date')?.addEventListener('change', (e) => {
            const dateInput = document.querySelector('.custom-date-input');
            if (dateInput) {
                dateInput.style.display = e.target.checked ? 'block' : 'none';
            }
        });

        // 语音识别引擎选项切换（即时生效 + Toast）
        const providerNames = { auto: '智能选择', sherpa: 'Sherpa', vosk: 'Vosk', whisper: 'Whisper', browser: '浏览器内置' };
        document.querySelectorAll('input[name="speech-provider"]').forEach(radio => {
            radio.addEventListener('change', () => {
                const provider = radio.value;
                const currentConfig = Storage.getSpeechConfig();
                const newConfig = { ...currentConfig, provider };
                Storage.saveSpeechConfig(newConfig);

                // 更新配置字段显示
                const fieldsContainer = document.getElementById('speech-config-fields');
                if (fieldsContainer) {
                    fieldsContainer.innerHTML = this.renderSpeechConfigFields(newConfig);
                }

                // 更新选项的 active 状态
                document.querySelectorAll('.speech-provider-list .style-option').forEach(opt => {
                    opt.classList.remove('active');
                });
                radio.closest('.style-option').classList.add('active');

                // 重新绑定预加载按钮（因为 innerHTML 替换了 DOM，旧监听器随旧 DOM 销毁）
                this._bindPreloadButtons();

                UI.showToast(`已切换到${providerNames[provider] || provider}引擎`);
            });
        });

        // 初始绑定所有预加载按钮（Whisper/Vosk/Sherpa）
        this._bindPreloadButtons();

        // 主题切换
        document.querySelectorAll('.theme-option').forEach(option => {
            option.addEventListener('click', () => {
                document.querySelectorAll('.theme-option').forEach(o => o.classList.remove('active'));
                option.classList.add('active');
                const theme = option.dataset.theme;
                Storage.setTheme(theme);
                UI.showToast('主题已切换');
            });
        });

        document.getElementById('btn-add-subject')?.addEventListener('click', () => {
            const name = prompt('请输入科目名称：');
            if (name && name.trim()) {
                const colors = ['#6366F1', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#06B6D4', '#F97316'];
                const randomColor = colors[Math.floor(Math.random() * colors.length)];
                store.addSubject(name.trim(), randomColor);
                this.render();
            }
        });

        document.getElementById('btn-add-module')?.addEventListener('click', () => {
            const name = prompt('请输入模块名称：');
            if (name && name.trim()) {
                Storage.addModule(name.trim());
                this.render();
            }
        });

        // Prompt 模板库事件
        document.getElementById('btn-add-prompt-template')?.addEventListener('click', () => {
            this.showPromptTemplateForm();
        });

        // Prompt 模板操作按钮事件委托
        this.container.querySelectorAll('.prompt-apply-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const templateId = btn.dataset.templateId;
                this.showApplyTemplateToSubject(templateId);
            });
        });

        this.container.querySelectorAll('.prompt-edit-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const templateId = btn.dataset.templateId;
                const template = store.getPromptTemplateById(templateId);
                if (template) this.showPromptTemplateForm(template);
            });
        });

        this.container.querySelectorAll('.prompt-copy-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const templateId = btn.dataset.templateId;
                const template = store.getPromptTemplateById(templateId);
                if (template) {
                    store.addPromptTemplate({
                        name: template.name + '（副本）',
                        description: template.description,
                        category: template.category,
                        prompt: template.prompt,
                        modules: template.modules
                    });
                    UI.showToast('模板已复制');
                    this.render();
                }
            });
        });

        this.container.querySelectorAll('.prompt-delete-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const templateId = btn.dataset.templateId;
                UI.showConfirm('确定删除这个模板？', () => {
                    const result = store.deletePromptTemplate(templateId);
                    if (result) {
                        UI.showToast('模板已删除');
                        this.render();
                    } else {
                        UI.showToast('预置模板不可删除');
                    }
                });
            });
        });

        // 科目专属设置 - 编辑按钮
        this.container.querySelectorAll('.subject-edit-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const subjectId = btn.dataset.subjectId;
                this.showSubjectTemplateEditor(subjectId);
            });
        });

        // 科目专属设置 - 从模板应用按钮
        this.container.querySelectorAll('.subject-apply-template-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const subjectId = btn.dataset.subjectId;
                this.showApplyTemplateToSubjectPicker(subjectId);
            });
        });

        document.getElementById('btn-export')?.addEventListener('click', () => this.exportData());
        document.getElementById('btn-import')?.addEventListener('click', () => {
            document.getElementById('import-file').click();
        });
        document.getElementById('import-file')?.addEventListener('change', (e) => this.importData(e));

        document.getElementById('btn-clear-all')?.addEventListener('click', () => {
            UI.showConfirmInput('确定清空所有数据？此操作不可恢复！', '删除', async () => {
                try {
                    await Storage.reset();
                    location.reload();
                } catch (e) {
                    console.error('[Settings] 清空数据失败:', e);
                    UI.showToast('清空数据失败，请重试或检查浏览器存储权限');
                }
            });
        });

        // 录音日志按钮
        document.getElementById('btn-view-logs')?.addEventListener('click', () => this.showLogPanel());
        document.getElementById('btn-export-logs')?.addEventListener('click', () => this.exportLogs());
        document.getElementById('btn-clear-logs')?.addEventListener('click', () => {
            UI.showConfirm('确定清空所有录音日志？', () => {
                if (typeof recorder !== 'undefined') {
                    recorder.clearLogs();
                    UI.showToast('录音日志已清空');
                }
            });
        });
    }

    updateSubjectColor(id, color) {
        store.updateSubject(id, { color });
    }

    /** 显示录音日志面板 */
    showLogPanel() {
        if (typeof recorder === 'undefined') {
            UI.showToast('录音模块未加载');
            return;
        }

        const logs = recorder.getLogs();
        const totalLogs = logs.length;

        // 创建模态框
        const overlay = document.createElement('div');
        overlay.id = 'log-panel-overlay';
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:10000;display:flex;align-items:center;justify-content:center;padding:16px;';

        const panel = document.createElement('div');
        panel.style.cssText = 'background:var(--bg);border-radius:var(--radius);width:100%;max-width:700px;max-height:85vh;display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,0.3);';

        panel.innerHTML = `
            <div style="display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid var(--border-light);">
                <h3 style="margin:0;font-size:1.1rem;">📋 录音日志 <span style="font-size:0.8rem;color:var(--text-muted);font-weight:normal;">(${totalLogs}条)</span></h3>
                <div style="display:flex;gap:8px;align-items:center;">
                    <label for="log-level-filter" class="sr-only">按日志级别筛选</label>
                    <select id="log-level-filter" name="log-level-filter" aria-label="按日志级别筛选" style="padding:4px 8px;border:1px solid var(--border);border-radius:var(--radius-sm);font-size:0.8rem;background:var(--bg);color:var(--text);">
                        <option value="all">全部</option>
                        <option value="error">错误</option>
                        <option value="warn">警告</option>
                        <option value="info">信息</option>
                    </select>
                    <button id="log-panel-close" style="background:none;border:none;font-size:1.5rem;cursor:pointer;color:var(--text-muted);padding:0 4px;line-height:1;" aria-label="关闭日志面板">&times;</button>
                </div>
            </div>
            <div id="log-panel-content" style="flex:1;overflow-y:auto;padding:12px 16px;font-family:monospace;font-size:0.8rem;line-height:1.6;">
                ${totalLogs === 0 ? '<div style="text-align:center;color:var(--text-muted);padding:40px 0;">暂无日志记录</div>' : ''}
            </div>
            <div style="display:flex;gap:8px;padding:12px 16px;border-top:1px solid var(--border-light);">
                <button id="log-copy-btn" class="secondary-btn" style="flex:1;font-size:0.85rem;">📋 复制</button>
                <button id="log-export-btn" class="secondary-btn" style="flex:1;font-size:0.85rem;">📤 导出</button>
                <button id="log-refresh-btn" class="secondary-btn" style="flex:1;font-size:0.85rem;">🔄 刷新</button>
            </div>
        `;

        overlay.appendChild(panel);
        document.body.appendChild(overlay);

        // 渲染日志条目
        const renderLogs = (filter = 'all') => {
            const content = document.getElementById('log-panel-content');
            if (!content) return;

            const filtered = filter === 'all' ? logs : logs.filter(e => e.level === filter);
            if (filtered.length === 0) {
                content.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:40px 0;">无匹配日志</div>';
                return;
            }

            // 按时间倒序（最新的在上面）
            const sorted = [...filtered].reverse();
            content.innerHTML = sorted.map(e => {
                const levelColor = e.level === 'error' ? 'var(--error)' : e.level === 'warn' ? 'var(--warning)' : 'var(--text-muted)';
                const levelBg = e.level === 'error' ? 'rgba(239,68,68,0.1)' : e.level === 'warn' ? 'rgba(245,158,11,0.1)' : 'transparent';
                const extra = e.extra ? `<span style="color:var(--text-muted);"> | ${escapeHtml(String(e.extra))}</span>` : '';
                return `<div style="padding:6px 8px;border-left:3px solid ${levelColor};background:${levelBg};margin-bottom:4px;border-radius:0 4px 4px 0;">
                    <span style="color:var(--text-muted);">[${escapeHtml(e.time)}]</span>
                    <span style="color:${levelColor};font-weight:600;">${e.level.toUpperCase()}</span>
                    <span>${escapeHtml(e.event)}</span>${extra}
                    <div style="font-size:0.7rem;color:var(--text-muted);margin-top:2px;">${escapeHtml(e.state)} | ${escapeHtml(e.provider)}</div>
                </div>`;
            }).join('');
        };

        renderLogs();

        // 事件绑定
        document.getElementById('log-panel-close')?.addEventListener('click', () => {
            overlay.remove();
        });
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) overlay.remove();
        });
        document.getElementById('log-level-filter')?.addEventListener('change', (e) => {
            renderLogs(e.target.value);
        });
        document.getElementById('log-copy-btn')?.addEventListener('click', () => {
            const text = recorder.exportLogs();
            navigator.clipboard.writeText(text).then(() => {
                UI.showToast('日志已复制到剪贴板');
            }).catch(() => {
                UI.showToast('复制失败，请使用导出功能');
            });
        });
        document.getElementById('log-export-btn')?.addEventListener('click', () => {
            this.exportLogs();
        });
        document.getElementById('log-refresh-btn')?.addEventListener('click', () => {
            // 重新获取日志并渲染
            const newLogs = recorder.getLogs();
            const filter = document.getElementById('log-level-filter')?.value || 'all';
            const content = document.getElementById('log-panel-content');
            if (!content) return;

            const filtered = filter === 'all' ? newLogs : newLogs.filter(e => e.level === filter);
            const countEl = panel.querySelector('h3 span');
            if (countEl) countEl.textContent = `(${newLogs.length}条)`;

            if (filtered.length === 0) {
                content.innerHTML = '<div style="text-align:center;color:var(--text-muted);padding:40px 0;">无匹配日志</div>';
                return;
            }

            const sorted = [...filtered].reverse();
            content.innerHTML = sorted.map(e => {
                const levelColor = e.level === 'error' ? 'var(--error)' : e.level === 'warn' ? 'var(--warning)' : 'var(--text-muted)';
                const levelBg = e.level === 'error' ? 'rgba(239,68,68,0.1)' : e.level === 'warn' ? 'rgba(245,158,11,0.1)' : 'transparent';
                const extra = e.extra ? `<span style="color:var(--text-muted);"> | ${escapeHtml(String(e.extra))}</span>` : '';
                return `<div style="padding:6px 8px;border-left:3px solid ${levelColor};background:${levelBg};margin-bottom:4px;border-radius:0 4px 4px 0;">
                    <span style="color:var(--text-muted);">[${escapeHtml(e.time)}]</span>
                    <span style="color:${levelColor};font-weight:600;">${e.level.toUpperCase()}</span>
                    <span>${escapeHtml(e.event)}</span>${extra}
                    <div style="font-size:0.7rem;color:var(--text-muted);margin-top:2px;">${escapeHtml(e.state)} | ${escapeHtml(e.provider)}</div>
                </div>`;
            }).join('');
        });
    }

    /** 导出录音日志为文本文件 */
    exportLogs() {
        if (typeof recorder === 'undefined') {
            UI.showToast('录音模块未加载');
            return;
        }

        const text = recorder.exportLogs();
        if (text === '暂无录音日志') {
            UI.showToast('暂无日志可导出');
            return;
        }

        const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `recorder-log-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        UI.showToast('日志已导出');
    }

    deleteSubject(id) {
        UI.showConfirm('确定删除这个科目？相关学生关联也将被移除。', () => {
            store.deleteSubject(id);
            this.render();
        });
    }

    _renderBackupStatus() {
        const lastTime = Storage.getLastBackupTime();
        if (!lastTime) {
            return `<div style="padding:8px 12px;background:rgba(245,158,11,0.1);border-radius:var(--radius-sm);margin-bottom:10px;font-size:0.85rem;color:var(--warning);">⚠️ 尚未备份过数据，建议立即导出备份</div>`;
        }
        const daysSince = Math.floor((Date.now() - lastTime) / (1000 * 60 * 60 * 24));
        const dateStr = new Date(lastTime).toLocaleDateString('zh-CN');
        if (daysSince >= 7) {
            return `<div style="padding:8px 12px;background:rgba(245,158,11,0.1);border-radius:var(--radius-sm);margin-bottom:10px;font-size:0.85rem;color:var(--warning);">⚠️ 距上次备份已 ${daysSince} 天（${dateStr}），建议导出备份</div>`;
        }
        return `<div style="padding:8px 12px;background:rgba(16,185,129,0.1);border-radius:var(--radius-sm);margin-bottom:10px;font-size:0.85rem;color:var(--success);">✅ 上次备份：${dateStr}</div>`;
    }

    toggleModule(index) {
        Storage.toggleModule(index);
    }

    moveModule(index, direction) {
        // 排序前先保存当前描述输入框的值
        this._saveModuleDescriptions();
        Storage.swapModule(index, direction);
        this.render();
    }

    /** 保存模块描述输入框的当前值到Storage */
    _saveModuleDescriptions() {
        const modules = Storage.getModules();
        document.querySelectorAll('.module-desc-input').forEach(input => {
            const idx = parseInt(input.dataset.moduleIndex);
            if (modules[idx] && modules[idx].custom) {
                modules[idx].description = input.value.trim();
            }
        });
        Storage.saveModules(modules);
    }

    deleteModule(index) {
        UI.showConfirm('确定删除这个模块？', () => {
            Storage.deleteModule(index);
            this.render();
        });
    }

    exportData() {
        const data = {
            students: store.getStudents(),
            subjects: store.getSubjects(),
            studentSubjects: store._studentSubjects,
            settings: {
                apiBaseUrl: Storage.getApiBaseUrl(),
                modules: Storage.getModules(),
                style: Storage.getStyle(),
                speechConfig: Storage.getSpeechConfig()
            },
            exportDate: new Date().toISOString()
        };

        // 导出反馈历史
        data.feedbackHistory = {};
        store.getStudents().forEach(s => {
            const history = store.getFeedbackHistory(s.id, 50);
            if (history.length > 0) {
                data.feedbackHistory[s.id] = history;
            }
        });

        // 导出科目专属模板
        data.subjectTemplates = {};
        store.getSubjects().forEach(s => {
            const template = store.getSubjectTemplate(s.id);
            if (template) {
                data.subjectTemplates[s.id] = template;
            }
        });

        // 导出学生常用点评模板
        data.studentTemplates = {};
        store.getStudents().forEach(s => {
            const templates = store.getStudentTemplates(s.id);
            if (templates.length > 0) {
                data.studentTemplates[s.id] = templates;
            }
        });

        // 导出快捷回复
        data.quickReplies = store.getQuickReplies();

        // 导出 Prompt 模板库
        const promptTemplates = store.getPromptTemplates();
        if (promptTemplates.length > 0) {
            data.promptTemplates = promptTemplates;
        }

        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `class-feedback-backup-${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        Storage.setLastBackupTime();
        UI.showToast('数据已导出');
    }

    importData(event) {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            let data;
            try {
                data = JSON.parse(e.target.result);
            } catch {
                UI.showToast('导入失败：文件格式错误');
                return;
            }

            if (!data || typeof data !== 'object') {
                UI.showToast('导入失败：文件格式错误');
                return;
            }

            try {
                if (data.students) {
                    localStorage.setItem('cf_students', JSON.stringify(data.students));
                }
                if (data.subjects) {
                    localStorage.setItem('cf_subjects', JSON.stringify(data.subjects));
                }
                if (data.studentSubjects) {
                    localStorage.setItem('cf_student_subjects', JSON.stringify(data.studentSubjects));
                }
                if (data.settings) {
                    if (Object.prototype.hasOwnProperty.call(data.settings, 'apiBaseUrl')) Storage.setApiBaseUrl(data.settings.apiBaseUrl);
                    if (data.settings.modules) Storage.saveModules(data.settings.modules);
                    if (data.settings.style) Storage.saveStyle(data.settings.style);
                    if (data.settings.speechConfig) Storage.saveSpeechConfig(data.settings.speechConfig);
                }
                if (data.feedbackHistory && typeof data.feedbackHistory === 'object') {
                    Object.entries(data.feedbackHistory).forEach(([studentId, history]) => {
                        try {
                            localStorage.setItem(`cf_feedback_${studentId}`, JSON.stringify(history));
                        } catch (storageErr) {
                            console.warn(`导入反馈历史失败 (${studentId}):`, storageErr);
                        }
                    });
                }
                // 导入科目专属模板
                if (data.subjectTemplates && typeof data.subjectTemplates === 'object') {
                    Object.entries(data.subjectTemplates).forEach(([subjectId, template]) => {
                        try {
                            localStorage.setItem(`cf_subject_template_${subjectId}`, JSON.stringify(template));
                        } catch (storageErr) {
                            console.warn(`导入科目模板失败 (${subjectId}):`, storageErr);
                        }
                    });
                }
                // 导入学生常用点评模板
                if (data.studentTemplates && typeof data.studentTemplates === 'object') {
                    Object.entries(data.studentTemplates).forEach(([studentId, templates]) => {
                        try {
                            localStorage.setItem(`cf_templates_${studentId}`, JSON.stringify(templates));
                        } catch (storageErr) {
                            console.warn(`导入学生模板失败 (${studentId}):`, storageErr);
                        }
                    });
                }
                // 导入快捷回复
                if (data.quickReplies && Array.isArray(data.quickReplies)) {
                    try {
                        localStorage.setItem('cf_quick_replies', JSON.stringify(data.quickReplies));
                    } catch (storageErr) {
                        console.warn('导入快捷回复失败:', storageErr);
                    }
                }
                // 导入 Prompt 模板库（非默认模板）
                if (data.promptTemplates && Array.isArray(data.promptTemplates)) {
                    try {
                        localStorage.setItem('cf_prompt_templates', JSON.stringify(data.promptTemplates));
                    } catch (storageErr) {
                        console.warn('导入 Prompt 模板失败:', storageErr);
                    }
                }

                UI.showToast('数据已导入，页面即将刷新');
                // 设置导入标志，触发 db.js _checkReMigration 执行覆盖式迁移
                localStorage.setItem('cf_pending_import', 'true');
                setTimeout(() => location.reload(), 1500);
            } catch (err) {
                UI.showToast('导入失败：' + (err.message || '未知错误'));
            }
        };
        reader.onerror = () => {
            UI.showToast('导入失败：文件读取错误');
        };
        reader.readAsText(file);
        event.target.value = '';
    }
}

const settingsPage = new SettingsPage();
