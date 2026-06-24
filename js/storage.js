// storage.js - 数据管理（IndexedDB + 内存缓存）

const DEFAULT_MODULES = [
    { name: '课堂内容', enabled: true, custom: false },
    { name: '课堂表现', enabled: true, custom: false },
    { name: '薄弱环节', enabled: true, custom: false },
    { name: '课后作业', enabled: true, custom: false },
    { name: '后续计划', enabled: false, custom: false }
];

// 按模块的默认字数限制
const DEFAULT_MODULE_LENGTHS = {
    '课堂内容': { min: 50, max: 150 },
    '课堂表现': { min: 50, max: 150 },
    '薄弱环节': { min: 50, max: 150 },
    '课后作业': { min: 50, max: 100 },
    '后续计划': { min: 50, max: 150 }
};

const DEFAULT_STYLE = {
    tone: 'formal', // friendly, formal, concise, detailed
    useEmoji: false,        // 默认关闭表情
    emojiPosition: 'content', // content(内容中), title(标题后), end(模块末尾), none(不使用)
    customPrompt: '',
    language: 'zh',
    // 全局字数限制（后备值）
    minLength: 50,          // 每模块最少字数
    maxLength: 150,         // 每模块最多字数
    // 按模块字数限制
    moduleLengths: JSON.parse(JSON.stringify(DEFAULT_MODULE_LENGTHS)),
    // 输出格式
    useBulletPoints: false, // 是否允许分点输出
    // 姓名截取
    nameShorten: true,      // 是否截取姓名（三字名取后两字）
    // 家长协助
    includeParentHelp: false, // 是否包含"请家长协助"内容
    // 严格遵循输入
    strictInput: true,       // 严格基于输入内容，不编造
    // 日期设置
    useCustomDate: false,    // 是否使用自定义日期
    customDate: ''           // 自定义日期（YYYY-MM-DD格式）
};

const DEFAULT_THEME = 'default'; // default, dark, warm, green

class Storage {
    static _cache = {};
    static _initialized = false;

    /**
     * 异步初始化：从 IndexedDB 加载所有 key-value 数据到内存缓存
     */
    static async init() {
        await DB.init();
        try {
            const allKv = await DB.getAll('keyvalue');
            for (const item of allKv) {
                this._cache[item.key] = item.value;
            }
        } catch (e) {
            console.warn('[Storage] 从 IndexedDB 加载缓存失败，尝试从 localStorage 加载:', e);
            this._loadFallbackFromLocalStorage();
        }
        this._initialized = true;
    }

