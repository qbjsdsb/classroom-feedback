// app.js - 主应用路由

class App {
    constructor() {
        this.currentStudent = null;
        this.currentSubject = null;
        this.currentGroup = null;
        this.currentFeedback = null;
        this._currentFeedbackId = null; // 当前反馈的ID，用于编辑后持久化
        this.currentPage = null;
        this.pages = {
            'students': studentsPage,
            'student-form': studentFormPage,
            'subject-select': subjectSelectPage,
            'record': recordPage,
            'history': historyPage,
            'settings': settingsPage
        };
        // init() 改为异步，不在构造函数中直接调用
    }

    async init() {
        // 先初始化数据层，确保内存缓存已加载
        await Storage.init();
        await store.init();
        Storage.initTheme();
        this.initElements();
        this.bindEvents();
        this.checkFirstUse();
        this.checkBackupReminder();
        this.navigate('students');
    }

    checkStorageQuota() {
        // 数据已迁移到 IndexedDB，不再需要检查 localStorage 配额
        // IndexedDB 存储上限远大于 localStorage（通常数百MB）
    }

    checkBackupReminder() {
        // 有学生数据才提醒备份
        const students = store.getStudents();
        if (students.length === 0) return;
        if (Storage.needsBackupReminder()) {
            setTimeout(() => {
                UI.showToast('⚠️ 建议导出数据备份，防止数据丢失', 5000, 'warning');
            }, 2000);
        }
    }

    initElements() {
        this.resultModal = document.getElementById('result-modal');
        this.helpModal = document.getElementById('help-modal');
        this.feedbackContent = document.getElementById('feedback-content');
        this.feedbackTitle = document.getElementById('feedback-title');
    }

    bindEvents() {
        document.querySelectorAll('.close-btn').forEach(btn => {
            btn.addEventListener('click', (e) => this.closeModal(e.target.closest('.modal')));
        });

        [this.resultModal, this.helpModal].forEach(modal => {
            if (modal) {
                modal.addEventListener('click', (e) => {
                    if (e.target === modal) this.closeModal(modal);
                });
            }
        });

        // 复制按钮
        document.getElementById('btn-copy')?.addEventListener('click', () => this.copyFeedback());
        
        // 重新生成按钮
        document.getElementById('btn-regenerate')?.addEventListener('click', () => this.regenerateFeedback());
    }

