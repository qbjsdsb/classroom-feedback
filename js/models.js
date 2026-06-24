// models.js - 数据模型与内存缓存

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
        this._students = null;
        this._subjects = null;
        this._studentSubjects = null;
        this._init();
    }

    _init() {
        this._loadStudents();
        this._loadSubjects();
        this._loadStudentSubjects();
    }

    // === 学生 CRUD ===

    _loadStudents() {
        const raw = localStorage.getItem('cf_students');
        try {
            this._students = raw ? JSON.parse(raw) : [];
        } catch {
            this._students = [];
        }
        return this._students;
    }

    _saveStudents() {
        try { localStorage.setItem('cf_students', JSON.stringify(this._students)); } catch (e) {}
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
        localStorage.removeItem(`cf_feedback_${id}`);
        localStorage.removeItem(`cf_templates_${id}`);
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
        const feedbackRaw = localStorage.getItem(`cf_feedback_${id}`);
        const templatesRaw = localStorage.getItem(`cf_templates_${id}`);
        // 执行删除
        this._students.splice(idx, 1);
        this._saveStudents();
        this.removeStudentSubjects(id);
        localStorage.removeItem(`cf_feedback_${id}`);
        localStorage.removeItem(`cf_templates_${id}`);
        // 返回快照
        return { student, subjects, feedbackRaw, templatesRaw };
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
        if (snapshot.feedbackRaw) {
            try { localStorage.setItem(`cf_feedback_${snapshot.student.id}`, snapshot.feedbackRaw); } catch (e) {}
        }
        if (snapshot.templatesRaw) {
            try { localStorage.setItem(`cf_templates_${snapshot.student.id}`, snapshot.templatesRaw); } catch (e) {}
        }
        return true;
    }

    // === 科目管理 ===

    _loadSubjects() {
        const raw = localStorage.getItem('cf_subjects');
        try {
            this._subjects = raw ? JSON.parse(raw) : this._getDefaultSubjects();
        } catch {
            this._subjects = this._getDefaultSubjects();
        }
        // 迁移：补充缺失的默认科目（已有用户数据中可能缺少新增科目）
        this._migrateDefaultSubjects();
        return this._subjects;
    }

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
        try { localStorage.setItem('cf_subjects', JSON.stringify(this._subjects)); } catch (e) {}
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

    _loadStudentSubjects() {
        const raw = localStorage.getItem('cf_student_subjects');
        try {
            this._studentSubjects = raw ? JSON.parse(raw) : {};
        } catch {
            this._studentSubjects = {};
        }
        return this._studentSubjects;
    }

    _saveStudentSubjects() {
        try { localStorage.setItem('cf_student_subjects', JSON.stringify(this._studentSubjects)); } catch (e) {}
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
        const raw = localStorage.getItem(`cf_feedback_${studentId}`);
        let history = [];
        try {
            history = raw ? JSON.parse(raw) : [];
        } catch {
            history = [];
        }
        return history
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
            .slice(0, limit);
    }

    addFeedback(studentId, feedbackData) {
        const raw = localStorage.getItem(`cf_feedback_${studentId}`);
        let history = [];
        try {
            history = raw ? JSON.parse(raw) : [];
        } catch {
            history = [];
        }
        history.push({
            ...feedbackData,
            id: `fb_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
            createdAt: new Date().toISOString()
        });
        // 保留最近50条，超长文本课程可能需要更多历史记录
        if (history.length > 50) history = history.slice(history.length - 50);
        try { localStorage.setItem(`cf_feedback_${studentId}`, JSON.stringify(history)); } catch (e) {}
        // 存储空间告警
        this._checkStorageQuota();
        return history[history.length - 1];
    }

    // 检查 localStorage 存储空间
    _checkStorageQuota() {
        try {
            let total = 0;
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                const val = localStorage.getItem(key);
                total += (key.length + (val ? val.length : 0)) * 2; // UTF-16
            }
            // 超过 4MB 时告警（5MB限制留有余地）
            if (total > 4 * 1024 * 1024) {
                console.warn('[Storage] 存储空间使用量较大:', (total / 1024 / 1024).toFixed(1) + 'MB');
                setTimeout(() => {
                    UI.showToast('⚠️ 存储空间已使用超过4MB，建议导出备份后清空不需要的历史数据');
                }, 500);
            }
        } catch(e) {
            // 静默失败
        }
    }

    /**
     * 更新反馈内容（编辑后持久化）
     */
    updateFeedback(studentId, feedbackId, updatedFeedback) {
        const raw = localStorage.getItem(`cf_feedback_${studentId}`);
        if (!raw) return false;
        let history = [];
        try {
            history = JSON.parse(raw);
        } catch {
            return false;
        }
        const item = history.find(f => f.id === feedbackId);
        if (!item) return false;
        item.feedback = updatedFeedback;
        try { localStorage.setItem(`cf_feedback_${studentId}`, JSON.stringify(history)); } catch (e) {}
        return true;
    }

    deleteFeedback(studentId, feedbackId) {
        const raw = localStorage.getItem(`cf_feedback_${studentId}`);
        if (!raw) return false;
        let history = [];
        try {
            history = JSON.parse(raw);
        } catch {
            return false;
        }
        history = history.filter(f => f.id !== feedbackId);
        try { localStorage.setItem(`cf_feedback_${studentId}`, JSON.stringify(history)); } catch (e) {}
        return true;
    }

    /**
     * 软删除反馈记录（缓存数据用于撤销恢复）
     * @returns {Object|null} 被删除的反馈快照
     */
    softDeleteFeedback(studentId, feedbackId) {
        const raw = localStorage.getItem(`cf_feedback_${studentId}`);
        if (!raw) return null;
        let history = [];
        try {
            history = JSON.parse(raw);
        } catch {
            return null;
        }
        const feedback = history.find(f => f.id === feedbackId);
        if (!feedback) return null;
        history = history.filter(f => f.id !== feedbackId);
        try { localStorage.setItem(`cf_feedback_${studentId}`, JSON.stringify(history)); } catch (e) {}
        return { studentId, feedback };
    }

    /**
     * 恢复被软删除的反馈记录
     * @param {Object} snapshot - softDeleteFeedback 返回的快照
     */
    restoreFeedback(snapshot) {
        if (!snapshot || !snapshot.studentId || !snapshot.feedback) return false;
        const raw = localStorage.getItem(`cf_feedback_${snapshot.studentId}`);
        let history = [];
        try {
            history = raw ? JSON.parse(raw) : [];
        } catch {
            history = [];
        }
        // 防止重复恢复：检查是否已存在同 ID 的反馈
        if (history.some(f => f.id === snapshot.feedback.id)) return false;
        history.unshift(snapshot.feedback);
        try { localStorage.setItem(`cf_feedback_${snapshot.studentId}`, JSON.stringify(history)); } catch (e) {}
        return true;
    }

    // === 学生常用点评模板 ===
    getStudentTemplates(studentId) {
        const raw = localStorage.getItem(`cf_templates_${studentId}`);
        try {
            return raw ? JSON.parse(raw) : [];
        } catch {
            return [];
        }
    }

    addStudentTemplate(studentId, content) {
        const templates = this.getStudentTemplates(studentId);
        const template = {
            id: `tmpl_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
            content: content.trim(),
            createdAt: new Date().toISOString()
        };
        templates.push(template);
        try { localStorage.setItem(`cf_templates_${studentId}`, JSON.stringify(templates)); } catch (e) {}
        return template;
    }

    deleteStudentTemplate(studentId, templateId) {
        let templates = this.getStudentTemplates(studentId);
        templates = templates.filter(t => t.id !== templateId);
        try { localStorage.setItem(`cf_templates_${studentId}`, JSON.stringify(templates)); } catch (e) {}
        return true;
    }

    // === 科目专属反馈模板 ===
    getSubjectTemplate(subjectId) {
        const raw = localStorage.getItem(`cf_subject_template_${subjectId}`);
        try {
            return raw ? JSON.parse(raw) : null;
        } catch {
            return null;
        }
    }

    setSubjectTemplate(subjectId, template) {
        try { localStorage.setItem(`cf_subject_template_${subjectId}`, JSON.stringify(template)); } catch (e) {}
    }

    deleteSubjectTemplate(subjectId) {
        localStorage.removeItem(`cf_subject_template_${subjectId}`);
    }

    // === 全局快捷回复库 ===
    getQuickReplies() {
        const raw = localStorage.getItem('cf_quick_replies');
        try {
            return raw ? JSON.parse(raw) : this._getDefaultQuickReplies();
        } catch {
            return this._getDefaultQuickReplies();
        }
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
        try { localStorage.setItem('cf_quick_replies', JSON.stringify(replies)); } catch (e) {}
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
}

const store = new DataStore();
