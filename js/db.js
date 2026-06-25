// db.js - IndexedDB 封装层，支持 localStorage 自动迁移

class DB {
    static DB_NAME = 'classroom-feedback';
    static DB_VERSION = 2;
    static _db = null;

    // 需要迁移到 IndexedDB 的简单 key-value 键名
    static KV_KEYS = [
        'cf_api_key', 'cf_api_base_url', 'cf_modules', 'cf_style',
        'cf_speech_config', 'cf_theme', 'cf_last_backup_time'
    ];

    // 需要迁移到 IndexedDB 的集合键名
    static COLLECTION_KEYS = [
        'cf_students', 'cf_subjects', 'cf_student_subjects', 'cf_quick_replies', 'cf_prompt_templates'
    ];

    // 需要迁移到 IndexedDB 的键前缀
    static KEY_PREFIXES = [
        'cf_feedback_', 'cf_templates_', 'cf_subject_template_'
    ];

    // 保留在 localStorage 的键名（临时数据，不迁移）
    static LS_ONLY_KEYS = ['cf_class_durations', 'cf_draft_transcript'];

    /**
     * 初始化 IndexedDB，必要时执行 localStorage 迁移
     */
    static async init() {
        if (!window.indexedDB) {
            console.warn('[DB] IndexedDB 不可用，数据将仅存储在内存中');
            return;
        }

        try {
            await this._openDB();
            const migrated = await this.get('cf_migrated');
            if (!migrated) {
                await this._migrateFromLocalStorage();
            } else {
                // 已迁移过，检查是否有新的 localStorage 数据需要重新迁移（如数据导入）
                await this._checkReMigration();
            }
        } catch (e) {
            console.error('[DB] 初始化失败:', e);
        }
    }