    navigate(pageName, params = {}) {
        // 离开录音页面时，自动停止计时器和录音
        if (this.currentPage === 'record' && pageName !== 'record') {
            if (recordPage.classTimer && recordPage.classTimer.isRunning) {
                recordPage.stopClassTimer();
            }
            if (recorder && recorder.isRecording) {
                recorder.stop();
            }
        }

        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));

        window.scrollTo(0, 0);

        const page = this.pages[pageName];
        if (page && page.render) {
            if (params) page._params = params;
            page.render();
        }

        // 延迟添加 active 类以触发动画，避免与 CSS transition 冲突
        requestAnimationFrame(() => {
            const pageEl = document.getElementById(`${pageName}-page`);
            if (pageEl) pageEl.classList.add('active');
        });

        this.currentPage = pageName;
        this.updateBottomNav(pageName);
    }

    updateBottomNav(activePage) {
        // 更新底部导航（移动端）
        document.querySelectorAll('.bottom-nav-item').forEach(item => {
            const isActive = item.dataset.page === activePage;
            item.classList.toggle('active', isActive);
            if (isActive) item.setAttribute('aria-current', 'page');
            else item.removeAttribute('aria-current');
        });
        // 更新侧边栏导航（桌面端）
        document.querySelectorAll('.sidebar-nav-item').forEach(item => {
            const isActive = item.dataset.page === activePage;
            item.classList.toggle('active', isActive);
            if (isActive) item.setAttribute('aria-current', 'page');
            else item.removeAttribute('aria-current');
        });
    }

    setCurrentStudent(studentId) {
        this.currentStudent = store.getStudentById(studentId);
        this.currentGroup = null;
    }

    setCurrentGroup(studentIds) {
        this.currentGroup = studentIds;
        this.currentStudent = null;
    }

    setCurrentSubject(subjectId) {
        this.currentSubject = store.getSubjectById(subjectId);
    }

    checkFirstUse() {
        const apiKey = Storage.getApiKey();
        const students = store.getStudents();
        if (!apiKey && students.length === 0) {
            // 首次使用，不强制弹设置，让用户先添加学生
        }
    }

    openSettings() {
        this.navigate('settings');
    }

    openHelpModal() {
        this.openModal(this.helpModal);
    }

    openModal(modal) {
        modal.classList.add('active');
        document.body.style.overflow = 'hidden';
    }

    closeModal(modal) {
        modal.classList.remove('active');
        document.body.style.overflow = '';
    }

    renderFeedback(feedback) {
        // 关闭小组模式 UI
        this._showGroupUI(false);
        this._groupFeedbackData = null;
        this._groupCurrentIndex = 0;

        this.currentFeedback = feedback;
        // 单学生模式下，_currentFeedbackId 在 recordPage.js 中已设置
        if (this.feedbackTitle) {
            this.feedbackTitle.textContent = this.generateFeedbackTitle();
        }
        if (this.feedbackContent) {
            // 移除旧的 blur 监听器
            if (this._feedbackBlurHandler) {
                this.feedbackContent.querySelectorAll('.feedback-content').forEach(el => {
                    el.removeEventListener('blur', this._feedbackBlurHandler);
                });
            }

            this.feedbackContent.innerHTML = feedback.map((item, index) => `
                <div class="feedback-section" data-index="${index}">
                    <h3><span class="feedback-module-icon" aria-hidden="true">${this._getModuleIcon(item.module)}</span>【${escapeHtml(item.module)}】</h3>
                    <div class="feedback-content" contenteditable="true" role="textbox" aria-multiline="true" aria-label="编辑 ${escapeHtml(item.module)} 模块内容" data-index="${index}">${escapeHtml(item.content)}</div>
                    <div class="feedback-edit-hint">💡 点击上方内容可直接编辑</div>
                </div>
            `).join('');

            // 创建并缓存 blur 处理器
            this._feedbackBlurHandler = (e) => {
                // 使用 currentTarget 而非 target，避免事件冒泡时获取到子元素的 data-index
                const el = e.currentTarget;
                const idx = parseInt(el.dataset.index);
                if (this.currentFeedback && this.currentFeedback[idx]) {
                    this.currentFeedback[idx].content = el.innerText;
                }
                // 持久化保存编辑后的反馈
                this._persistFeedbackEdit();
            };

            // 添加编辑事件监听
            this.feedbackContent.querySelectorAll('.feedback-content').forEach(el => {
                el.addEventListener('blur', this._feedbackBlurHandler);
            });
        }
    }

    generateFeedbackTitle() {
        const style = Storage.getStyle();
        let dateStr;
        
        if (style.useCustomDate && style.customDate) {
            // 使用自定义日期（YYYY-MM-DD 格式转为 M.D）
            const parts = style.customDate.split('-');
            if (parts.length === 3) {
                dateStr = `${parseInt(parts[1])}.${parseInt(parts[2])}`;
            } else {
                dateStr = style.customDate;
            }
        } else {
            // 使用当天日期
            const now = new Date();
            const month = now.getMonth() + 1;
            const day = now.getDate();
            dateStr = `${month}.${day}`;
        }

        const student = this.currentStudent;
        const subject = this.currentSubject;
        const group = this.currentGroup;

        let namePart = '';
        let trialPart = '';

        if (group && group.length > 0) {
            const names = group.map(id => {
                const s = store.getStudentById(id);
                if (!s) return '';
                const displayName = style.nameShorten !== false && s.name.length >= 3 ? s.name.slice(-2) : s.name;
                return displayName;
            }).filter(Boolean);
            namePart = names.join('、');
            // 多人时如果有试听生，标记"试听"
            const hasTrial = group.some(id => {
                const s = store.getStudentById(id);
                return s && s.isTrial;
            });
            if (hasTrial) trialPart = '试听';
        } else if (student) {
            namePart = style.nameShorten !== false && student.name.length >= 3 ? student.name.slice(-2) : student.name;
            if (student.isTrial) trialPart = '试听';
        }

        const subjectPart = subject ? subject.name : '';
        const subjectFull = trialPart ? `${subjectPart}${trialPart}` : subjectPart;

        // 组装标题各部分，过滤空值，直接拼接（无空格）
        const parts = [dateStr, namePart, subjectFull, '课堂反馈'].filter(p => p);
        return parts.join('');
    }

    async copyFeedback() {
        if (!this.currentFeedback) return;

        // 标记正在复制，避免blur误弹保存提示
        this._isCopying = true;

        // 获取最新编辑的内容
        this.feedbackContent.querySelectorAll('.feedback-content').forEach(el => {
            const idx = parseInt(el.dataset.index);
            if (this.currentFeedback[idx]) {
                this.currentFeedback[idx].content = el.innerText;
            }
        });

        // 小组模式：使用当前学生的标题（不含其他人）
        // 单人模式：使用 generateFeedbackTitle()
        let title;
        if (this._groupFeedbackData && this._groupCurrentIndex !== undefined) {
            title = this.feedbackTitle.textContent;
        } else {
            title = this.generateFeedbackTitle();
        }
        const body = this.currentFeedback.map(item => `【${item.module}】\n${item.content}`).join('\n\n');
        const text = `${title}\n\n${body}`;

        try {
            await navigator.clipboard.writeText(text.trim());
            UI.showToast('✅ 已复制到剪贴板');
            
            const btn = document.getElementById('btn-copy');
            if (btn) {
                const originalText = btn.textContent;
                btn.textContent = '✅ 已复制';
                btn.classList.add('copy-success');
                setTimeout(() => {
                    btn.textContent = originalText;
                    btn.classList.remove('copy-success');
                }, 2000);
            }
        } catch (err) {
            // 降级方案
            const textarea = document.createElement('textarea');
            textarea.value = text.trim();
            textarea.style.position = 'fixed';
            textarea.style.opacity = '0';
            document.body.appendChild(textarea);
            textarea.select();
            try {
                document.execCommand('copy');
                UI.showToast('✅ 已复制到剪贴板');
            } catch (e) {
                UI.showToast('复制失败，请手动复制');
            }
            document.body.removeChild(textarea);
        }
        // 延迟重置标志位，避免blur在复制完成后误触发
        setTimeout(() => { this._isCopying = false; }, 300);
    }

    async regenerateFeedback() {
        this.closeModal(this.resultModal);
        UI.showToast('请重新录音或输入内容后再次生成');
        this.navigate('record');
    }

    // ===== 小组模式：分页展示 + 公共模块合并 =====

    /**
     * 渲染小组反馈（顶部标签 + 底部翻页）
     * @param {Array} feedbacks - 每位学生的反馈数组
     */
    renderGroupFeedback(feedbacks) {
        if (!feedbacks || feedbacks.length === 0) return;

        // 1. 统一公共模块（课堂内容、课后作业）
        const unified = this._unifyCommonModules(feedbacks);
        this._groupFeedbackData = unified;
        this._groupCurrentIndex = 0;

        // 2. 显示小组 UI
        this._showGroupUI(true);

        // 3. 渲染顶部标签
        this._renderGroupTabs(unified);

        // 4. 显示第一个学生
        this._showGroupStudent(0);

        // 5. 绑定翻页按钮事件
        this._bindGroupNavButtons();
    }

    /**
     * 显示/隐藏小组模式的 UI 元素
     */
    _showGroupUI(show) {
        const tabsContainer = document.getElementById('group-tabs-container');
        const navContainer = document.getElementById('group-nav-container');
        if (tabsContainer) tabsContainer.style.display = show ? 'flex' : 'none';
        if (navContainer) navContainer.style.display = show ? 'flex' : 'none';
    }

    /**
     * 统一公共模块：课堂内容和课后作业对所有学生保持一致
     */
    _unifyCommonModules(feedbacks) {
        if (feedbacks.length < 2) return feedbacks;

        const COMMON_MODULES = ['课堂内容', '课后作业'];
        const first = feedbacks[0];

        // 收集所有学生姓名及其可能的变体（全名、后两个字）
        const allStudentNames = feedbacks.map(fb => fb.studentName).filter(Boolean);
        const namePatterns = [];
        for (const name of allStudentNames) {
            namePatterns.push(name);
            if (name.length >= 3) {
                namePatterns.push(name.slice(-2));
            }
        }

        // 转义正则特殊字符
        const escapeRegex = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

        const commonContents = {};
        // 检测 lookbehind 支持（旧 Safari < 16.4 不支持，new RegExp 会抛 SyntaxError）
        let supportsLookbehind = true;
        try {
            new RegExp('(?<=a)b');
        } catch (e) {
            supportsLookbehind = false;
            console.warn('[App] 当前浏览器不支持正则 lookbehind，_unifyCommonModules 降级处理');
        }
        for (const modName of COMMON_MODULES) {
            const mod = first.feedback.find(f => f.module === modName);
            if (mod) {
                // 过滤掉公共模块中的学生姓名（兜底处理）
                let cleanedContent = mod.content;
                for (const pattern of namePatterns) {
                    const p = escapeRegex(pattern);
                    // lookbehind 前缀：前面不能是汉字，避免"说明的"被"明"误替换、"申请X在"被"X在"误替换
                    const lb = supportsLookbehind ? '(?<![\\u4e00-\\u9fff])' : '';
                    try {
                        // 1. 替换 "请pattern..." 模式（前面加 lookbehind，避免"申请pattern"被误替换为"申请同学们"）
                        const regex1 = new RegExp(`${lb}请${p}([在需应]|同学|完成|独立|复习|梳理|注意|重点|及时)`, 'g');
                        cleanedContent = cleanedContent.replace(regex1, '请同学们$1');
                        // 2. 替换 "pattern的" 模式
                        const regex2 = new RegExp(`${lb}${p}的`, 'g');
                        cleanedContent = cleanedContent.replace(regex2, '同学们的');
                        // 3. 替换 "pattern在..." 模式（pattern在课堂上、pattern在课后）
                        const regex3 = new RegExp(`${lb}${p}在(课堂|课后|本节课|课堂中)`, 'g');
                        cleanedContent = cleanedContent.replace(regex3, '同学们在$1');
                        // 4. 替换 "pattern表现"、"pattern回答" 等动词搭配
                        const regex4 = new RegExp(`${lb}${p}(表现|回答|提问|参与|完成|掌握|理解|笔记|专注|积极|安静)`, 'g');
                        cleanedContent = cleanedContent.replace(regex4, '同学们$1');
                        // 5. 替换 "pattern需要"、"pattern应" 模式
                        const regex5 = new RegExp(`${lb}${p}(需要|应|可以|建议|需)`, 'g');
                        cleanedContent = cleanedContent.replace(regex5, '同学们$1');
                    } catch (e) {
                        // 单个正则异常时跳过该 pattern，不影响其他替换
                        console.warn(`[App] _unifyCommonModules 替换 pattern "${pattern}" 失败:`, e);
                    }
                }
                commonContents[modName] = cleanedContent;
            }
        }

        return feedbacks.map(fb => ({
            studentName: fb.studentName,
            feedback: fb.feedback.map(item => {
                if (COMMON_MODULES.includes(item.module) && commonContents[item.module]) {
                    return { ...item, content: commonContents[item.module] };
                }
                return item;
            })
        }));
    }

    /**
     * 渲染顶部学生标签
     */
    _renderGroupTabs(feedbacks) {
        const container = document.getElementById('group-tabs-container');
        if (!container) return;

        container.innerHTML = feedbacks.map((fb, i) => `
            <button class="group-tab" data-index="${i}" onclick="app._showGroupStudent(${i})">
                ${escapeHtml(fb.studentName)}
            </button>
        `).join('');
    }

    /**
     * 切换显示指定学生的反馈
     */
    _showGroupStudent(index) {
        if (!this._groupFeedbackData || !this._groupFeedbackData[index]) return;

        this._groupCurrentIndex = index;
        const data = this._groupFeedbackData[index];
        this.currentFeedback = data.feedback;

        // 更新当前反馈ID（用于编辑持久化）
        if (this.currentGroup) {
            // 精确匹配 → 模糊匹配（仅允许AI省略姓氏，不允许短名匹配长名）
            let student = this.currentGroup
                .map(id => store.getStudentById(id))
                .find(s => s && s.name === data.studentName);
            if (!student) {
                student = this.currentGroup
                    .map(id => store.getStudentById(id))
                    .find(s => s && (s.name.endsWith(data.studentName) && data.studentName.length >= 2));
            }
            if (student) {
                // 优先使用本次生成时记录的 feedbackId，避免 addFeedback 失败时回退到上一节课
                if (this._groupFeedbackIds && this._groupFeedbackIds[student.id]) {
                    this._currentFeedbackId = this._groupFeedbackIds[student.id];
                } else {
                    const history = store.getFeedbackHistory(student.id);
                    if (history && history.length > 0) {
                        this._currentFeedbackId = history[0].id; // 最新一条
                    }
                }
            }
        }

        // 更新标题
        if (this.feedbackTitle) {
            const style = Storage.getStyle();
            const subject = this.currentSubject;
            const dateStr = this._getDateStr(style);
            const shortName = style.nameShorten !== false && data.studentName.length >= 3
                ? data.studentName.slice(-2) : data.studentName;
            const subjectPart = subject ? subject.name : '';
            // 检查当前学生是否为试听生
            let trialPart = '';
            if (this.currentGroup) {
                // 精确匹配 → 模糊匹配
                let studentObj = this.currentGroup
                    .map(id => store.getStudentById(id))
                    .find(s => s && s.name === data.studentName);
                if (!studentObj) {
                    studentObj = this.currentGroup
                        .map(id => store.getStudentById(id))
                        .find(s => s && (s.name.endsWith(data.studentName) && data.studentName.length >= 2));
                }
                if (studentObj && studentObj.isTrial) trialPart = '试听';
            } else if (this.currentStudent && this.currentStudent.isTrial) {
                trialPart = '试听';
            }
            const subjectFull = trialPart ? `${subjectPart}${trialPart}` : subjectPart;
            this.feedbackTitle.textContent = [dateStr, shortName, subjectFull, '课堂反馈'].filter(p => p).join('');
        }

        // 更新顶部标签激活状态
        document.querySelectorAll('.group-tab').forEach((tab, i) => {
            tab.classList.toggle('active', i === index);
        });

        // 更新底部翻页指示器
        const indicator = document.getElementById('group-nav-indicator');
        if (indicator) {
            indicator.textContent = `${index + 1} / ${this._groupFeedbackData.length}`;
        }

        // 更新翻页按钮状态
        const prevBtn = document.getElementById('group-nav-prev');
        const nextBtn = document.getElementById('group-nav-next');
        if (prevBtn) prevBtn.disabled = index === 0;
        if (nextBtn) nextBtn.disabled = index === this._groupFeedbackData.length - 1;

        // 渲染反馈内容
        if (this.feedbackContent) {
            // 移除旧的事件监听器
            const oldContents = this.feedbackContent.querySelectorAll('.feedback-content');
            if (this._feedbackBlurHandler) {
                oldContents.forEach(el => {
                    el.removeEventListener('blur', this._feedbackBlurHandler);
                });
            }

            this.feedbackContent.innerHTML = data.feedback.map((item, idx) => `
                <div class="feedback-section" data-index="${idx}">
                    <h3><span class="feedback-module-icon" aria-hidden="true">${this._getModuleIcon(item.module)}</span>【${escapeHtml(item.module)}】</h3>
                    <div class="feedback-content" contenteditable="true" role="textbox" aria-multiline="true" aria-label="编辑 ${escapeHtml(item.module)} 模块内容" data-index="${idx}">${escapeHtml(item.content)}</div>
                    <div class="feedback-edit-hint">💡 点击上方内容可直接编辑</div>
                </div>
            `).join('');

            this._feedbackBlurHandler = (e) => {
                const el = e.currentTarget;
                const idx = parseInt(el.dataset.index);
                if (this.currentFeedback && this.currentFeedback[idx]) {
                    this.currentFeedback[idx].content = el.innerText;
                }
                if (this._groupFeedbackData && this._groupCurrentIndex !== undefined) {
                    const studentData = this._groupFeedbackData[this._groupCurrentIndex];
                    if (studentData && studentData.feedback[idx]) {
                        studentData.feedback[idx].content = el.innerText;
                    }
                }
                // 持久化保存编辑后的反馈
                this._persistFeedbackEdit();
            };

            // 使用新渲染的元素列表，避免重复查询
            this.feedbackContent.querySelectorAll('.feedback-content').forEach(el => {
                el.addEventListener('blur', this._feedbackBlurHandler);
            });
        }
    }

    _bindGroupNavButtons() {
        // 使用 onclick 属性绑定，避免 cloneNode 方案的不可靠性
        // onclick 每次赋值会覆盖之前的处理器，天然防止重复绑定
        const prevBtn = document.getElementById('group-nav-prev');
        const nextBtn = document.getElementById('group-nav-next');
        if (prevBtn) {
            prevBtn.onclick = () => this._prevGroupStudent();
        }
        if (nextBtn) {
            nextBtn.onclick = () => this._nextGroupStudent();
        }
    }

    _prevGroupStudent() {
        if (this._groupCurrentIndex > 0) {
            this._showGroupStudent(this._groupCurrentIndex - 1);
        }
    }

    _nextGroupStudent() {
        if (this._groupFeedbackData && this._groupCurrentIndex < this._groupFeedbackData.length - 1) {
            this._showGroupStudent(this._groupCurrentIndex + 1);
        }
    }

    _getDateStr(style) {
        if (style && style.useCustomDate && style.customDate) {
            const parts = style.customDate.split('-');
            if (parts.length === 3) return `${parseInt(parts[1])}.${parseInt(parts[2])}`;
            return style.customDate;
        }
        const now = new Date();
        return `${now.getMonth() + 1}.${now.getDate()}`;
    }

    _getModuleIcon(moduleName) {
        const iconMap = {
            '课堂内容': '📖',
            '课堂表现': '🌟',
            '薄弱环节': '⚠️',
            '课后作业': '📝',
            '后续计划': '🎯',
            '家长建议': '👨‍👩‍👧',
            '学习计划': '📋'
        };
        return iconMap[moduleName] || '📌';
    }

    _showEditSavedHint() {
        // 复制操作时不弹保存提示
        if (this._isCopying) return;
        // 防抖：避免频繁弹出提示
        if (this._editSavedTimer) return;
        UI.showToast('✅ 已保存修改', 1500);
        this._editSavedTimer = setTimeout(() => {
            this._editSavedTimer = null;
        }, 2000);
    }

    /**
     * 持久化保存编辑后的反馈到 localStorage
     */
    _persistFeedbackEdit() {
        if (!this.currentFeedback) return;

        let studentId = null;
        if (this._groupFeedbackData && this._groupCurrentIndex !== undefined) {
            const studentData = this._groupFeedbackData[this._groupCurrentIndex];
            if (studentData && this.currentGroup) {
                // 精确匹配 → 模糊匹配（仅允许AI省略姓氏，不允许短名匹配长名）
                let student = this.currentGroup
                    .map(id => store.getStudentById(id))
                    .find(s => s && s.name === studentData.studentName);
                if (!student) {
                    student = this.currentGroup
                        .map(id => store.getStudentById(id))
                        .find(s => s && (s.name.endsWith(studentData.studentName) && studentData.studentName.length >= 2));
                }
                if (student) studentId = student.id;
            }
        } else if (this.currentStudent) {
            studentId = this.currentStudent.id;
        }

        if (studentId && this._currentFeedbackId) {
            store.updateFeedback(studentId, this._currentFeedbackId, this.currentFeedback);
            this._showEditSavedHint();
        }
    }
}

window.app = new App();
window.app.init().catch(err => {
    console.error('[App] 初始化失败:', err);
    // 即使初始化失败，也尝试渲染页面（使用降级数据）
    try {
        app.initElements();
        app.bindEvents();
        app.navigate('students');
    } catch (e) {
        document.body.innerHTML = '<div style="padding:40px;text-align:center;"><h2>应用加载失败</h2><p>请刷新页面重试，如问题持续请清除浏览器数据。</p></div>';
    }
});
