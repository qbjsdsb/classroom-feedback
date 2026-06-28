// CDP 客户端：连接 Chrome，导航到页面，捕获控制台日志和错误
import WebSocket from 'ws';

const CDP_URL = 'http://127.0.0.1:9224';
const TARGET_URL = 'https://classroom-feedback.pages.dev/';

let msgId = 0;
const logs = [];
const errors = [];
const networkErrors = [];

function send(method, params = {}, sessionId) {
    return new Promise((resolve, reject) => {
        const id = ++msgId;
        const onMsg = (data) => {
            const msg = JSON.parse(data.toString());
            if (msg.id === id) {
                ws.off('message', onMsg);
                if (msg.error) reject(new Error(JSON.stringify(msg.error)));
                else resolve(msg.result);
            }
        };
        ws.on('message', onMsg);
        const payload = { id, method, params };
        if (sessionId) payload.sessionId = sessionId;
        ws.send(JSON.stringify(payload));
    });
}

ws.on('error', (err) => { console.error('WS error:', err.message); process.exit(1); });

ws.on('open', async () => {
    console.log('CDP 已连接');
    try {
        const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
        console.log('创建标签页:', targetId);

        const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
        console.log('附加会话:', sessionId);

        await send('Runtime.enable', {}, sessionId);
        await send('Log.enable', {}, sessionId);
        await send('Network.enable', {}, sessionId);
        await send('Page.enable', {}, sessionId);

        ws.on('message', (data) => {
            const msg = JSON.parse(data.toString());
            if (msg.method === 'Runtime.consoleAPICalled') {
                const type = msg.params.type;
                const args = msg.params.args.map(a => a.value || a.description || '').join(' ');
                logs.push(`[console.${type}] ${args}`);
            } else if (msg.method === 'Runtime.exceptionThrown') {
                const details = msg.params.exceptionDetails;
                errors.push(`[exception] ${details.text} ${details.exception?.description || ''}`);
            } else if (msg.method === 'Log.entryAdded') {
                const entry = msg.params.entry;
                if (entry.level === 'error' || entry.level === 'warning') {
                    errors.push(`[${entry.level}] ${entry.text} (${entry.url || ''})`);
                }
            } else if (msg.method === 'Network.loadingFailed') {
                networkErrors.push(`[network] ${msg.params.url} - ${msg.params.errorText}`);
            } else if (msg.method === 'Network.responseReceived') {
                const resp = msg.params.response;
                if (resp.status >= 400) {
                    networkErrors.push(`[http ${resp.status}] ${resp.url}`);
                }
            }
        });

        console.log('导航到:', TARGET_URL);
        await send('Page.navigate', { url: TARGET_URL }, sessionId);

        console.log('等待 20 秒让页面完全加载...');
        await new Promise(r => setTimeout(r, 20000));

        console.log('\n========== 控制台日志 ==========');
        if (logs.length === 0) console.log('(无)');
        else logs.slice(-30).forEach(l => console.log(l));

        console.log('\n========== JS 异常/错误 ==========');
        if (errors.length === 0) console.log('(无)');
        else errors.forEach(e => console.log(e));

        console.log('\n========== 网络错误 ==========');
        if (networkErrors.length === 0) console.log('(无)');
        else networkErrors.forEach(e => console.log(e));

        const { result } = await send('Runtime.evaluate', {
            expression: `JSON.stringify({
                title: document.title,
                crossOriginIsolated: self.crossOriginIsolated,
                hasRecorder: typeof recorder !== 'undefined',
                recorderType: typeof recorder,
                hasApp: typeof app !== 'undefined',
                hasRecordPage: typeof recordPage !== 'undefined',
                speechConfig: (typeof Storage !== 'undefined' && Storage.getSpeechConfig) ? Storage.getSpeechConfig() : null,
                bodyLen: document.body ? document.body.innerHTML.length : 0,
                scriptsLoaded: Array.from(document.scripts).map(s => s.src).filter(s => s).length
            })`
        }, sessionId);
        console.log('\n========== 页面状态 ==========');
        console.log(result.value);

        process.exit(0);
    } catch (err) {
        console.error('CDP 错误:', err.message);
        process.exit(1);
    }
});