    /**
     * 打开 IndexedDB 数据库
     */
    static _openDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                const stores = [
                    { name: 'keyvalue', keyPath: 'key' },
                    { name: 'students', keyPath: 'id' },
                    { name: 'subjects', keyPath: 'id' },
                    { name: 'studentSubjects', keyPath: 'studentId' },
                    { name: 'feedback', keyPath: 'studentId' },
                    { name: 'templates', keyPath: 'studentId' },
                    { name: 'subjectTemplates', keyPath: 'subjectId' },
                    { name: 'quickReplies', keyPath: 'id' },
                    { name: 'promptTemplates', keyPath: 'id' }
                ];
                for (const { name, keyPath } of stores) {
                    if (!db.objectStoreNames.contains(name)) {
                        db.createObjectStore(name, { keyPath });
                    }
                }
            };

            request.onsuccess = (event) => {
                this._db = event.target.result;
                resolve();
            };

            request.onerror = (event) => {
                console.error('[DB] 打开数据库失败:', event.target.error);
                reject(event.target.error);
            };
        });
    }

    // ===== Key-Value 操作 =====

    static async get(key) {
        if (!this._db) return undefined;
        return new Promise((resolve, reject) => {
            const tx = this._db.transaction('keyvalue', 'readonly');
            const store = tx.objectStore('keyvalue');
            const request = store.get(key);
            request.onsuccess = () => resolve(request.result ? request.result.value : undefined);
            request.onerror = () => reject(request.error);
        });
    }

    static async set(key, value) {
        if (!this._db) return;
        return new Promise((resolve, reject) => {
            const tx = this._db.transaction('keyvalue', 'readwrite');
            const store = tx.objectStore('keyvalue');
            const request = store.put({ key, value });
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    static async remove(key) {
        if (!this._db) return;
        return new Promise((resolve, reject) => {
            const tx = this._db.transaction('keyvalue', 'readwrite');
            const store = tx.objectStore('keyvalue');
            const request = store.delete(key);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    // ===== 通用 Object Store 操作 =====

    static async getAll(storeName) {
        if (!this._db) return [];
        return new Promise((resolve, reject) => {
            const tx = this._db.transaction(storeName, 'readonly');
            const store = tx.objectStore(storeName);
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
        });
    }

    static async getRecord(storeName, key) {
        if (!this._db) return null;
        return new Promise((resolve, reject) => {
            const tx = this._db.transaction(storeName, 'readonly');
            const store = tx.objectStore(storeName);
            const request = store.get(key);
            request.onsuccess = () => resolve(request.result || null);
            request.onerror = () => reject(request.error);
        });
    }

    static async putRecord(storeName, record) {
        if (!this._db) return;
        return new Promise((resolve, reject) => {
            const tx = this._db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            const request = store.put(record);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    /**
     * 清空 store 并批量写入记录（单事务，原子操作）
     */
    static async putRecords(storeName, records) {
        if (!this._db) return;
        return new Promise((resolve, reject) => {
            const tx = this._db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            store.clear();
            for (const record of records) {
                store.put(record);
            }
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    static async deleteRecord(storeName, key) {
        if (!this._db) return;
        return new Promise((resolve, reject) => {
            const tx = this._db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            const request = store.delete(key);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    static async clearStore(storeName) {
        if (!this._db) return;
        return new Promise((resolve, reject) => {
            const tx = this._db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            const request = store.clear();
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }

    // ===== 迁移逻辑 =====

    /**
     * 判断一个 localStorage 键是否属于 IndexedDB 管理范围
     */
    static _isIDBManagedKey(key) {
        if (this.LS_ONLY_KEYS.includes(key)) return false;
        if (this.KV_KEYS.includes(key)) return true;
        if (this.COLLECTION_KEYS.includes(key)) return true;
        for (const prefix of this.KEY_PREFIXES) {
            if (key.startsWith(prefix)) return true;
        }
        return false;
    }

    /**
     * 收集所有需要迁移的 cf_ 键
     */
    static _collectCFKeys() {
        const keys = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith('cf_') && this._isIDBManagedKey(key)) {
                keys.push(key);
            }
        }
        return keys;
    }

    /**
     * 解析 localStorage 值（尝试 JSON 解析，失败则返回原始字符串）
     */
    static _parseLSValue(value) {
        if (value === null) return undefined;
        try {
            return JSON.parse(value);
        } catch {
            return value;
        }
    }

    /**
     * 首次迁移：将所有 localStorage 数据迁移到 IndexedDB
     */
    static async _migrateFromLocalStorage() {
        const cfKeys = this._collectCFKeys();
        if (cfKeys.length === 0) {
            await this.set('cf_migrated', true);
            return;
        }

        console.log(`[DB] 开始迁移 ${cfKeys.length} 个 localStorage 键到 IndexedDB...`);

        try {
            // 1. 简单 key-value 对
            for (const key of this.KV_KEYS) {
                const value = localStorage.getItem(key);
                if (value !== null) {
                    await this.set(key, this._parseLSValue(value));
                }
            }

            // 2. 学生
            const studentsRaw = localStorage.getItem('cf_students');
            if (studentsRaw) {
                const students = this._parseLSValue(studentsRaw);
                if (Array.isArray(students)) {
                    for (const student of students) {
                        await this.putRecord('students', student);
                    }
                }
            }

            // 3. 科目
            const subjectsRaw = localStorage.getItem('cf_subjects');
            if (subjectsRaw) {
                const subjects = this._parseLSValue(subjectsRaw);
                if (Array.isArray(subjects)) {
                    for (const subject of subjects) {
                        await this.putRecord('subjects', subject);
                    }
                }
            }

            // 4. 学生-科目关联
            const ssRaw = localStorage.getItem('cf_student_subjects');
            if (ssRaw) {
                const ss = this._parseLSValue(ssRaw);
                if (ss && typeof ss === 'object') {
                    for (const [studentId, subjectIds] of Object.entries(ss)) {
                        await this.putRecord('studentSubjects', { studentId, subjectIds });
                    }
                }
            }

            // 5. 反馈历史（cf_feedback_{studentId}）
            for (const key of cfKeys) {
                if (key.startsWith('cf_feedback_')) {
                    const studentId = key.slice('cf_feedback_'.length);
                    const raw = localStorage.getItem(key);
                    if (raw) {
                        const history = this._parseLSValue(raw);
                        if (Array.isArray(history)) {
                            await this.putRecord('feedback', { studentId, history });
                        }
                    }
                }
            }

            // 6. 学生模板（cf_templates_{studentId}）
            for (const key of cfKeys) {
                if (key.startsWith('cf_templates_')) {
                    const studentId = key.slice('cf_templates_'.length);
                    const raw = localStorage.getItem(key);
                    if (raw) {
                        const templates = this._parseLSValue(raw);
                        if (Array.isArray(templates)) {
                            await this.putRecord('templates', { studentId, templates });
                        }
                    }
                }
            }

            // 7. 科目模板（cf_subject_template_{subjectId}）
            for (const key of cfKeys) {
                if (key.startsWith('cf_subject_template_')) {
                    const subjectId = key.slice('cf_subject_template_'.length);
                    const raw = localStorage.getItem(key);
                    if (raw) {
                        const template = this._parseLSValue(raw);
                        await this.putRecord('subjectTemplates', { subjectId, template });
                    }
                }
            }

            // 8. 快捷回复
            const qrRaw = localStorage.getItem('cf_quick_replies');
            if (qrRaw) {
                const replies = this._parseLSValue(qrRaw);
                if (Array.isArray(replies)) {
                    await this.putRecord('quickReplies', { id: 'main', replies });
                }
            }

            // 9. Prompt 模板库
            const ptRaw = localStorage.getItem('cf_prompt_templates');
            if (ptRaw) {
                const templates = this._parseLSValue(ptRaw);
                if (Array.isArray(templates)) {
                    await this.putRecords('promptTemplates', templates);
                }
            }

            // 标记迁移完成，并清除失败计数
            await this.set('cf_migrated', true);
            await this.remove('cf_migration_attempts');

            // 清除已迁移的 localStorage 键
            for (const key of cfKeys) {
                localStorage.removeItem(key);
            }

            console.log(`[DB] 迁移完成，已清除 ${cfKeys.length} 个 localStorage 键`);
        } catch (e) {
            console.error('[DB] 迁移失败:', e);
            // 迁移失败时不标记 cf_migrated，下次启动可重试
            // 用 attempts 计数避免无限重试；超过 3 次后停止并保留 localStorage 数据供用户导出
            const attempts = (await this.get('cf_migration_attempts') || 0) + 1;
            await this.set('cf_migration_attempts', attempts);
            if (attempts >= 3) {
                await this.set('cf_migrated', true);
                console.error(`[DB] 迁移已失败 ${attempts} 次，停止自动重试。localStorage 数据已保留，请导出后排查问题。`);
            } else {
                console.warn(`[DB] 迁移失败（第 ${attempts} 次），下次启动将重试`);
            }
        }
    }

    /**
     * 检查是否需要重新迁移（处理数据导入等场景）
     * 导入功能会直接写 localStorage，页面刷新后需要将数据同步到 IndexedDB
     */
    static async _checkReMigration() {
        const cfKeys = this._collectCFKeys();
        if (cfKeys.length === 0) return;

        // 仅在显式导入标志触发时执行覆盖式迁移
        // 否则只清理孤儿 localStorage 键，避免用旧数据覆盖 IDB 最新数据
        const pendingImport = localStorage.getItem('cf_pending_import') === 'true';
        if (!pendingImport) {
            console.warn(`[DB] 检测到 ${cfKeys.length} 个孤儿 localStorage 键（非导入触发），仅清理不覆盖`);
            for (const key of cfKeys) {
                localStorage.removeItem(key);
            }
            return;
        }

        console.log(`[DB] 检测到导入触发，开始将 ${cfKeys.length} 个 localStorage 键同步到 IndexedDB`);

        try {
            // 简单 key-value 对
            for (const key of this.KV_KEYS) {
                const value = localStorage.getItem(key);
                if (value !== null) {
                    await this.set(key, this._parseLSValue(value));
                }
            }

            // 学生（覆盖式写入）
            const studentsRaw = localStorage.getItem('cf_students');
            if (studentsRaw) {
                const students = this._parseLSValue(studentsRaw);
                if (Array.isArray(students)) {
                    await this.putRecords('students', students);
                }
            }

            // 科目
            const subjectsRaw = localStorage.getItem('cf_subjects');
            if (subjectsRaw) {
                const subjects = this._parseLSValue(subjectsRaw);
                if (Array.isArray(subjects)) {
                    await this.putRecords('subjects', subjects);
                }
            }

            // 学生-科目关联
            const ssRaw = localStorage.getItem('cf_student_subjects');
            if (ssRaw) {
                const ss = this._parseLSValue(ssRaw);
                if (ss && typeof ss === 'object') {
                    const records = Object.entries(ss).map(([studentId, subjectIds]) => ({
                        studentId, subjectIds
                    }));
                    await this.putRecords('studentSubjects', records);
                }
            }

            // 反馈历史
            for (const key of cfKeys) {
                if (key.startsWith('cf_feedback_')) {
                    const studentId = key.slice('cf_feedback_'.length);
                    const raw = localStorage.getItem(key);
                    if (raw) {
                        const history = this._parseLSValue(raw);
                        if (Array.isArray(history)) {
                            await this.putRecord('feedback', { studentId, history });
                        }
                    }
                }
            }

            // 学生模板
            for (const key of cfKeys) {
                if (key.startsWith('cf_templates_')) {
                    const studentId = key.slice('cf_templates_'.length);
                    const raw = localStorage.getItem(key);
                    if (raw) {
                        const templates = this._parseLSValue(raw);
                        if (Array.isArray(templates)) {
                            await this.putRecord('templates', { studentId, templates });
                        }
                    }
                }
            }

            // 科目模板
            for (const key of cfKeys) {
                if (key.startsWith('cf_subject_template_')) {
                    const subjectId = key.slice('cf_subject_template_'.length);
                    const raw = localStorage.getItem(key);
                    if (raw) {
                        const template = this._parseLSValue(raw);
                        await this.putRecord('subjectTemplates', { subjectId, template });
                    }
                }
            }

            // 快捷回复
            const qrRaw = localStorage.getItem('cf_quick_replies');
            if (qrRaw) {
                const replies = this._parseLSValue(qrRaw);
                if (Array.isArray(replies)) {
                    await this.putRecord('quickReplies', { id: 'main', replies });
                }
            }

            // Prompt 模板库
            const ptRaw = localStorage.getItem('cf_prompt_templates');
            if (ptRaw) {
                const templates = this._parseLSValue(ptRaw);
                if (Array.isArray(templates)) {
                    await this.putRecords('promptTemplates', templates);
                }
            }

            // 清除已迁移的 localStorage 键
            for (const key of cfKeys) {
                localStorage.removeItem(key);
            }

            // 清除导入标志
            localStorage.removeItem('cf_pending_import');

            console.log(`[DB] 重新迁移完成，已清除 ${cfKeys.length} 个 localStorage 键`);
        } catch (e) {
            console.error('[DB] 重新迁移失败:', e);
            // 保留导入标志，下次启动重试；提示用户如反复失败需手动排查
            console.warn('[DB] 导入标志已保留，下次启动将重试。如反复失败请检查 IndexedDB 配额或权限。');
        }
    }
}
