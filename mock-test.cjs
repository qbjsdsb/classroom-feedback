// mock-browser.js - 模拟浏览器环境加载页面 JS，检查执行错误
const fs = require('fs');
const path = require('path');

// 创建 mock 浏览器环境
const mockWindow = {
    location: {
        pathname: '/',
        origin: 'https://classroom-feedback.pages.dev',
        hostname: 'classroom-feedback.pages.dev',
        href: 'https://classroom-feedback.pages.dev/'
    },
    navigator: {
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36',
        mediaDevices: { getUserMedia: async () => { throw new Error('mock: no mic'); } }
    },
    AudioContext: function() { return { sampleRate: 48000, createMediaStreamSource: () => ({}), createScriptProcessor: () => ({}), createAnalyser: () => ({}), createGain: () => ({ gain: {} }), destination: {}, close: async () => {} }; },
    webkitAudioContext: undefined,
    SpeechRecognition: function() {},
    webkitSpeechRecognition: undefined,
    WebSocket: function() {},
    IndexedDB: undefined,
    SharedArrayBuffer: undefined,
    crossOriginIsolated: true, // 模拟 COOP/COEP 环境
    addEventListener: () => {},
    removeEventListener: () => {},
    fetch: async (url, opts) => {
        console.log('[mock-fetch]', opts?.method || 'GET', url);
        // 模拟 config.json 返回有效 JSON
        if (url && url.includes('config.json') && !url.includes('onnx')) {
            return { ok: true, status: 200, headers: { get: (k) => k === 'content-type' ? 'application/json' : null }, text: async () => '{"model_type":"whisper"}' };
        }
        // 模拟 onnx 文件返回 HTML（SPA 兜底）
        if (url && url.includes('.onnx')) {
            return { ok: true, status: 200, headers: { get: (k) => k === 'content-type' ? 'text/html' : null }, text: async () => '<!DOCTYPE html>' };
        }
        return { ok: true, status: 200, headers: { get: () => null }, text: async () => '' };
    },
    document: {
        title: '课堂反馈助手',
        getElementById: () => null,
        querySelector: () => null,
        querySelectorAll: () => [],
        createElement: () => ({ style: {}, setAttribute: () => {}, appendChild: () => {}, addEventListener: () => {} }),
        addEventListener: () => {},
        body: { innerHTML: '', appendChild: () => {} },
        head: { appendChild: () => {} },
        scripts: [],
        currentScript: { src: '' }
    },
    indexedDB: {
        open: () => ({ onupgradeneeded: null, onsuccess: null, onerror: null })
    },
    caches: {
        open: async () => ({ add: async () => {}, put: async () => {}, match: async () => null, keys: () => [] }),
        keys: async () => [],
        delete: async () => true,
        match: async () => null
    },
    localStorage: {
        getItem: () => null,
        setItem: () => {},
        removeItem: () => {}
    },
    Worker: function() { return { postMessage: () => {}, terminate: () => {}, onmessage: null, onerror: null }; },
    WebAssembly: { validate: () => true, instantiate: async () => ({ instance: {}, module: {} }) },
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    setInterval: setInterval,
    clearInterval: clearInterval,
    Promise: Promise,
    console: console,
    JSON: JSON,
    Date: Date,
    Math: Math,
    Array: Array,
    Object: Object,
    String: String,
    Number: Number,
    Boolean: Boolean,
    Error: Error,
    TypeError: TypeError,
    RangeError: RangeError,
    Map: Map,
    Set: Set,
    URL: URL,
    URLSearchParams: URLSearchParams,
    Headers: Headers,
    Response: Response,
    Request: Request,
    Float32Array: Float32Array,
    Uint8Array: Uint8Array,
    Array: Array,
    self: null // 稍后设置
};

mockWindow.self = mockWindow;
mockWindow.window = mockWindow;

