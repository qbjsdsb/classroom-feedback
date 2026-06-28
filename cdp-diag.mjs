// CDP 诊断脚本：通过 Chrome DevTools Protocol 打开生产页面，捕获控制台错误和 Provider 状态
import http from 'http';

const CDP_BASE = 'http://127.0.0.1:9222';

function fetchJSON(url) {
    return new Promise((resolve, reject) => {
        http.get(url, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(data)); }
                catch (e) { reject(e); }
            });
        }).on('error', reject);
    });
}

async function main() {
    // 1. 获取页面列表
    const pages = await fetchJSON(`${CDP_BASE}/json/list`);
    const page = pages.find(p => p.type === 'page') || pages[0];
    console.log('Using page:', page.url);

    // 2. 连接 WebSocket
    const wsUrl = page.webSocketDebuggerUrl;
    console.log('Connecting to:', wsUrl);

    const ws = new WebSocket(wsUrl);
    let msgId = 1;
    const pending = new Map();

    function send(method, params = {}) {
        return new Promise((resolve, reject) => {
            const id = msgId++;
            pending.set(id, { resolve, reject });
            ws.send(JSON.stringify({ id, method, params }));
        });
    }

    const consoleLogs = [];
    const pageErrors = [];

    ws.addEventListener('message', (event) => {
        const msg = JSON.parse(event.data);
        if (msg.id && pending.has(msg.id)) {
            const p = pending.get(msg.id);
            pending.delete(msg.id);
            if (msg.error) p.reject(new Error(JSON.stringify(msg.error)));
            else p.resolve(msg.result);
        }
        if (msg.method === 'Runtime.consoleAPICalled') {
            const args = msg.params.args.map(a => a.value || a.description || '').join(' ');
            consoleLogs.push(`[${msg.params.type}] ${args}`);
        }
        if (msg.method === 'Runtime.exceptionThrown') {
            const details = msg.params.exceptionDetails;
            pageErrors.push(`${details.text} ${details.exception?.description || ''}`);
        }
        if (msg.method === 'Log.entryAdded') {
            const entry = msg.params.entry;
            consoleLogs.push(`[LOG:${entry.level}] ${entry.text}`);
        }
    });

    await new Promise((resolve) => ws.addEventListener('open', resolve));

    await send('Runtime.enable');
    await send('Page.enable');
    await send('Log.enable');

    console.log('\n=== Step 1: Navigate to clean cache-busting URL ===\n');
    const cb1 = Date.now();
    await send('Page.navigate', { url: `https://classroom-feedback.pages.dev/?_cb=${cb1}` });

    await new Promise(r => setTimeout(r, 6000));

    // 清理旧 Service Worker 和缓存，确保下次加载获取全新资源
    console.log('=== Step 2: Cleaning old Service Worker & caches ===');
    try {
        await send('Runtime.evaluate', {
            expression: `(async function() {
                try {
                    var regs = await navigator.serviceWorker.getRegistrations();
                    await Promise.all(regs.map(r => r.unregister()));
                    var keys = await caches.keys();
                    await Promise.all(keys.map(k => caches.delete(k)));
                    return 'unregistered ' + regs.length + ' SW, deleted ' + keys.length + ' caches';
                } catch(e) { return 'clean err: ' + e.message; }
            })()`,
            awaitPromise: true,
            returnByValue: true
        }).then(r => console.log('Clean result:', r.result.value));
    } catch(e) { console.log('Clean skip:', e.message); }

    // 用新的 cache-busting URL 导航，绕过浏览器 HTTP 缓存 + 已无 SW 干扰
    console.log('=== Step 3: Navigate with fresh cache-busting URL ===');
    const cb2 = Date.now();
    await send('Page.navigate', { url: `https://classroom-feedback.pages.dev/?_cb=${cb2}` });
    await new Promise(r => setTimeout(r, 9000));

    console.log('\n=== Running diagnostics ===\n');
    const diagResult = await send('Runtime.evaluate', {
        expression: `(function() {
            try {
                var result = {
                    hasRecorder: typeof recorder !== 'undefined',
                    hasApp: typeof app !== 'undefined',
                    hasStorage: typeof Storage !== 'undefined',
                    hasUI: typeof UI !== 'undefined',
                    crossOriginIsolated: self.crossOriginIsolated,
                    hasSharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
                    hasSpeechApi: !!(window.SpeechRecognition || window.webkitSpeechRecognition),
                    hasWebAssembly: typeof WebAssembly !== 'undefined',
                    location: window.location.href,
                    recorderScriptSrc: (document.querySelector('script[src*="recorder.js"]') || {}).src || 'not found'
                };
                if (typeof recorder !== 'undefined') {
                    result.recorderExists = true;
                    result.hasFailedAutoProvidersSet = (recorder._failedAutoProviders !== undefined && typeof recorder._failedAutoProviders.has === 'function');
                    result.hasTryStartLocalProvider = (typeof recorder._tryStartLocalProvider === 'function');
                    try {
                        result.providerSupport = {
                            whisper: recorder._whisperProvider ? recorder._whisperProvider.isSupported() : 'no provider',
                            vosk: recorder._voskProvider ? recorder._voskProvider.isSupported() : 'no provider',
                            sherpa: recorder._sherpaProvider ? recorder._sherpaProvider.isSupported() : 'no provider'
                        };
                    } catch(e) { result.providerSupportError = e.message; }
                    try {
                        if (typeof Storage !== 'undefined') {
                            result.speechConfig = Storage.getSpeechConfig();
                        }
                    } catch(e) { result.configError = e.message; }
                    try {
                        var auto = recorder._resolveAutoProvider();
                        result.autoSelected = auto ? auto.reason : 'null (browser fallback)';
                    } catch(e) { result.autoError = e.message; }
                    try {
                        var active = recorder._getActiveLocalProvider();
                        result.activeProvider = active ? active.id : 'null (browser mode)';
                    } catch(e) { result.activeError = e.message; }
                }
                return JSON.stringify(result, null, 2);
            } catch(e) {
                return 'DIAG ERROR: ' + e.message + ' | ' + e.stack;
            }
        })()`,
        returnByValue: true
    });

    console.log('=== Diagnostic Result ===');
    console.log(diagResult.result.value);

    console.log('\n=== Console Logs (' + consoleLogs.length + ') ===');
    consoleLogs.slice(-30).forEach(l => console.log(l));

    console.log('\n=== Page Errors (' + pageErrors.length + ') ===');
    pageErrors.forEach(e => console.log(e));

    const domResult = await send('Runtime.evaluate', {
        expression: `JSON.stringify({
            title: document.title,
            hasSidebar: !!document.querySelector('.desktop-sidebar'),
            hasRecordBtn: !!document.getElementById('btn-record'),
            recordBtnText: document.getElementById('btn-record') ? document.getElementById('btn-record').textContent.trim() : 'not found',
            bodyTextLength: document.body.innerText.length,
            bodyTextPreview: document.body.innerText.substring(0, 300)
        })`,
        returnByValue: true
    });
    console.log('\n=== Page DOM Check ===');
    console.log(domResult.result.value);

    ws.close();
    process.exit(0);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
