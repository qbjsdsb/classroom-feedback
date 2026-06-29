// historyPage.js - 历史反馈页

class HistoryPage {
    constructor() {
        this.container = document.getElementById('history-page');
        this._subjectFilter = null; // null=全部, subjectId=按科目筛选
        this._dateFilter = 'all'; // 'all', '7d', '30d', '90d'
        this._lastStudentId = null; // 追踪学生切换
    }

    render() {
        const student = app.currentStudent;
        if (!student) {
            this._subjectFilter = null;
            this._lastStudentId = null;
            this.container.innerHTML = `
                <header>
                    <button class="back-btn" onclick="app.navigate('record')" aria-label="返回课堂录音">←</button>
                    <h1>📋 历史反馈</h1>
                </header>
                <div class="empty-state">
                    <div class="empty-state-icon">📋</div>
                    <p>请先选择学生</p>
                </div>
            `;
            return;
        }

        // 切换学生时重置科目筛选
        if (student.id !== this._lastStudentId) {
            this._subjectFilter = null;
            this._dateFilter = 'all';
            this._lastStudentId = student.id;
        }

        const allHistory = store.getFeedbackHistory(student.id);
        const subjects = store.getSubjects();
        const subjectMap = {};
        subjects.forEach(s => subjectMap[s.id] = s);

        // P4-3: 单次遍历统计每个科目的反馈数，避免后续 subjects.map 内对每个科目再 O(history) 过滤
        // 原实现 O(subjects × history)，新实现 O(history)
        const subjectCounts = {};
        for (const item of allHistory) {
            subjectCounts[item.subjectId] = (subjectCounts[item.subjectId] || 0) + 1;
        }

        // 按科目筛选
        let filtered = this._subjectFilter
            ? allHistory.filter(item => item.subjectId === this._subjectFilter)
            : allHistory;

        // 按日期筛选
        if (this._dateFilter !== 'all') {
            const now = Date.now();
            const daysMap = { '7d': 7, '30d': 30, '90d': 90 };
            const days = daysMap[this._dateFilter] || 0;
            if (days > 0) {
                const cutoff = now - days * 24 * 60 * 60 * 1000;
                filtered = filtered.filter(item => new Date(item.createdAt).getTime() >= cutoff);
            }
        }

        const history = filtered;

        // 科目+日期筛选栏
        const filterBar = allHistory.length > 0 ? `
            <div class="history-filter-bar">
                <div class="history-filter-row">
                    <span class="history-filter-label">科目</span>
                    <button class="history-filter-chip ${!this._subjectFilter ? 'active' : ''}" onclick="historyPage.filterBySubject(null)">全部</button>
                    ${subjects.map(s => {
                        const count = subjectCounts[s.id] || 0;
                        return count > 0 ? `<button class="history-filter-chip ${this._subjectFilter === s.id ? 'active' : ''}" style="--chip-color:${escapeHtml(s.color)}" onclick="historyPage.filterBySubject('${escapeHtml(s.id)}')">${escapeHtml(s.name)} (${count})</button>` : '';
                    }).join('')}
                </div>
                <div class="history-filter-row" style="margin-top:6px;">
                    <span class="history-filter-label">时间</span>
                    <button class="history-filter-chip ${this._dateFilter === 'all' ? 'active' : ''}" onclick="historyPage.filterByDate('all')">全部</button>
                    <button class="history-filter-chip ${this._dateFilter === '7d' ? 'active' : ''}" onclick="historyPage.filterByDate('7d')">近7天</button>
                    <button class="history-filter-chip ${this._dateFilter === '30d' ? 'active' : ''}" onclick="historyPage.filterByDate('30d')">近30天</button>
                    <button class="history-filter-chip ${this._dateFilter === '90d' ? 'active' : ''}" onclick="historyPage.filterByDate('90d')">近90天</button>
                </div>
            </div>
        ` : '';

        this.container.innerHTML = `
            <header>
                <button class="back-btn" onclick="app.navigate('record')" aria-label="返回课堂录音">←</button>
                <h1>📋 ${escapeHtml(student.name)} 的历史反馈</h1>
            </header>

            ${filterBar}

            ${history.length > 0 ? `
            <div class="history-actions-bar" style="margin-bottom:16px;display:flex;flex-direction:column;gap:8px;">
                <button class="primary-btn" onclick="historyPage.generateSummary()">📊 生成学习总结</button>
                <div style="display:flex;gap:8px;">
                    <button class="secondary-btn" style="flex:1;" onclick="historyPage.exportAll()">📤 导出全部</button>
                    <button class="secondary-btn" style="flex:1;" onclick="historyPage.exportSelected()">📋 导出近期</button>
                </div>
            </div>
            ` : ''}

            <div class="history-list">
                ${history.length === 0 ? `
                    <div class="empty-state">
                        <div class="empty-state-icon">📋</div>
                        <p>${this._subjectFilter ? '该科目暂无历史反馈' : '暂无历史反馈'}</p>
                        ${this._subjectFilter ? `<button class="empty-state-action" onclick="historyPage.filterBySubject(null)">查看全部反馈</button>` : `<button class="empty-state-action" onclick="app.navigate('record')">去生成第一条反馈</button>`}
                    </div>
                ` : this.renderGroupedByDate(history, subjectMap)}
            </div>
        `;

        this.bindEvents();
    }

