// CDP 验证脚本：验证录音生命周期修复 + UI 修复
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
    const pages = await fetchJSON(`${CDP_BASE}/json/list`);
    const page = pages.find(p => p.type === 'page') || pages[0];
    console.log('Using page:', page.url);

    const ws = new WebSocket(page.webSocketDebuggerUrl);
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
    });

    await new Promise((resolve) => ws.addEventListener('open', resolve));
    await send('Runtime.enable');
    await send('Page.enable');

    // Step 1: 导航并清理旧 SW/缓存
    const cb1 = Date.now();
    await send('Page.navigate', { url: `https://classroom-feedback.pages.dev/?_cb=${cb1}` });
    await new Promise(r => setTimeout(r, 5000));

    await send('Runtime.evaluate', {
        expression: `(async function() {
            try {
                var regs = await navigator.serviceWorker.getRegistrations();
                await Promise.all(regs.map(r => r.unregister()));
                var keys = await caches.keys();
                await Promise.all(keys.map(k => caches.delete(k)));
                return 'cleaned ' + regs.length + ' SW, ' + keys.length + ' caches';
            } catch(e) { return 'clean err: ' + e.message; }
        })()`,
        awaitPromise: true,
        returnByValue: true
    }).then(r => console.log('Clean:', r.result.value));

    // Step 2: 全新导航
    const cb2 = Date.now();
    await send('Page.navigate', { url: `https://classroom-feedback.pages.dev/?_cb=${cb2}` });
    await new Promise(r => setTimeout(r, 9000));

    console.log('\n=== 验证 1：新版本加载 + isRecording 修复 ===');
    const verify1 = await send('Runtime.evaluate', {
        expression: `(function() {
            var r = {
                recorderSrc: (document.querySelector('script[src*="recorder.js"]') || {}).src || 'not found',
                cssSrc: (document.querySelector('link[href*="style.css"]') || {}).href || 'not found',
                hasRecorder: typeof recorder !== 'undefined',
                isRecordingInitial: recorder ? recorder.isRecording : 'no recorder',
                userIntendsInitial: recorder ? recorder._userIntendsToRecord : 'no recorder',
                failedAutoProvidersInit: recorder ? Array.from(recorder._failedAutoProviders || []) : 'no recorder',
                hasTryStartLocalProvider: recorder ? typeof recorder._tryStartLocalProvider === 'function' : false,
                autoSelected: (function(){
                    try { var a = recorder._resolveAutoProvider(); return a ? a.reason : 'null'; }
                    catch(e) { return 'err:' + e.message; }
                })()
            };
            return JSON.stringify(r, null, 2);
        })()`,
        returnByValue: true
    });
    console.log(verify1.result.value);

    console.log('\n=== 验证 2：模拟 stop() 后 isRecording 正确重置（本地分支） ===');
    const verify2 = await send('Runtime.evaluate', {
        expression: `(function() {
            try {
                // 模拟本地引擎录音中的状态
                recorder.isRecording = true;
                recorder._userIntendsToRecord = true;
                recorder.sessionStartTime = Date.now() - 30000;
                recorder.accumulatedText = '测试内容';
                recorder._resolvedAutoProvider = recorder._voskProvider;
                recorder._failedAutoProviders.add('whisper');
                var beforeStop = {
                    isRecording: recorder.isRecording,
                    userIntends: recorder._userIntendsToRecord,
                    failedCount: recorder._failedAutoProviders.size
                };
                // 调用 stop()（本地分支会走，因为 Auto→Vosk）
                recorder.stop();
                var afterStop = {
                    isRecording: recorder.isRecording,
                    userIntends: recorder._userIntendsToRecord,
                    failedCount: recorder._failedAutoProviders.size,
                    resolvedAuto: recorder._resolvedAutoProvider,
                    sessionStart: recorder.sessionStartTime,
                    accumulatedText: recorder.accumulatedText
                };
                return JSON.stringify({beforeStop, afterStop}, null, 2);
            } catch(e) { return 'ERR: ' + e.message + ' | ' + e.stack; }
        })()`,
        returnByValue: true
    });
    console.log(verify2.result.value);

    console.log('\n=== 验证 3：stop 后能再次 start（toggle 不被拦截） ===');
    const verify3 = await send('Runtime.evaluate', {
        expression: `(function() {
            try {
                // stop 后 isRecording 应为 false，_userIntendsToRecord 应为 false
                // 此时 toggle() 应走 start() 分支而非被拦截
                var canRestart = (!recorder.isRecording && !recorder._userIntendsToRecord && !recorder._isPaused);
                return JSON.stringify({
                    canRestart: canRestart,
                    isRecording: recorder.isRecording,
                    userIntends: recorder._userIntendsToRecord,
                    isPaused: recorder._isPaused,
                    isStarting: recorder._isStarting
                }, null, 2);
            } catch(e) { return 'ERR: ' + e.message; }
        })()`,
        returnByValue: true
    });
    console.log(verify3.result.value);

    console.log('\n=== 验证 4：UI 修复 - Toast 样式 ===');
    const verify4 = await send('Runtime.evaluate', {
        expression: `(function() {
            // 临时创建 toast 检查样式
            var t = document.createElement('div');
            t.className = 'toast';
            t.style.visibility = 'hidden';
            document.body.appendChild(t);
            var cs = getComputedStyle(t);
            var info = {
                whiteSpace: cs.whiteSpace,
                maxWidth: cs.maxWidth,
                wordBreak: cs.wordBreak
            };
            document.body.removeChild(t);
            return JSON.stringify(info, null, 2);
        })()`,
        returnByValue: true
    });
    console.log(verify4.result.value);

    console.log('\n=== 验证 5：导航到设置页检查 FAB 位置 ===');
    // 通过 SPA 路由导航到设置页
    await send('Runtime.evaluate', {
        expression: `if (typeof app !== 'undefined' && app.navigate) { app.navigate('settings'); } else if (typeof navigate === 'function') { navigate('settings'); }`,
        returnByValue: true
    });
    await new Promise(r => setTimeout(r, 1500));
    const verify5 = await send('Runtime.evaluate', {
        expression: `(function() {
            var fab = document.querySelector('.settings-fab-save');
            if (!fab) return JSON.stringify({found: false});
            var cs = getComputedStyle(fab);
            var nav = document.querySelector('.bottom-nav');
            var navRect = nav ? nav.getBoundingClientRect() : null;
            var fabRect = fab.getBoundingClientRect();
            return JSON.stringify({
                found: true,
                fabBottom: cs.bottom,
                fabBottomPx: fabRect.bottom,
                navHeight: navRect ? navRect.height : 'no nav',
                navBottom: navRect ? navRect.bottom : 'no nav',
                viewportH: window.innerHeight,
                overlap: navRect ? (fabRect.bottom > navRect.top) : 'unknown'
            }, null, 2);
        })()`,
        returnByValue: true
    });
    console.log(verify5.result.value);

    console.log('\n=== Page Errors (' + pageErrors.length + ') ===');
    pageErrors.slice(-5).forEach(e => console.log(e));
    console.log('\n=== Console Logs (' + consoleLogs.length + ', last 10) ===');
    consoleLogs.slice(-10).forEach(l => console.log(l));

    ws.close();
    process.exit(0);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
