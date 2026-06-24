// storage.js - localStorage 数据管理

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
    static getApiKey() {
        return localStorage.getItem('cf_api_key') || '';
    }
    
    static setApiKey(key) {
        try { localStorage.setItem('cf_api_key', key); } catch (e) {}
    }
    
    static getApiBaseUrl() {
        return localStorage.getItem('cf_api_base_url') || '';
    }
    
    static setApiBaseUrl(url) {
        try { localStorage.setItem('cf_api_base_url', url); } catch (e) {}
    }
    
    static getModules() {
        try {
            const data = localStorage.getItem('cf_modules');
            return data ? JSON.parse(data) : JSON.parse(JSON.stringify(DEFAULT_MODULES));
        } catch {
            return JSON.parse(JSON.stringify(DEFAULT_MODULES));
        }
    }
    
    static saveModules(modules) {
        try { localStorage.setItem('cf_modules', JSON.stringify(modules)); } catch (e) {}
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
        try {
            const data = localStorage.getItem('cf_style');
            if (!data) return JSON.parse(JSON.stringify(DEFAULT_STYLE));
            const style = JSON.parse(data);
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
        } catch {
            return JSON.parse(JSON.stringify(DEFAULT_STYLE));
        }
    }

    static saveStyle(style) {
        try { localStorage.setItem('cf_style', JSON.stringify(style)); } catch (e) {}
    }
    
    // 获取指定模块的字数限制
    static getModuleLength(moduleName, style) {
        const lengths = style?.moduleLengths || DEFAULT_MODULE_LENGTHS;
        return lengths[moduleName] || { min: style?.minLength || 50, max: style?.maxLength || 150 };
    }
    
    // 语音识别配置
    static getSpeechConfig() {
        try {
            const data = localStorage.getItem('cf_speech_config');
            return data ? JSON.parse(data) : { provider: 'browser', apiKey: '', secretKey: '', appId: '' };
        } catch {
            return { provider: 'browser', apiKey: '', secretKey: '', appId: '' };
        }
    }

    static saveSpeechConfig(config) {
        try { localStorage.setItem('cf_speech_config', JSON.stringify(config)); } catch (e) {}
    }

    // 主题设置
    static getTheme() {
        return localStorage.getItem('cf_theme') || DEFAULT_THEME;
    }

    static setTheme(theme) {
        try {
            localStorage.setItem('cf_theme', theme);
            document.documentElement.setAttribute('data-theme', theme === 'default' ? '' : theme);
        } catch (e) {}
    }

    static initTheme() {
        const theme = this.getTheme();
        if (theme && theme !== 'default') {
            document.documentElement.setAttribute('data-theme', theme);
        }
    }

    static reset() {
        // 清除所有以 cf_ 开头的存储键，包括动态键如 cf_feedback_{id}、cf_templates_{id} 等
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
        const val = localStorage.getItem('cf_last_backup_time');
        return val ? parseInt(val) : null;
    }

    static setLastBackupTime(timestamp) {
        try { localStorage.setItem('cf_last_backup_time', String(timestamp || Date.now())); } catch (e) {}
    }

    /** 检查是否需要备份提醒（超过7天未备份） */
    static needsBackupReminder() {
        const last = this.getLastBackupTime();
        if (!last) return true; // 从未备份
        const daysSince = (Date.now() - last) / (1000 * 60 * 60 * 24);
        return daysSince >= 7;
    }
}