    /**
     * IndexedDB 不可用时的降级方案：从 localStorage 加载到缓存
     */
    static _loadFallbackFromLocalStorage() {
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith('cf_') && !DB.LS_ONLY_KEYS.includes(key)) {
                const value = localStorage.getItem(key);
                if (value !== null) {
                    this._cache[key] = DB._parseLSValue(value);
                }
            }
        }
    }

    // ===== 内部读写方法 =====

    static _getCache(key) {
        return this._cache[key];
    }

    static _setCache(key, value) {
        this._cache[key] = value;
        DB.set(key, value).catch(e => console.warn('[Storage] IDB 写入失败:', e));
    }

    static _removeCache(key) {
        delete this._cache[key];
        DB.remove(key).catch(e => console.warn('[Storage] IDB 删除失败:', e));
    }

    // ===== 公共 API（保持同步签名） =====

    static getApiKey() {
        return this._getCache('cf_api_key') || '';
    }

    static setApiKey(key) {
        this._setCache('cf_api_key', key);
    }

    static getApiBaseUrl() {
        return this._getCache('cf_api_base_url') || '';
    }

    static setApiBaseUrl(url) {
        this._setCache('cf_api_base_url', url);
    }

    static getModules() {
        const data = this._getCache('cf_modules');
        if (!data) return JSON.parse(JSON.stringify(DEFAULT_MODULES));
        return data;
    }

    static saveModules(modules) {
        this._setCache('cf_modules', modules);
    }

    static addModule(name, description = '') {
        const modules = this.getModules();
        modules.push({ name, enabled: true, custom: true, description });
        this.saveModules(modules);
    }

    static toggleModule(index) {
        const modules = this.getModules();
        if (modules[index]) {
            modules[index].enabled = !modules[index].enabled;
            this.saveModules(modules);
        }
    }

    static deleteModule(index) {
        const modules = this.getModules();
        modules.splice(index, 1);
        this.saveModules(modules);
    }

    static swapModule(index, direction) {
        const modules = this.getModules();
        const targetIndex = index + direction;
        if (targetIndex < 0 || targetIndex >= modules.length) return;
        [modules[index], modules[targetIndex]] = [modules[targetIndex], modules[index]];
        this.saveModules(modules);
    }

    // 反馈风格设置
    static getStyle() {
        const data = this._getCache('cf_style');
        if (!data) return JSON.parse(JSON.stringify(DEFAULT_STYLE));
        const style = (typeof data === 'string') ? JSON.parse(data) : data;
        const defaults = JSON.parse(JSON.stringify(DEFAULT_STYLE));
        // 深度合并 moduleLengths：
        // 1. 确保每个模块都存在（新增模块不会丢失）
        // 2. 每个模块的 min/max 逐字段合并（防止只存了 min 丢失 max）
        if (style.moduleLengths) {
            for (const [modName, savedLen] of Object.entries(style.moduleLengths)) {
                if (defaults.moduleLengths[modName]) {
                    defaults.moduleLengths[modName] = {
                        ...defaults.moduleLengths[modName],
                        ...savedLen
                    };
                } else {
                    defaults.moduleLengths[modName] = { ...savedLen };
                }
            }
        }
        const result = { ...defaults, ...style, moduleLengths: defaults.moduleLengths };
        // 迁移：如果全局 maxLength 仍是旧值 300，更新为 150
        if (result.maxLength === 300) result.maxLength = 150;
        return result;
    }

    static saveStyle(style) {
        this._setCache('cf_style', style);
    }

    // 获取指定模块的字数限制
    static getModuleLength(moduleName, style) {
        const lengths = style?.moduleLengths || DEFAULT_MODULE_LENGTHS;
        return lengths[moduleName] || { min: style?.minLength || 50, max: style?.maxLength || 150 };
    }

    // 语音识别配置
    static getSpeechConfig() {
        const data = this._getCache('cf_speech_config');
        if (!data) return { provider: 'browser', apiKey: '', secretKey: '', appId: '' };
        return data;
    }

    static saveSpeechConfig(config) {
        this._setCache('cf_speech_config', config);
    }

    // 主题设置
    static getTheme() {
        return this._getCache('cf_theme') || DEFAULT_THEME;
    }

    static setTheme(theme) {
        this._setCache('cf_theme', theme);
        document.documentElement.setAttribute('data-theme', theme === 'default' ? '' : theme);
    }

    static initTheme() {
        const theme = this.getTheme();
        if (theme && theme !== 'default') {
            document.documentElement.setAttribute('data-theme', theme);
        }
    }

    static reset() {
        // 清空内存缓存
        this._cache = {};

        // 清空 DataStore 内存缓存（通过全局 store 实例）
        if (typeof store !== 'undefined' && store) {
            store._students = [];
            store._subjects = [];
            store._studentSubjects = {};
            store._feedbackCache = {};
            store._templatesCache = {};
            store._subjectTemplatesCache = {};
            store._quickRepliesCache = null;
        }

        // 清空所有 IndexedDB stores
        const storeNames = ['keyvalue', 'students', 'subjects', 'studentSubjects',
            'feedback', 'templates', 'subjectTemplates', 'quickReplies'];
        for (const name of storeNames) {
            DB.clearStore(name).catch(e => console.warn(`[Storage] 清空 ${name} 失败:`, e));
        }

        // 清除 localStorage 中所有 cf_ 键
        const keysToRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith('cf_')) {
                keysToRemove.push(key);
            }
        }
        keysToRemove.forEach(key => localStorage.removeItem(key));
    }

    // 备份时间记录
    static getLastBackupTime() {
        const val = this._getCache('cf_last_backup_time');
        return val != null ? parseInt(val) : null;
    }

    static setLastBackupTime(timestamp) {
        const val = timestamp || Date.now();
        this._setCache('cf_last_backup_time', val);
    }

    /** 检查是否需要备份提醒（超过7天未备份） */
    static needsBackupReminder() {
        const last = this.getLastBackupTime();
        if (!last) return true; // 从未备份
        const daysSince = (Date.now() - last) / (1000 * 60 * 60 * 24);
        return daysSince >= 7;
    }
}
