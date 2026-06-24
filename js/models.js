// models.js - 数据模型与内存缓存（IndexedDB 后端）

const DEFAULT_SUBJECTS = [
    { id: 'sub_chin', name: '语文', color: '#EF4444', order: 0 },
    { id: 'sub_math', name: '数学', color: '#6366F1', order: 1 },
    { id: 'sub_eng',  name: '英语', color: '#10B981', order: 2 },
    { id: 'sub_poli', name: '政治', color: '#F97316', order: 3 },
    { id: 'sub_hist', name: '历史', color: '#8B5CF6', order: 4 },
    { id: 'sub_geog', name: '地理', color: '#06B6D4', order: 5 },
    { id: 'sub_phys', name: '物理', color: '#F59E0B', order: 6 },
    { id: 'sub_chem', name: '化学', color: '#EC4899', order: 7 },
    { id: 'sub_bio',  name: '生物', color: '#14B8A6', order: 8 }
];

class DataStore {
    constructor() {
        this._students = [];
        this._subjects = [];
        this._studentSubjects = {};
        this._feedbackCache = {};
        this._templatesCache = {};
        this._subjectTemplatesCache = {};
        this._quickRepliesCache = null;
        this._promptTemplatesCache = [];
        // 不再在构造函数中调用 _init()，改为异步 init()
    }

    /**
     * 异步初始化：从 IndexedDB 加载所有数据到内存缓存
     */
    async init() {
        try {
            // 加载学生
            this._students = await DB.getAll('students');

            // 加载科目
            this._subjects = await DB.getAll('subjects');

            // 加载学生-科目关联
            const ssMappings = await DB.getAll('studentSubjects');
            this._studentSubjects = {};
            for (const m of ssMappings) {
                this._studentSubjects[m.studentId] = m.subjectIds;
            }

            // 加载反馈历史
            const allFeedback = await DB.getAll('feedback');
            this._feedbackCache = {};
            for (const f of allFeedback) {
                this._feedbackCache[f.studentId] = f.history;
            }

            // 加载学生模板
            const allTemplates = await DB.getAll('templates');
            this._templatesCache = {};
            for (const t of allTemplates) {
                this._templatesCache[t.studentId] = t.templates;
            }

            // 加载科目模板
            const allSubjectTemplates = await DB.getAll('subjectTemplates');
            this._subjectTemplatesCache = {};
            for (const st of allSubjectTemplates) {
                this._subjectTemplatesCache[st.subjectId] = st.template;
            }

            // 加载快捷回复
            const qrRecord = await DB.getRecord('quickReplies', 'main');
            this._quickRepliesCache = qrRecord ? qrRecord.replies : null;

            // 加载 Prompt 模板
            this._promptTemplatesCache = await DB.getAll('promptTemplates');
        } catch (e) {
            console.warn('[DataStore] 从 IndexedDB 加载数据失败，尝试 localStorage 降级:', e);
            this._loadFallbackFromLocalStorage();
        }

        // 迁移：补充缺失的默认科目
        this._migrateDefaultSubjects();

        // 初始化默认 Prompt 模板
        this.initDefaultPromptTemplates();
    }

    /**
     * IndexedDB 不可用时的降级方案：从 localStorage 加载到缓存
     */
    _loadFallbackFromLocalStorage() {
        // 学生
        const studentsRaw = localStorage.getItem('cf_students');
        try { this._students = studentsRaw ? JSON.parse(studentsRaw) : []; } catch { this._students = []; }

        // 科目
        const subjectsRaw = localStorage.getItem('cf_subjects');
        try { this._subjects = subjectsRaw ? JSON.parse(subjectsRaw) : this._getDefaultSubjects(); } catch { this._subjects = this._getDefaultSubjects(); }

        // 学生-科目关联
        const ssRaw = localStorage.getItem('cf_student_subjects');
        try { this._studentSubjects = ssRaw ? JSON.parse(ssRaw) : {}; } catch { this._studentSubjects = {}; }

        // 反馈、模板、快捷回复在降级模式下仍从 localStorage 读取
        this._feedbackCache = {};
        this._templatesCache = {};
        this._subjectTemplatesCache = {};
        this._quickRepliesCache = null;
        this._promptTemplatesCache = [];
    }

    // === 学生 CRUD ===

    _saveStudents() {
        DB.putRecords('students', this._students).catch(e =>
            console.warn('[DataStore] 保存学生失败:', e)
        );
    }

    getStudents() {
        return [...this._students].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
    }