// 设置全局
global.window = mockWindow;
global.self = mockWindow;
global.document = mockWindow.document;
global.navigator = mockWindow.navigator;
global.location = mockWindow.location;
global.localStorage = mockWindow.localStorage;
global.indexedDB = mockWindow.indexedDB;
global.caches = mockWindow.caches;
global.fetch = mockWindow.fetch;
global.Worker = mockWindow.Worker;
global.WebAssembly = mockWindow.WebAssembly;
global.AudioContext = mockWindow.AudioContext;
global.SpeechRecognition = mockWindow.SpeechRecognition;
global.webkitSpeechRecognition = mockWindow.webkitSpeechRecognition;
global.SharedArrayBuffer = mockWindow.SharedArrayBuffer;
global.crossOriginIsolated = mockWindow.crossOriginIsolated;
global.setTimeout = setTimeout;
global.setInterval = setInterval;
global.clearTimeout = clearTimeout;
global.clearInterval = clearInterval;
global.Headers = Headers;
global.Response = Response;
global.Request = Request;
global.URL = URL;
global.Float32Array = Float32Array;
global.Uint8Array = Uint8Array;

// 按顺序加载 JS 文件（与 index.html 一致）
const files = [
    'js/db.js',
    'js/storage.js',
    'js/models.js',
    'js/speech/providerInterface.js',
    'js/speech/whisperProvider.js',
    'js/speech/voskProvider.js',
    'js/speech/sherpaProvider.js',
    'js/recorder.js',
    'js/ai.js',
    'js/ui.js',
    'js/components/bottomSheet.js',
    'js/pages/studentsPage.js',
    'js/pages/studentFormPage.js',
    'js/pages/subjectSelectPage.js',
    'js/pages/recordPage.js',
    'js/pages/historyPage.js',
    'js/pages/settingsPage.js',
    'js/app.js',
];

const errors = [];
const origError = console.error;
console.error = (...args) => {
    errors.push(args.map(a => typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a)).join(' '));
    origError('[console.error]', ...args);
};

for (const file of files) {
    try {
        const code = fs.readFileSync(path.join('/workspace', file), 'utf8');
        // 用 vm 在全局上下文中执行
        const vm = require('vm');
        vm.runInThisContext(code, { filename: file });
        console.log(`✓ 加载成功: ${file}`);
    } catch (err) {
        console.error(`✗ 加载失败: ${file} -> ${err.message}`);
        console.error(err.stack);
    }
}

console.log('\n========== 检查全局对象 ==========');
console.log('typeof recorder:', typeof global.recorder);
console.log('typeof app:', typeof global.app);
console.log('typeof recordPage:', typeof global.recordPage);
console.log('typeof Storage:', typeof global.Storage);
console.log('typeof Recorder:', typeof global.Recorder);
console.log('typeof WhisperProvider:', typeof global.WhisperProvider);
console.log('typeof VoskProvider:', typeof global.VoskProvider);
console.log('typeof SherpaProvider:', typeof global.SherpaProvider);
console.log('typeof UI:', typeof global.UI);

if (global.recorder) {
    console.log('\n========== Recorder 状态 ==========');
    console.log('hasSpeechApi:', global.recorder.hasSpeechApi);
    console.log('isRecording:', global.recorder.isRecording);
    console.log('_whisperProvider:', typeof global.recorder._whisperProvider);
    console.log('_voskProvider:', typeof global.recorder._voskProvider);
    console.log('_sherpaProvider:', typeof global.recorder._sherpaProvider);

    if (global.recorder._whisperProvider) {
        console.log('Whisper isSupported:', global.recorder._whisperProvider.isSupported());
    }
    if (global.recorder._voskProvider) {
        console.log('Vosk isSupported:', global.recorder._voskProvider.isSupported());
    }
    if (global.recorder._sherpaProvider) {
        console.log('Sherpa isSupported:', global.recorder._sherpaProvider.isSupported());
    }

    // 测试 _resolveAutoProvider
    try {
        const auto = global.recorder._resolveAutoProvider();
        console.log('Auto 选中:', auto ? auto.name : 'null');
    } catch (e) {
        console.error('Auto 解析失败:', e.message);
    }
}

if (global.Storage) {
    console.log('\n========== 语音配置 ==========');
    console.log('speechConfig:', JSON.stringify(global.Storage.getSpeechConfig()));
}

console.log('\n========== 所有错误 ==========');
if (errors.length === 0) console.log('(无)');
else errors.forEach(e => console.log(e));