    renderGroupedByDate(history, subjectMap) {
        // 按日期分组
        const groups = {};
        const today = new Date();
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);

        history.forEach(item => {
            const date = new Date(item.createdAt);
            const dateKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
            const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
            const yesterdayKey = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;

            // 判断日期标签
            let label;
            if (dateKey === todayKey) {
                label = '今天';
            } else if (dateKey === yesterdayKey) {
                label = '昨天';
            } else {
                label = `${date.getMonth() + 1}月${date.getDate()}日`;
            }

            if (!groups[dateKey]) {
                groups[dateKey] = { label, date: dateKey, items: [] };
            }
            groups[dateKey].items.push(item);
        });

        // 按日期降序排列
        const sortedKeys = Object.keys(groups).sort((a, b) => b.localeCompare(a));

        return sortedKeys.map(key => {
            const group = groups[key];
            return `
                <div class="history-date-group">
                    <div class="history-date-label">
                        <span class="date-label-text">${group.label}</span>
                        <span class="date-label-count">${group.items.length}条反馈</span>
                    </div>
                    <div class="history-date-items">
                        ${group.items.map(item => this.renderHistoryItem(item, subjectMap)).join('')}
                    </div>
                </div>
            `;
        }).join('');
    }

    renderHistoryItem(item, subjectMap) {
        const subject = subjectMap[item.subjectId];
        const date = new Date(item.createdAt);
        const dateStr = `${date.getMonth() + 1}月${date.getDate()}日 ${date.getHours()}:${date.getMinutes().toString().padStart(2, '0')}`;

        // 取第一个模块的内容作为摘要
        const rawContent = item.feedback && item.feedback[0] ? item.feedback[0].content : '';
        const summary = rawContent
            ? escapeHtml(rawContent.length > 60 ? rawContent.substring(0, 60) + '...' : rawContent)
            : '无内容';

        return `
            <div class="history-item" data-id="${item.id}" style="--subject-color: ${subject?.color || 'var(--primary)'}">
                <div class="history-header">
                    <span class="history-subject" style="color: ${escapeHtml(subject?.color) || 'var(--text-muted)'}">
                        ${subject ? '📚 ' + escapeHtml(subject.name) : '📝 未分类'}
                    </span>
                    <span class="history-date">${dateStr}</span>
                </div>
                <div class="history-summary">${summary}</div>
                <div class="history-actions">
                    <button class="history-view-btn" onclick="historyPage.viewDetail('${item.id}')">查看详情</button>
                    <button class="history-delete-btn" onclick="historyPage.deleteItem('${item.id}')">删除</button>
                </div>
            </div>
        `;
    }

    viewDetail(feedbackId) {
        const student = app.currentStudent;
        if (!student) return;
        const history = store.getFeedbackHistory(student.id);
        const item = history.find(h => h.id === feedbackId);
        if (!item) return;

        const subjects = store.getSubjects();
        const subject = subjects.find(s => s.id === item.subjectId);
        const date = new Date(item.createdAt);
        const dateStr = `${date.getFullYear()}-${(date.getMonth()+1).toString().padStart(2,'0')}-${date.getDate().toString().padStart(2,'0')} ${date.getHours()}:${date.getMinutes().toString().padStart(2,'0')}`;

        const feedbackHtml = (item.feedback || []).map(f => `
            <div class="feedback-section">
                <h3>【${escapeHtml(f.module)}】</h3>
                <p>${escapeHtml(f.content)}</p>
            </div>
        `).join('');

        UI.showBottomSheet(`
            <div class="history-detail">
                <div class="detail-header">
                    <h3>${escapeHtml(subject ? subject.name : '未分类')} - ${dateStr}</h3>
                    <button onclick="UI.closeBottomSheet()" class="close-btn" aria-label="关闭">&times;</button>
                </div>
                <div class="detail-content">
                    ${feedbackHtml}
                </div>
                <button class="primary-btn" onclick="historyPage.copyFeedback('${feedbackId}')">📋 复制此反馈</button>
            </div>
        `);
    }

    copyFeedback(feedbackId) {
        const student = app.currentStudent;
        if (!student) return;
        const history = store.getFeedbackHistory(student.id);
        const item = history.find(h => h.id === feedbackId);
        if (!item) return;

        // 生成标题
        const date = new Date(item.createdAt);
        const dateStr = `${date.getMonth() + 1}.${date.getDate()}`;
        const style = Storage.getStyle();
        const shortName = style.nameShorten !== false && student.name.length >= 3
            ? student.name.slice(-2) : student.name;
        const subject = item.subjectId ? store.getSubjects().find(s => s.id === item.subjectId) : null;
        const subjectName = subject ? subject.name : '';
        const trialPart = student.isTrial ? '试听' : '';
        const subjectFull = trialPart ? `${subjectName}${trialPart}` : subjectName;
        const title = [dateStr, shortName, subjectFull, '课堂反馈'].filter(p => p).join('');

        const body = (item.feedback || []).map(f => `【${f.module}】\n${f.content}`).join('\n\n');
        const text = `${title}\n\n${body}`;
        this._copyToClipboard(text);
    }

    /** 安全复制到剪贴板，兼容非HTTPS环境 */
    _copyToClipboard(text) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(() => {
                UI.showToast('已复制到剪贴板');
            }).catch(() => {
                this._fallbackCopy(text);
            });
        } else {
            this._fallbackCopy(text);
        }
    }

    _fallbackCopy(text) {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        document.body.appendChild(textarea);
        textarea.select();
        try {
            document.execCommand('copy');
            UI.showToast('已复制到剪贴板');
        } catch (e) {
            UI.showToast('复制失败，请手动复制');
        }
        document.body.removeChild(textarea);
    }

    /** 按科目筛选历史反馈 */
    filterBySubject(subjectId) {
        this._subjectFilter = subjectId;
        this.render();
    }

    /** 按日期筛选历史反馈 */
    filterByDate(range) {
        this._dateFilter = range;
        this.render();
    }

    deleteItem(feedbackId) {
        UI.showConfirm('确定删除这条反馈记录？', () => {
            const student = app.currentStudent;
            if (student) {
                const snapshot = store.softDeleteFeedback(student.id, feedbackId);
                this.render();
                if (snapshot) {
                    UI.showUndoToast('已删除反馈', () => {
                        store.restoreFeedback(snapshot);
                        this.render();
                    });
                }
            }
        });
    }

    exportAll() {
        const student = app.currentStudent;
        if (!student) return;
        const history = store.getFeedbackHistory(student.id);
        this._doExport(history, `${student.name}_全部反馈`);
    }

    exportSelected() {
        const student = app.currentStudent;
        if (!student) return;
        const history = store.getFeedbackHistory(student.id);
        // 简化处理：导出最近10条
        const recent = history.slice(0, 10);
        this._doExport(recent, `${student.name}_近期反馈`);
    }

    _doExport(items, filename) {
        if (items.length === 0) {
            UI.showToast('没有可导出的反馈');
            return;
        }
        const subjects = store.getSubjects();
        const subjectMap = {};
        subjects.forEach(s => subjectMap[s.id] = s);

        let text = `课堂反馈记录\n================\n\n`;
        items.forEach(item => {
            const subject = subjectMap[item.subjectId];
            const date = new Date(item.createdAt);
            const dateStr = `${date.getFullYear()}-${(date.getMonth()+1).toString().padStart(2,'0')}-${date.getDate().toString().padStart(2,'0')}`;
            text += `【${dateStr}】${subject ? subject.name : '未分类'}\n`;
            text += '─'.repeat(30) + '\n';
            (item.feedback || []).forEach(f => {
                text += `【${f.module}】\n${f.content}\n\n`;
            });
            text += '\n';
        });

        const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${filename}_${new Date().toISOString().split('T')[0]}.txt`;
        a.click();
        URL.revokeObjectURL(url);
        UI.showToast(`已导出 ${items.length} 条反馈`);
    }

    async generateSummary() {
        const student = app.currentStudent;
        if (!student) return;

        const apiKey = Storage.getApiKey();
        if (!apiKey) {
            UI.showToast('请先设置 API Key');
            app.openSettings();
            return;
        }

        const history = store.getFeedbackHistory(student.id, 20);
        if (history.length === 0) {
            UI.showToast('暂无历史反馈，无法生成总结');
            return;
        }

        // AbortController：支持用户取消 + 60s 超时自动取消，避免网络挂起时永久锁屏
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 60000);
        const onCancel = () => {
            clearTimeout(timeoutId);
            try { controller.abort(); } catch (e) {}
            UI.showToast('已取消生成', 'info');
        };
        UI.showLoading('正在分析学习情况，请稍候...', onCancel);

        try {
            // 构建历史反馈摘要（控制总长度，避免API超限）
            const MAX_SUMMARY_LENGTH = 8000; // 历史摘要最大字符数
            let feedbackSummary = '';
            let totalLength = 0;

            for (let i = 0; i < Math.min(history.length, 15); i++) {
                const item = history[i];
                const subject = store.getSubjectById(item.subjectId);
                const date = new Date(item.createdAt);
                const dateStr = `${date.getMonth() + 1}月${date.getDate()}日`;
                // 每条反馈控制长度，超长文本课程的反馈可能很长
                const content = (item.feedback || []).map(f => {
                    const moduleText = `${f.module}：${f.content.substring(0, 60)}`;
                    return moduleText;
                }).join('\n');
                const entry = `第${i + 1}次课（${dateStr} ${subject ? subject.name : '未分类'}）：\n${content}`;

                if (totalLength + entry.length > MAX_SUMMARY_LENGTH) {
                    feedbackSummary += '\n\n...（更多历史记录已省略）';
                    break;
                }
                feedbackSummary += (i > 0 ? '\n\n' : '') + entry;
                totalLength += entry.length + 2;
            }

            const prompt = `你是一位专业的教育培训老师，需要根据学生的课堂反馈历史，生成一份学习总结报告。

## 学生信息
- 姓名：${student.name}
- 反馈次数：${history.length}次

## 历史反馈记录
${feedbackSummary}

## 生成要求
请生成一份结构化的学习总结，包含以下内容：
1. 整体学习情况概述（2-3句话）
2. 主要进步点（列举2-3点）
3. 需要加强的方面（列举2-3点）
4. 后续学习建议（具体可行）

语气要求：
- 客观中肯，既有肯定也有建议
- 不要编造未提及的内容
- 总字数控制在300-500字

## 输出格式
请按以下格式输出：

【整体情况】
（内容）

【主要进步】
（内容）

【需要加强】
（内容）

【后续建议】
（内容）`;

            const content = await AI.chatCompletion([
                { role: 'system', content: '你是一位经验丰富的教育培训老师，擅长分析学生学习情况并给出专业建议。' },
                { role: 'user', content: prompt }
            ], { temperature: 0.7, maxTokens: 1500, signal: controller.signal });

            // 解析总结内容
            const summary = this.parseSummary(content);
            this.showSummaryModal(summary, student.name);

        } catch (err) {
            // 用户主动取消或超时取消，不显示错误（取消时已通过 onCancel Toast 提示）
            if (err.name !== 'AbortError') {
                UI.showToast('生成总结失败：' + err.message);
            }
        } finally {
            clearTimeout(timeoutId);
            UI.hideLoading();
        }
    }

    parseSummary(content) {
        const KNOWN_SECTIONS = ['整体情况', '主要进步', '需要加强', '后续建议'];
        const sections = [];
        const lines = content.split('\n');
        let currentSection = null;
        let currentContent = [];

        for (const line of lines) {
            const match = line.match(/【(.+)】/);
            if (match && KNOWN_SECTIONS.includes(match[1].trim())) {
                // 只识别已知模块名，避免AI在内容中使用【注意】等标记截断当前模块
                if (currentSection) {
                    sections.push({
                        title: currentSection,
                        content: currentContent.join('\n').trim()
                    });
                }
                currentSection = match[1].trim();
                currentContent = [];
            } else if (currentSection && line.trim()) {
                currentContent.push(line);
            }
        }

        if (currentSection) {
            sections.push({
                title: currentSection,
                content: currentContent.join('\n').trim()
            });
        }

        return sections;
    }

    showSummaryModal(summary, studentName) {
        const summaryHtml = summary.map(s => `
            <div class="feedback-section">
                <h3>【${escapeHtml(s.title)}】</h3>
                <div class="feedback-content">${escapeHtml(s.content)}</div>
            </div>
        `).join('');

        UI.showBottomSheet(`
            <div class="history-detail">
                <div class="detail-header">
                    <h3>📊 ${escapeHtml(studentName)} 的学习总结</h3>
                    <button onclick="UI.closeBottomSheet()" class="close-btn" aria-label="关闭">&times;</button>
                </div>
                <div class="detail-content">
                    ${summaryHtml}
                </div>
                <button class="primary-btn" onclick="historyPage.copySummary()">📋 复制总结</button>
            </div>
        `);

        // 保存当前总结到临时变量
        this.currentSummary = summary;
        this.currentSummaryStudent = studentName;
    }

    copySummary() {
        if (!this.currentSummary) return;
        const text = this.currentSummary.map(s => `【${s.title}】\n${s.content}`).join('\n\n');
        const fullText = `${this.currentSummaryStudent} 的学习总结\n\n${text}`;
        this._copyToClipboard(fullText);
    }

    bindEvents() {}
}

const historyPage = new HistoryPage();