    getStudentById(id) {
        return this._students.find(s => s.id === id);
    }

    searchStudents(query, grade) {
        const q = query.trim().toLowerCase();
        let result = this._students;
        // 按年级筛选
        if (grade) {
            result = result.filter(s => s.grade === grade);
        }
        // 按姓名搜索
        if (q) {
            result = result.filter(s => s.name.toLowerCase().includes(q));
        }
        return [...result].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
    }

    addStudent(name, isTrial = false, grade = '') {
        const student = {
            id: `stu_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
            name: name.trim(),
            isTrial: isTrial,
            grade: grade,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        this._students.push(student);
        this._saveStudents();
        return student;
    }

    updateStudent(id, updates) {
        const idx = this._students.findIndex(s => s.id === id);
        if (idx === -1) return null;
        this._students[idx] = {
            ...this._students[idx],
            ...updates,
            updatedAt: new Date().toISOString()
        };
        this._saveStudents();
        return this._students[idx];
    }

    deleteStudent(id) {
        const idx = this._students.findIndex(s => s.id === id);
        if (idx === -1) return false;
        this._students.splice(idx, 1);
        this._saveStudents();
        this.removeStudentSubjects(id);
        // 从缓存和 IndexedDB 中删除反馈和模板
        delete this._feedbackCache[id];
        delete this._templatesCache[id];
        DB.deleteRecord('feedback', id).catch(e => {});
        DB.deleteRecord('templates', id).catch(e => {});
        return true;
    }

    /**
     * 软删除学生（缓存数据用于撤销恢复）
     * @returns {Object|null} 被删除的学生数据快照，用于 restoreStudent
     */
    softDeleteStudent(id) {
        const idx = this._students.findIndex(s => s.id === id);
        if (idx === -1) return null;
        const student = { ...this._students[idx] };
        const subjects = this._studentSubjects[id] ? [...this._studentSubjects[id]] : [];
        const feedback = this._feedbackCache[id] ? [...this._feedbackCache[id]] : null;
        const templates = this._templatesCache[id] ? [...this._templatesCache[id]] : null;
        // 执行删除
        this._students.splice(idx, 1);
        this._saveStudents();
        this.removeStudentSubjects(id);
        delete this._feedbackCache[id];
        delete this._templatesCache[id];
        DB.deleteRecord('feedback', id).catch(e => {});
        DB.deleteRecord('templates', id).catch(e => {});
        // 返回快照
        return { student, subjects, feedback, templates };
    }

    /**
     * 恢复被软删除的学生
     * @param {Object} snapshot - softDeleteStudent 返回的快照
     */
    restoreStudent(snapshot) {
        if (!snapshot || !snapshot.student) return false;
        // 防止重复恢复
        if (this._students.some(s => s.id === snapshot.student.id)) return false;
        this._students.push(snapshot.student);
        this._saveStudents();
        if (snapshot.subjects && snapshot.subjects.length > 0) {
            this._studentSubjects[snapshot.student.id] = snapshot.subjects;
            this._saveStudentSubjects();
        }
        if (snapshot.feedback) {
            this._feedbackCache[snapshot.student.id] = snapshot.feedback;
            DB.putRecord('feedback', { studentId: snapshot.student.id, history: snapshot.feedback }).catch(e => {});
        }
        if (snapshot.templates) {
            this._templatesCache[snapshot.student.id] = snapshot.templates;
            DB.putRecord('templates', { studentId: snapshot.student.id, templates: snapshot.templates }).catch(e => {});
        }
        return true;
    }

    // === 科目管理 ===

    _getDefaultSubjects() {
        return JSON.parse(JSON.stringify(DEFAULT_SUBJECTS));
    }

    _migrateDefaultSubjects() {
        let changed = false;
        for (const def of DEFAULT_SUBJECTS) {
            if (!this._subjects.some(s => s.id === def.id)) {
                this._subjects.push({ ...def, order: this._subjects.length });
                changed = true;
            }
        }
        if (changed) this._saveSubjects();
    }

    _saveSubjects() {
        DB.putRecords('subjects', this._subjects).catch(e =>
            console.warn('[DataStore] 保存科目失败:', e)
        );
    }

    getSubjects() {
        return [...this._subjects].sort((a, b) => a.order - b.order);
    }

    getSubjectById(id) {
        return this._subjects.find(s => s.id === id);
    }

    addSubject(name, color) {
        const subject = {
            id: `sub_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
            name: name.trim(),
            color: color || '#6366F1',
            order: this._subjects.length
        };
        this._subjects.push(subject);
        this._saveSubjects();
        return subject;
    }

