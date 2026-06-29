// recordPage.js - 录音/反馈页

class RecordPage {
    constructor() {
        this.container = document.getElementById('record-page');
        this.initTimer();
    }

    render() {
        const student = app.currentStudent;
        const subject = app.currentSubject;
        const group = app.currentGroup;

        let headerInfo, subtitle;
        if (group && group.length > 0) {
            const names = group.map(id => store.getStudentById(id)?.name).filter(Boolean).join('、');
            headerInfo = `👥 ${escapeHtml(names)}`;
        } else if (student) {
            headerInfo = `👤 ${escapeHtml(student.name)}`;
        } else {
            headerInfo = '未选择学生';
        }

        subtitle = subject ? `📚 ${escapeHtml(subject.name)}` : '未选择科目';

        // 保存当前文本框内容（页面切换时避免丢失），优先恢复草稿
        const existingTextarea = document.getElementById('transcript');
        const currentText = existingTextarea ? existingTextarea.value : '';
        const draftText = this._loadDraftTranscript();
        const savedText = draftText || currentText;

        this.container.innerHTML = `
            <header>
                <button class="back-btn" onclick="app.navigate('subject-select')" aria-label="返回科目选择">←</button>
                <div class="session-info">
                    <div class="student-name">${headerInfo}</div>
                    <div style="display:flex;align-items:center;gap:6px;">
                        <button type="button" class="subject-name subject-switch" style="color: ${subject?.color || 'var(--text-muted)'};font-weight:500;background:none;border:none;cursor:pointer;padding:0;font:inherit;" onclick="recordPage.showSubjectSwitcher()" aria-label="切换科目，当前 ${escapeHtml(subtitle)}">${subtitle} ▾</button>
                        <button class="text-btn" onclick="recordPage.showPromptTemplatePicker()" style="font-size:0.8rem;padding:2px 6px;">📋 选择模板</button>
                    </div>
                </div>
                <button id="btn-page-settings" class="icon-btn" aria-label="打开设置">⚙️</button>
            </header>

            <main>
                <!-- 课堂计时器（与录音同步，自动开始/停止） -->
                <div class="class-timer-section" id="class-timer-section">
                    <div class="class-timer-display" id="class-timer-display">00:00</div>
                    <div class="class-timer-label">课堂时长</div>
                </div>

                <div class="record-page-layout">
                    <div class="record-page-left">
                        <div class="record-section">
                            <div style="display:flex;align-items:center;justify-content:center;flex-wrap:wrap;gap:8px;">
                                <button id="btn-record" class="record-btn">
                                    <span class="record-icon" aria-hidden="true">🎙️</span>
                                    <span class="record-text">开始录音</span>
                                </button>
                                <button id="btn-stop-record" class="stop-record-btn" style="display:none;">
                                    ⏹️ 停止录音
                                </button>
                            </div>
                            <p class="record-status">点击开始录制课堂内容
                                <span id="engine-badge" class="engine-badge" style="display:none;"></span>
                            </p>
                            <div class="recording-timer" id="recording-timer" style="display:none;"></div>
                            <div class="import-audio-section" style="margin-top:12px;text-align:center;">
                                <label for="audio-file-import" style="color:var(--primary);font-size:0.85rem;cursor:pointer;text-decoration:underline;">
                                    📁 导入录音文件（语音转文字）
                                </label>
                                <input type="file" id="audio-file-import" name="audio-file-import" accept="audio/*" aria-label="导入录音文件" style="display:none;">
                                <div id="audio-import-progress" style="display:none;margin-top:8px;">
                                    <div style="background:var(--border);border-radius:10px;height:6px;overflow:hidden;">
                                        <div id="audio-import-bar" style="background:var(--primary);height:100%;width:0%;transition:width 0.3s;border-radius:10px;"></div>
                                    </div>
                                    <p id="audio-import-status" style="font-size:0.8rem;color:var(--text-muted);margin-top:4px;">准备中…</p>
                                </div>
                            </div>
                        </div>

                        <!-- 快捷回复库 -->
                        <div class="quick-replies-section" id="quick-replies-section">
                            <div class="quick-replies-header">
                                <label>⚡ 快捷回复</label>
                                <div class="quick-replies-header-actions">
                                    <button class="text-btn" onclick="recordPage.showAddQuickReply()">+ 添加</button>
                                    <button class="clear-btn" onclick="recordPage.toggleQuickReplies()">展开/收起</button>
                                </div>
                            </div>
                            <div class="quick-replies-content" id="quick-replies-content">
                                ${this.renderQuickReplies()}
                            </div>
                        </div>

                        <!-- 学生常用模板 -->
                        ${student ? `
                        <div class="student-templates-section" id="student-templates-section">
                            <div class="student-templates-header">
                                <label>📌 ${escapeHtml(student.name)}的常用点评</label>
                                <button class="clear-btn" onclick="recordPage.toggleStudentTemplates()">展开/收起</button>
                            </div>
                            <div class="student-templates-content" id="student-templates-content">
                                ${this.renderStudentTemplates(student.id)}
                                <p class="hint-text" style="margin-top:6px;font-size:0.72rem;">支持变量：{学生姓名} {科目} {日期}，插入时自动替换</p>
                            </div>
                        </div>
                        ` : ''}
                    </div>

                    <div class="record-page-right">
                        <div class="transcript-section">
                            <div class="transcript-header">
                                <label for="transcript">📝 课堂内容（可直接输入或编辑）</label>
                                <div>
                                    <button class="clear-btn" onclick="recordPage.saveAsTemplate()" style="margin-right:8px;">保存为常用点评</button>
                                    <button class="clear-btn" onclick="recordPage.clearTranscript()" aria-label="清空课堂内容">清空</button>
                                </div>
                            </div>
                            ${this.renderNameInsertButtons()}
                            <textarea id="transcript" name="transcript" aria-label="课堂内容"
                                placeholder="请在此输入本节课的课堂内容，例如：&#10;• 今天复习了二次函数&#10;• 学生掌握了配方法&#10;• 作业是练习册第15页&#10;&#10;建议使用电脑端浏览器操作，输入更方便…">${escapeHtml(savedText)}</textarea>
                            <div class="transcript-footer">
                                <span class="word-count">字数：<strong id="word-count">0</strong></span>
                            </div>
                        </div>

                        <button id="btn-generate" class="primary-btn">✨ 生成反馈</button>

                        ${student ? `
                        <button class="secondary-btn" onclick="app.navigate('history')">
                            📋 查看历史反馈
                        </button>
                        ` : ''}
                    </div>
                </div>
            </main>
        `;

        this.bindEvents();
    }