    updateSubject(id, updates) {
        const idx = this._subjects.findIndex(s => s.id === id);
        if (idx === -1) return null;
        this._subjects[idx] = { ...this._subjects[idx], ...updates };
        this._saveSubjects();
        return this._subjects[idx];
    }

    deleteSubject(id) {
        const idx = this._subjects.findIndex(s => s.id === id);
        if (idx === -1) return false;
        this._subjects.splice(idx, 1);
        this._subjects.forEach((s, i) => s.order = i);
        this._saveSubjects();
        // 清理学生关联
        Object.keys(this._studentSubjects).forEach(sid => {
            this._studentSubjects[sid] = this._studentSubjects[sid].filter(subId => subId !== id);
        });
        this._saveStudentSubjects();
        return true;
    }

    // === 学生-科目关联 ===

    _saveStudentSubjects() {
        const records = Object.entries(this._studentSubjects).map(([studentId, subjectIds]) => ({
            studentId, subjectIds
        }));
        DB.putRecords('studentSubjects', records).catch(e =>
            console.warn('[DataStore] 保存学生科目关联失败:', e)
        );
    }

    getStudentSubjects(studentId) {
        const subjectIds = this._studentSubjects[studentId] || [];
        return subjectIds.map(id => this.getSubjectById(id)).filter(Boolean);
    }

    setStudentSubjects(studentId, subjectIds) {
        this._studentSubjects[studentId] = [...subjectIds];
        this._saveStudentSubjects();
    }

    removeStudentSubjects(studentId) {
        delete this._studentSubjects[studentId];
        this._saveStudentSubjects();
    }

    // === 反馈历史 ===

    getFeedbackHistory(studentId, limit = 50) {
        const history = this._feedbackCache[studentId] || [];
        return [...history]
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
            .slice(0, limit);
    }

    addFeedback(studentId, feedbackData) {
        let history = this._feedbackCache[studentId] || [];
        history.push({
            ...feedbackData,
            id: `fb_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
            createdAt: new Date().toISOString()
        });
        // 保留最近50条
        if (history.length > 50) history = history.slice(history.length - 50);
        this._feedbackCache[studentId] = history;
        DB.putRecord('feedback', { studentId, history }).catch(e =>
            console.warn('[DataStore] 保存反馈失败:', e)
        );
        return history[history.length - 1];
    }

    /**
     * 更新反馈内容（编辑后持久化）
     */
    updateFeedback(studentId, feedbackId, updatedFeedback) {
        const history = this._feedbackCache[studentId];
        if (!history) return false;
        const item = history.find(f => f.id === feedbackId);
        if (!item) return false;
        item.feedback = updatedFeedback;
        DB.putRecord('feedback', { studentId, history }).catch(e =>
            console.warn('[DataStore] 更新反馈失败:', e)
        );
        return true;
    }

    deleteFeedback(studentId, feedbackId) {
        const history = this._feedbackCache[studentId];
        if (!history) return false;
        const newHistory = history.filter(f => f.id !== feedbackId);
        this._feedbackCache[studentId] = newHistory;
        DB.putRecord('feedback', { studentId, history: newHistory }).catch(e =>
            console.warn('[DataStore] 删除反馈失败:', e)
        );
        return true;
    }

    /**
     * 软删除反馈记录（缓存数据用于撤销恢复）
     * @returns {Object|null} 被删除的反馈快照
     */
    softDeleteFeedback(studentId, feedbackId) {
        const history = this._feedbackCache[studentId];
        if (!history) return null;
        const feedback = history.find(f => f.id === feedbackId);
        if (!feedback) return null;
        const newHistory = history.filter(f => f.id !== feedbackId);
        this._feedbackCache[studentId] = newHistory;
        DB.putRecord('feedback', { studentId, history: newHistory }).catch(e => {});
        return { studentId, feedback };
    }

    /**
     * 恢复被软删除的反馈记录
     * @param {Object} snapshot - softDeleteFeedback 返回的快照
     */
    restoreFeedback(snapshot) {
        if (!snapshot || !snapshot.studentId || !snapshot.feedback) return false;
        let history = this._feedbackCache[snapshot.studentId] || [];
        // 防止重复恢复：检查是否已存在同 ID 的反馈
        if (history.some(f => f.id === snapshot.feedback.id)) return false;
        history.unshift(snapshot.feedback);
        this._feedbackCache[snapshot.studentId] = history;
        DB.putRecord('feedback', { studentId: snapshot.studentId, history }).catch(e => {});
        return true;
    }

    // === 学生常用点评模板 ===

    getStudentTemplates(studentId) {
        return this._templatesCache[studentId] ? [...this._templatesCache[studentId]] : [];
    }

    addStudentTemplate(studentId, content) {
        const templates = this._templatesCache[studentId] || [];
        const template = {
            id: `tmpl_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
            content: content.trim(),
            createdAt: new Date().toISOString()
        };
        templates.push(template);
        this._templatesCache[studentId] = templates;
        DB.putRecord('templates', { studentId, templates }).catch(e =>
            console.warn('[DataStore] 保存学生模板失败:', e)
        );
        return template;
    }

    deleteStudentTemplate(studentId, templateId) {
        let templates = this._templatesCache[studentId] || [];
        templates = templates.filter(t => t.id !== templateId);
        this._templatesCache[studentId] = templates;
        DB.putRecord('templates', { studentId, templates }).catch(e =>
            console.warn('[DataStore] 删除学生模板失败:', e)
        );
        return true;
    }

    // === 科目专属反馈模板 ===

    getSubjectTemplate(subjectId) {
        return this._subjectTemplatesCache[subjectId] || null;
    }

    setSubjectTemplate(subjectId, template) {
        this._subjectTemplatesCache[subjectId] = template;
        DB.putRecord('subjectTemplates', { subjectId, template }).catch(e =>
            console.warn('[DataStore] 保存科目模板失败:', e)
        );
    }

    deleteSubjectTemplate(subjectId) {
        delete this._subjectTemplatesCache[subjectId];
        DB.deleteRecord('subjectTemplates', subjectId).catch(e =>
            console.warn('[DataStore] 删除科目模板失败:', e)
        );
    }

    // === 全局快捷回复库 ===

    getQuickReplies() {
        if (this._quickRepliesCache !== null && this._quickRepliesCache !== undefined) {
            return [...this._quickRepliesCache];
        }
        return this._getDefaultQuickReplies();
    }

    _getDefaultQuickReplies() {
        return [
            { id: 'qr_1', content: '本节课表现积极，能够主动参与课堂互动。', category: '表扬' },
            { id: 'qr_2', content: '课堂专注度较高，知识点掌握扎实。', category: '表扬' },
            { id: 'qr_3', content: '课后需要加强练习，巩固本节课内容。', category: '建议' },
            { id: 'qr_4', content: '作业完成认真，思路清晰，继续保持。', category: '作业' },
            { id: 'qr_5', content: '本节课内容较难，需要课后复习消化。', category: '建议' },
            { id: 'qr_6', content: '课堂互动较少，建议多提问多思考。', category: '建议' }
        ];
    }

    saveQuickReplies(replies) {
        this._quickRepliesCache = replies;
        DB.putRecord('quickReplies', { id: 'main', replies }).catch(e =>
            console.warn('[DataStore] 保存快捷回复失败:', e)
        );
    }

    addQuickReply(content, category) {
        const replies = this.getQuickReplies();
        const reply = {
            id: `qr_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
            content: content.trim(),
            category: category || '自定义'
        };
        replies.push(reply);
        this.saveQuickReplies(replies);
        return reply;
    }

    deleteQuickReply(replyId) {
        let replies = this.getQuickReplies();
        replies = replies.filter(r => r.id !== replyId);
        this.saveQuickReplies(replies);
        return true;
    }

    restoreQuickReply(reply) {
        const replies = this.getQuickReplies();
        // 防止重复恢复
        if (replies.some(r => r.id === reply.id)) return false;
        replies.push(reply);
        this.saveQuickReplies(replies);
        return true;
    }

    // === Prompt 模板库 ===

    _savePromptTemplates() {
        DB.putRecords('promptTemplates', this._promptTemplatesCache).catch(e =>
            console.warn('[DataStore] 保存 Prompt 模板失败:', e)
        );
    }

    getPromptTemplates() {
        return [...this._promptTemplatesCache].sort((a, b) => {
            // 先按分类排序，再按名称排序
            if (a.category !== b.category) return a.category.localeCompare(b.category, 'zh-CN');
            return a.name.localeCompare(b.name, 'zh-CN');
        });
    }

    getPromptTemplateById(id) {
        return this._promptTemplatesCache.find(t => t.id === id);
    }

    addPromptTemplate(template) {
        const now = new Date().toISOString();
        const newTemplate = {
            id: `pt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
            name: template.name.trim(),
            description: (template.description || '').trim(),
            category: template.category || '反馈风格',
            prompt: template.prompt.trim(),
            modules: template.modules || null,
            isDefault: false,
            createdAt: now,
            updatedAt: now
        };
        this._promptTemplatesCache.push(newTemplate);
        this._savePromptTemplates();
        return newTemplate;
    }

    updatePromptTemplate(id, updates) {
        const idx = this._promptTemplatesCache.findIndex(t => t.id === id);
        if (idx === -1) return null;
        this._promptTemplatesCache[idx] = {
            ...this._promptTemplatesCache[idx],
            ...updates,
            updatedAt: new Date().toISOString()
        };
        this._savePromptTemplates();
        return this._promptTemplatesCache[idx];
    }

    deletePromptTemplate(id) {
        const idx = this._promptTemplatesCache.findIndex(t => t.id === id);
        if (idx === -1) return false;
        // 预置模板不可删除
        if (this._promptTemplatesCache[idx].isDefault) return false;
        this._promptTemplatesCache.splice(idx, 1);
        this._savePromptTemplates();
        return true;
    }

    getDefaultPromptTemplates() {
        return [
            {
                id: 'pt_default_problem',
                name: '问题导向型',
                description: '侧重发现和解决问题，适合需要改进的学生',
                category: '反馈风格',
                prompt: '请侧重发现学生存在的问题并提出具体的改进建议，用客观中肯的语气，明确指出薄弱环节，给出可操作的改进方案和学习建议。',
                modules: null,
                isDefault: true,
                createdAt: '2026-06-24T00:00:00.000Z',
                updatedAt: '2026-06-24T00:00:00.000Z'
            },
            {
                id: 'pt_default_parent',
                name: '家长沟通型',
                description: '正式语气，适合与家长沟通',
                category: '家长沟通',
                prompt: '请使用正式、专业的语气撰写反馈，适合发给家长阅读。措辞严谨规范，既体现教师专业素养，又让家长清晰了解学生情况。避免过于口语化的表达。',
                modules: null,
                isDefault: true,
                createdAt: '2026-06-24T00:00:00.000Z',
                updatedAt: '2026-06-24T00:00:00.000Z'
            },
            {
                id: 'pt_default_math',
                name: '数学学科',
                description: '数学专属反馈，侧重解题思路和计算准确性',
                category: '学科特色',
                prompt: '请侧重数学学科特点，重点关注：解题思路是否清晰、计算过程是否准确、公式运用是否正确、逻辑推理是否严密。鼓励学生多角度思考问题，培养数学思维。',
                modules: null,
                isDefault: true,
                createdAt: '2026-06-24T00:00:00.000Z',
                updatedAt: '2026-06-24T00:00:00.000Z'
            },
            {
                id: 'pt_default_english',
                name: '英语学科',
                description: '英语专属反馈，侧重语言技能和表达能力',
                category: '学科特色',
                prompt: '请侧重英语学科特点，重点关注：词汇掌握情况、语法运用是否正确、听说读写各项技能表现、语言表达能力。鼓励学生多开口练习，注重语感培养。',
                modules: null,
                isDefault: true,
                createdAt: '2026-06-24T00:00:00.000Z',
                updatedAt: '2026-06-24T00:00:00.000Z'
            }
        ];
    }

    initDefaultPromptTemplates() {
        // 移除已废弃的默认模板（与语气设置重复）
        const deprecatedIds = ['pt_default_praise', 'pt_default_concise'];
        let changed = false;
        for (const depId of deprecatedIds) {
            const idx = this._promptTemplatesCache.findIndex(t => t.id === depId);
            if (idx !== -1) {
                this._promptTemplatesCache.splice(idx, 1);
                changed = true;
            }
        }

        if (this._promptTemplatesCache.length === 0) {
            const defaults = this.getDefaultPromptTemplates();
            this._promptTemplatesCache = [...defaults];
            changed = true;
        } else {
            // 补充缺失的默认模板（新增默认模板时自动添加）
            const defaults = this.getDefaultPromptTemplates();
            for (const def of defaults) {
                if (!this._promptTemplatesCache.some(t => t.id === def.id)) {
                    this._promptTemplatesCache.push({ ...def });
                    changed = true;
                }
            }
        }

        if (changed) this._savePromptTemplates();
    }
}

const store = new DataStore();