    renderQuickReplies() {
        const replies = store.getQuickReplies();
        if (replies.length === 0) {
            return '<p class="hint-text">暂无快捷回复，点击下方添加</p>';
        }
        const categories = [...new Set(replies.map(r => r.category))];
        return categories.map(cat => `
            <div class="quick-reply-category">
                <span class="quick-reply-cat-label">${escapeHtml(cat)}</span>
                <div class="quick-reply-tags">
                    ${replies.filter(r => r.category === cat).map(r => {
                        const short = escapeHtml(r.content.substring(0, 20)) + (r.content.length > 20 ? '...' : '');
                        return `<div class="quick-reply-item"><button class="quick-reply-tag quick-reply-btn" data-qr-id="${escapeHtml(r.id)}">${short}</button><button class="quick-reply-del" data-qr-del-id="${escapeHtml(r.id)}" title="删除">×</button></div>`;
                    }).join('')}
                </div>
            </div>
        `).join('');
    }

    renderStudentTemplates(studentId) {
        const templates = store.getStudentTemplates(studentId);
        if (templates.length === 0) {
            return '<p class="hint-text">暂无常用点评，输入内容后点击"保存为常用点评"即可添加</p>';
        }
        return `
            <div class="quick-reply-tags">
                ${templates.map((t, i) => `
                    <div class="template-item" data-tpl-insert-id="${escapeHtml(t.id)}" title="点击插入"
                         role="button" tabindex="0"
                         aria-label="插入常用点评：${escapeHtml(t.content.substring(0, 50))}"
                         onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();this.click()}">
                        <span class="template-content">${escapeHtml(t.content)}</span>
                        <button class="template-delete" data-tpl-id="${escapeHtml(t.id)}" aria-label="删除此常用点评">删除</button>
                    </div>
                `).join('')}
            </div>
        `;
    }

    /**
     * 替换模板中的变量占位符
     * 支持：{学生姓名} {科目} {日期}
     */
    _replaceTemplateVars(content) {
        if (!content) return content;
        const student = app.currentStudent;
        const subject = app.currentSubject;
        const style = Storage.getStyle();

        // {学生姓名}
        if (student && content.includes('{学生姓名}')) {
            const name = style.nameShorten !== false && student.name.length >= 3
                ? student.name.slice(-2) : student.name;
            content = content.replaceAll('{学生姓名}', name);
        }
        // {科目}
        if (subject && content.includes('{科目}')) {
            content = content.replaceAll('{科目}', subject.name);
        }
        // {日期}
        if (content.includes('{日期}')) {
            const now = new Date();
            const dateStr = style.useCustomDate && style.customDate
                ? style.customDate
                : `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日`;
            content = content.replaceAll('{日期}', dateStr);
        }
        return content;
    }

    insertQuickReply(content) {
        const textarea = document.getElementById('transcript');
        if (!textarea) return;
        const current = textarea.value;
        const separator = current && !current.endsWith('\n') ? '\n' : '';
        textarea.value = current + separator + content + '\n';
        textarea.focus();
        textarea.scrollTop = textarea.scrollHeight;
        this.updateWordCount(textarea.value);
        UI.showToast('已插入');
    }

    deleteStudentTemplate(templateId) {
        const student = app.currentStudent;
        if (!student) return;
        const templates = store.getStudentTemplates(student.id);
        const template = templates.find(t => t.id === templateId);
        store.deleteStudentTemplate(student.id, templateId);
        this.render();
        if (template) {
            UI.showUndoToast('已删除模板', () => {
                store.addStudentTemplate(student.id, template.content);
                this.render();
            });
        }
    }

    toggleQuickReplies() {
        const el = document.getElementById('quick-replies-content');
        if (el) el.classList.toggle('collapsed');
    }

    showAddQuickReply() {
        const existingCategories = [...new Set(store.getQuickReplies().map(r => r.category))];
        const catOptions = ['表扬', '建议', '作业', '自定义', ...existingCategories.filter(c => !['表扬','建议','作业','自定义'].includes(c))];
        const uniqueCats = [...new Set(catOptions)];

        UI.showBottomSheet(`
            <div class="bottom-sheet-header">
                <h3>添加快捷回复</h3>
            </div>
            <div class="form-section">
                <div class="form-group">
                    <label>回复内容</label>
                    <textarea id="qr-content-input" rows="3" placeholder="输入快捷回复内容，如：注意力集中，积极回答问题"></textarea>
                </div>
                <div class="form-group">
                    <label>分类</label>
                    <div class="qr-cat-select">
                        ${uniqueCats.map(c => `<button class="qr-cat-btn" data-cat="${escapeHtml(c)}">${escapeHtml(c)}</button>`).join('')}
                        <button class="qr-cat-btn qr-cat-custom" data-cat="custom">自定义...</button>
                    </div>
                    <input type="text" id="qr-custom-cat" placeholder="输入自定义分类名" style="display:none;margin-top:8px;">
                </div>
                <button id="btn-save-qr" class="primary-btn">保存</button>
            </div>
        `);

        // 分类按钮点击 - 等待DOM渲染完成
        requestAnimationFrame(() => {
            let selectedCat = '自定义';
            document.querySelectorAll('.qr-cat-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    document.querySelectorAll('.qr-cat-btn').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    const cat = btn.getAttribute('data-cat');
                    const customInput = document.getElementById('qr-custom-cat');
                    if (cat === 'custom') {
                        customInput.style.display = 'block';
                        customInput.focus();
                        selectedCat = '';
                    } else {
                        customInput.style.display = 'none';
                        selectedCat = cat;
                    }
                });
            });

            // 保存按钮
            document.getElementById('btn-save-qr')?.addEventListener('click', () => {
                const content = document.getElementById('qr-content-input')?.value.trim();
                if (!content) {
                    UI.showToast('请输入回复内容');
                    return;
                }
                const customCat = document.getElementById('qr-custom-cat')?.value.trim();
                const category = customCat || selectedCat || '自定义';
                store.addQuickReply(content, category);
                UI.closeBottomSheet();
                UI.showToast('已添加快捷回复');
                this.render();
            });
        });
    }

    deleteQuickReply(replyId) {
        const replies = store.getQuickReplies();
        const reply = replies.find(r => r.id === replyId);
        store.deleteQuickReply(replyId);
        this.render();
        if (reply) {
            UI.showUndoToast('已删除快捷回复', () => {
                store.restoreQuickReply(reply);
                this.render();
            });
        }
    }

    toggleStudentTemplates() {
        const el = document.getElementById('student-templates-content');
        if (el) el.classList.toggle('collapsed');
    }

    saveAsTemplate() {
        const textarea = document.getElementById('transcript');
        const content = textarea ? textarea.value.trim() : '';
        if (!content) {
            UI.showToast('请先输入内容');
            return;
        }
        const student = app.currentStudent;
        if (!student) {
            UI.showToast('请先选择学生');
            return;
        }
        store.addStudentTemplate(student.id, content);
        UI.showToast('已保存为常用点评');
        this.render();
    }

    initTimer() {
        this.classTimer = {
            startTime: null,
            elapsed: 0,
            isRunning: false,
            interval: null
        };
    }

    startClassTimer() {
        if (this.classTimer.isRunning) return;
        this.classTimer.isRunning = true;
        this.classTimer.startTime = Date.now() - this.classTimer.elapsed;
        this.classTimer.interval = setInterval(() => this.updateTimerDisplay(), 1000);
        this.updateTimerUI('running');
    }

    pauseClassTimer() {
        if (!this.classTimer.isRunning) return;
        this.classTimer.isRunning = false;
        this.classTimer.elapsed = Date.now() - this.classTimer.startTime;
        clearInterval(this.classTimer.interval);
        this.updateTimerUI('paused');
    }

    stopClassTimer() {
        // 停止前先更新elapsed，确保包含当前运行的时间
        if (this.classTimer.isRunning) {
            this.classTimer.elapsed = Date.now() - this.classTimer.startTime;
        }
        this.classTimer.isRunning = false;
        if (this.classTimer.interval) {
            clearInterval(this.classTimer.interval);
            this.classTimer.interval = null;
        }
        const totalSeconds = Math.floor(this.classTimer.elapsed / 1000);
        if (totalSeconds > 0) {
            this.saveClassDuration(totalSeconds);
        }
        this.classTimer.elapsed = 0;
        this.classTimer.startTime = null;
        this.updateTimerDisplay();
        this.updateTimerUI('stopped');
    }

    updateTimerDisplay() {
        const display = document.getElementById('class-timer-display');
        if (!display) return;
        let totalSeconds;
        if (this.classTimer.isRunning) {
            totalSeconds = Math.floor((Date.now() - this.classTimer.startTime) / 1000);
        } else {
            totalSeconds = Math.floor(this.classTimer.elapsed / 1000);
        }
        const mins = Math.floor(totalSeconds / 60);
        const secs = totalSeconds % 60;
        display.textContent = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }

    // 计时器UI更新
    updateTimerUI(state) {
        const display = document.getElementById('class-timer-display');
        const section = document.querySelector('.class-timer-section');
        if (display) {
            if (state === 'running') {
                display.classList.add('running');
            } else {
                display.classList.remove('running');
            }
        }
        if (section) {
            if (state === 'running') {
                section.classList.add('running');
            } else {
                section.classList.remove('running');
            }
        }
    }

    saveClassDuration(seconds) {
        const subject = app.currentSubject;
        
        // 单学生模式
        if (app.currentStudent) {
            const record = {
                id: `dur_${Date.now()}`,
                studentId: app.currentStudent.id,
                subjectId: subject?.id,
                duration: seconds,
                date: new Date().toISOString().split('T')[0],
                createdAt: new Date().toISOString()
            };
            this._saveDurationRecord(record);
            return;
        }
        
        // 小组模式：为每位学生保存相同的时长
        if (app.currentGroup && app.currentGroup.length > 0) {
            app.currentGroup.forEach(studentId => {
                const record = {
                    id: `dur_${Date.now()}_${studentId}`,
                    studentId: studentId,
                    subjectId: subject?.id,
                    duration: seconds,
                    date: new Date().toISOString().split('T')[0],
                    createdAt: new Date().toISOString()
                };
                this._saveDurationRecord(record);
            });
        }
    }
    
    _saveDurationRecord(record) {
        const MAX_DURATION_RECORDS = 100; // 限制最大记录数，避免 localStorage 无限增长
        const raw = localStorage.getItem('cf_class_durations') || '[]';
        let durations = [];
        try {
            durations = JSON.parse(raw);
        } catch {
            durations = [];
        }
        durations.push(record);
        // 仅保留最新的 N 条记录
        if (durations.length > MAX_DURATION_RECORDS) {
            durations = durations.slice(-MAX_DURATION_RECORDS);
        }
        try { localStorage.setItem('cf_class_durations', JSON.stringify(durations)); } catch (e) {}
    }

    bindEvents() {
        // 绑定录音按钮单击事件（单击切换：开始/暂停/继续）
        recorder.bindRecordButtonEvents();

        document.getElementById('btn-generate')?.addEventListener('click', () => this.generateFeedback());
        document.getElementById('btn-page-settings')?.addEventListener('click', () => app.openSettings());

        // 停止录音按钮（完全停止，清空状态）
        document.getElementById('btn-stop-record')?.addEventListener('click', () => {
            recorder.stop();
            UI.updateRecordButton(false, false);
            document.getElementById('btn-stop-record').style.display = 'none';
        });

        // 录音文件导入
        document.getElementById('audio-file-import')?.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                recorder.importAudioFile(file);
                e.target.value = '';
            }
        });

        // 小组模式：姓名快速插入按钮
        document.querySelectorAll('.name-insert-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const name = btn.getAttribute('data-name');
                if (name) this.insertStudentName(name);
            });
        });

        // 快捷回复点击事件委托
        this.container.querySelectorAll('.quick-reply-btn[data-qr-id]').forEach(btn => {
            btn.addEventListener('click', () => {
                const qrId = btn.getAttribute('data-qr-id');
                const replies = store.getQuickReplies();
                const reply = replies.find(r => r.id === qrId);
                if (reply) this.insertQuickReply(reply.content);
            });
        });

        // 快捷回复删除按钮
        this.container.querySelectorAll('.quick-reply-del[data-qr-del-id]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const qrId = btn.getAttribute('data-qr-del-id');
                this.deleteQuickReply(qrId);
            });
        });

        // 学生模板删除事件委托
        this.container.querySelectorAll('.template-delete[data-tpl-id]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation(); // 阻止冒泡到模板项的点击插入
                const templateId = btn.getAttribute('data-tpl-id');
                this.deleteStudentTemplate(templateId);
            });
        });

        // 学生模板点击插入（变量替换后插入）
        this.container.querySelectorAll('.template-item[data-tpl-insert-id]').forEach(item => {
            item.addEventListener('click', () => {
                const templateId = item.getAttribute('data-tpl-insert-id');
                const student = app.currentStudent;
                if (!student) return;
                const templates = store.getStudentTemplates(student.id);
                const template = templates.find(t => t.id === templateId);
                if (template) {
                    const replaced = this._replaceTemplateVars(template.content);
                    this.insertQuickReply(replaced);
                }
            });
        });

        // 字数统计 + 自动保存
        const textarea = document.getElementById('transcript');
        if (textarea) {
            this.updateWordCount(textarea.value);
            textarea.addEventListener('input', () => {
                this.updateWordCount(textarea.value);
                this._autoSaveTranscript(textarea.value);
            });
        }
    }

    clearTranscript() {
        const textarea = document.getElementById('transcript');
        const hasContent = (textarea && textarea.value.trim()) || recorder.accumulatedText.trim();
        // 有内容时需二次确认，避免误点清空丢失全部输入
        const doClear = () => {
            if (textarea) textarea.value = '';
            recorder.accumulatedText = '';
            recorder.finalTranscript = '';
            recorder.interimTranscript = '';
            this.updateWordCount('');
            // 清空时立即保存，不走防抖
            if (this._autoSaveTimer) { clearTimeout(this._autoSaveTimer); this._autoSaveTimer = null; }
            this._doSaveTranscript('');
        };
        if (hasContent) {
            UI.showConfirm('确定要清空当前所有课堂内容吗？此操作不可撤销。', doClear);
        } else {
            doClear();
        }
    }

    _autoSaveTranscript(text) {
        // 防抖：避免快速输入时频繁写入 localStorage
        if (this._autoSaveTimer) clearTimeout(this._autoSaveTimer);
        this._autoSaveTimer = setTimeout(() => {
            this._doSaveTranscript(text);
        }, 500);
    }

    _doSaveTranscript(text) {
        try {
            localStorage.setItem('cf_draft_transcript', text);
        } catch (e) {
            // 忽略存储空间不足
        }
    }

    _loadDraftTranscript() {
        try {
            return localStorage.getItem('cf_draft_transcript') || '';
        } catch {
            return '';
        }
    }

    updateWordCount(text) {
        const el = document.getElementById('word-count');
        if (el) el.textContent = text.replace(/\s/g, '').length;
    }

    /** 科目快捷切换 */
    showSubjectSwitcher() {
        const subjects = store.getSubjects();
        if (subjects.length === 0) {
            UI.showToast('暂无科目，请先在设置中添加');
            return;
        }
        const currentSubjectId = app.currentSubject?.id;
        const items = subjects.map(s => `
            <div class="subject-switch-item ${s.id === currentSubjectId ? 'active' : ''}" data-subject-id="${escapeHtml(s.id)}" role="button" tabindex="0" aria-label="切换到科目 ${escapeHtml(s.name)}">
                <span class="color-dot" style="background:${escapeHtml(s.color)}" aria-hidden="true"></span>
                <span>${escapeHtml(s.name)}</span>
                ${s.id === currentSubjectId ? '<span style="margin-left:auto;color:var(--primary);" aria-hidden="true">✓</span>' : ''}
            </div>
        `).join('');

        UI.showBottomSheet(`
            <div class="bottom-sheet-header">
                <h3>切换科目</h3>
            </div>
            <div class="subject-switch-list">${items}</div>
        `);

        requestAnimationFrame(() => {
            document.querySelectorAll('.subject-switch-item').forEach(el => {
                const handler = () => {
                    const subjectId = el.dataset.subjectId;
                    const subject = store.getSubjects().find(s => s.id === subjectId);
                    if (subject) {
                        app.currentSubject = subject;
                        this.render();
                        UI.closeBottomSheet();
                        UI.showToast('已切换到 ' + subject.name);
                    }
                };
                el.addEventListener('click', handler);
                // 键盘可达性：Enter/Space 触发
                el.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handler();
                    }
                });
            });
        });
    }

    /** 小组模式：在文本框中插入 @姓名： 标记 */
    insertStudentName(name) {
        const textarea = document.getElementById('transcript');
        if (!textarea) return;
        const current = textarea.value;
        const separator = current && !current.endsWith('\n') ? '\n' : '';
        textarea.value = current + separator + '@' + name + '：';
        textarea.focus();
        textarea.scrollTop = textarea.scrollHeight;
        this.updateWordCount(textarea.value);
        UI.showToast('已插入 @' + name);
    }

    /** 渲染小组模式的姓名快速插入按钮 */
    renderNameInsertButtons() {
        const group = app.currentGroup;
        if (!group || group.length < 2) return '';
        return `
            <div class="name-insert-bar">
                ${group.map(id => {
                    const s = store.getStudentById(id);
                    return s ? `<button class="name-insert-btn" data-name="${escapeHtml(s.name)}">@${escapeHtml(s.name)}</button>` : '';
                }).join('')}
                <span class="name-insert-hint">点击插入姓名标记，帮助AI区分</span>
            </div>
        `;
    }

    /** 选择 Prompt 模板 */
    showPromptTemplatePicker() {
        const templates = store.getPromptTemplates();
        if (templates.length === 0) {
            UI.showToast('暂无模板，请在设置中创建');
            return;
        }

        // 按分类分组
        const categories = [...new Set(templates.map(t => t.category))];
        const items = categories.map(cat => {
            const catTemplates = templates.filter(t => t.category === cat);
            return `
                <div style="margin-bottom:12px;">
                    <div style="font-size:0.8rem;font-weight:600;color:var(--text-muted);padding:4px 0;margin-bottom:4px;">${escapeHtml(cat)}</div>
                    ${catTemplates.map(t => `
                        <div class="prompt-template-pick-item" data-template-id="${escapeHtml(t.id)}" role="button" tabindex="0" aria-label="应用模板 ${escapeHtml(t.name)}" style="padding:10px 14px;border:1.5px solid var(--border);border-radius:var(--radius-sm);margin-bottom:6px;cursor:pointer;transition:background 0.15s;">
                            <div style="font-weight:600;font-size:0.9rem;color:var(--text);">${escapeHtml(t.name)}</div>
                            ${t.description ? `<div style="font-size:0.8rem;color:var(--text-muted);margin-top:2px;">${escapeHtml(t.description)}</div>` : ''}
                        </div>
                    `).join('')}
                </div>
            `;
        }).join('');

        UI.showBottomSheet(`
            <div class="bottom-sheet-header">
                <h3>选择 Prompt 模板</h3>
            </div>
            <p style="font-size:0.85rem;color:var(--text-muted);margin-bottom:12px;">选择模板后将替换当前的自定义要求</p>
            <div style="max-height:50vh;overflow-y:auto;">
                ${items}
            </div>
        `);

        requestAnimationFrame(() => {
            document.querySelectorAll('.prompt-template-pick-item').forEach(el => {
                const handler = () => {
                    const templateId = el.dataset.templateId;
                    const template = store.getPromptTemplateById(templateId);
                    if (!template) return;

                    // 存储选中的模板 ID，用于 AI 调用时传入
                    // （ai.js 会通过 promptTemplateId 读取模板 prompt 和 modules，
                    //   无需写入 customPrompt 或覆盖 Storage 中的 modules，避免重复和破坏用户配置）
                    this._selectedPromptTemplateId = templateId;

                    UI.closeBottomSheet();
                    UI.showToast(`已应用模板「${template.name}」`);
                };
                el.addEventListener('click', handler);
                // 键盘可达性：Enter/Space 触发
                el.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handler();
                    }
                });
                el.addEventListener('mouseenter', () => {
                    el.style.background = 'var(--primary-soft)';
                    el.style.borderColor = 'var(--primary-light)';
                });
                el.addEventListener('mouseleave', () => {
                    el.style.background = '';
                    el.style.borderColor = '';
                });
            });
        });
    }

    async generateFeedback() {
        // P5-3: 应用层并发锁，避免按钮 DOM 状态被外部重置后再次进入造成重复写入
        // 任意以下情况都会拒绝：上一次生成仍在进行中
        if (this._isGenerating) return;
        // 防重复提交：检查是否正在生成
        const btn = document.getElementById('btn-generate');
        if (btn && btn.disabled) return;

        const textarea = document.getElementById('transcript');
        const text = textarea ? textarea.value.trim() : '';
        if (!text) {
            UI.showToast('请先录音或输入课堂内容');
            return;
        }

        const apiKey = Storage.getApiKey();
        if (!apiKey) {
            UI.showToast('请先设置 API Key');
            app.openSettings();
            return;
        }

        const modules = Storage.getModules().filter(m => m.enabled);
        if (modules.length === 0) {
            UI.showToast('请至少启用一个反馈模块');
            return;
        }

        // 所有前置校验通过，置位并发锁（finally 块负责释放）
        this._isGenerating = true;

        // 防重复提交：禁用按钮+loading状态
        if (btn) {
            btn.disabled = true;
            btn.dataset.originalText = btn.textContent;
            btn.textContent = '⏳ 生成中...';
            btn.style.opacity = '0.6';
            btn.style.cursor = 'not-allowed';
        }

        // 获取当前会话信息
        const student = app.currentStudent;
        const subject = app.currentSubject;
        const group = app.currentGroup;
        const subjectName = subject?.name || '';
        const moduleNames = modules.map(m => m.name);
        let style = Storage.getStyle();

        // 如果选中了模板，临时屏蔽 customPrompt 避免与模板 prompt 重复
        // （不修改 Storage 中的值，生成后 customPrompt 仍然保留）
        if (this._selectedPromptTemplateId) {
            style = { ...style, customPrompt: '' };
        }

        // AbortController：支持用户取消 + 60s 超时自动取消，避免网络挂起时永久锁屏
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 60000);
        // 用户主动取消时给出提示
        const onCancel = () => {
            clearTimeout(timeoutId);
            try { controller.abort(); } catch (e) {}
            UI.showToast('已取消生成', 'info');
        };
        UI.showLoading('正在分析课堂内容...', onCancel);

        // 进度提示定时器
        const progressTimer = setInterval(() => {
            const msgEl = document.getElementById('loading-message');
            if (!msgEl) { clearInterval(progressTimer); return; }
            const current = msgEl.textContent;
            if (current.includes('分析课堂内容')) {
                msgEl.textContent = '正在生成反馈内容...';
            } else if (current.includes('生成反馈内容')) {
                msgEl.textContent = '即将完成，请稍候...';
            }
        }, 4000);

        try {
            if (group && group.length > 0) {
                // ===== 小组模式：为每位学生分别生成独立反馈 =====
                // 初始化本次小组反馈ID映射，用于编辑持久化（避免覆盖到上一节课）
                app._groupFeedbackIds = {};
                const studentNames = group.map(id => store.getStudentById(id)?.name).filter(Boolean);
                if (studentNames.length === 0) {
                    UI.showToast('未找到学生信息');
                    return;
                }

                UI.updateLoading('正在为 ' + studentNames.length + ' 位学生生成反馈...');
                const feedbacks = await AiService.generateGroupFeedback(text, moduleNames, studentNames, subjectName, style, subject?.id, this._selectedPromptTemplateId, controller.signal);

                // 为每位学生保存到各自的历史记录
                const MAX_STORED_TRANSCRIPT = 10000;
                const storedTranscript = text.length > MAX_STORED_TRANSCRIPT
                    ? text.substring(0, 5000) + '\n\n[... 中间内容省略 ...]\n\n' + text.substring(text.length - 3000)
                    : text;

                for (const fb of feedbacks) {
                    const groupStudents = group.map(id => store.getStudentById(id)).filter(Boolean);
                    // 精确匹配 → 模糊匹配（仅允许AI省略姓氏：全名.endsWith(AI名)，不允许短名匹配长名）
                    let matchedStudent = groupStudents.find(s => s.name === fb.studentName);
                    if (!matchedStudent) {
                        matchedStudent = groupStudents.find(s => s.name.endsWith(fb.studentName) && fb.studentName.length >= 2);
                    }
                    if (matchedStudent) {
                        const saved = store.addFeedback(matchedStudent.id, {
                            subjectId: subject?.id,
                            transcript: storedTranscript,
                            feedback: fb.feedback
                        });
                        // 记录每位学生本次反馈ID，用于编辑持久化（避免覆盖到上一节课）
                        if (saved) {
                            if (!app._groupFeedbackIds) app._groupFeedbackIds = {};
                            app._groupFeedbackIds[matchedStudent.id] = saved.id;
                            if (!app._currentFeedbackId) app._currentFeedbackId = saved.id;
                        }
                    }
                }

                app.renderGroupFeedback(feedbacks);
                app.openModal(document.getElementById('result-modal'));
                this.clearTranscript();
            } else {
                // ===== 单学生模式：原有逻辑 =====
                let studentName = student ? student.name : '';
                UI.updateLoading('正在生成反馈内容...');
                const feedback = await AiService.generateFeedback(text, moduleNames, studentName, subjectName, style, subject?.id, this._selectedPromptTemplateId, controller.signal);

                if (student) {
                    const MAX_STORED_TRANSCRIPT = 10000;
                    const storedTranscript = text.length > MAX_STORED_TRANSCRIPT
                        ? text.substring(0, 5000) + '\n\n[... 中间内容省略 ...]\n\n' + text.substring(text.length - 3000)
                        : text;
                    const saved = store.addFeedback(student.id, {
                        subjectId: subject?.id,
                        transcript: storedTranscript,
                        feedback
                    });
                    if (saved) app._currentFeedbackId = saved.id;
                }

                app.renderFeedback(feedback);
                app.openModal(document.getElementById('result-modal'));
                this.clearTranscript();
            }
        } catch (err) {
            // 用户主动取消或超时取消，不显示错误（取消时已通过 onCancel Toast 提示）
            if (err.name !== 'AbortError') {
                UI.showToast('生成失败：' + err.message);
            }
        } finally {
            clearTimeout(timeoutId);
            clearInterval(progressTimer);
            UI.hideLoading();
            // 清除本次使用的模板ID，避免下次生成时无意识地继续使用
            this._selectedPromptTemplateId = null;
            // P5-3: 释放并发锁（必须在按钮恢复前释放，避免极端时序下错过重置）
            this._isGenerating = false;
            // 恢复生成按钮
            const genBtn = document.getElementById('btn-generate');
            if (genBtn) {
                genBtn.disabled = false;
                genBtn.textContent = genBtn.dataset.originalText || '✨ 生成反馈';
                genBtn.style.opacity = '';
                genBtn.style.cursor = '';
                delete genBtn.dataset.originalText;
            }
        }
    }
}

const recordPage = new RecordPage();
