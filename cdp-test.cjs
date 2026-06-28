// CDP 客户端：连接 Chrome，导航到页面，捕获控制台日志和错误
const WebSocket = require('ws');

const CDP_HTTP = 'http://127.0.0.1:9224';
const TARGET_URL = 'https://classroom-feedback.pages.dev/';

let msgId = 0;
const logs = [];
const errors = [];
const networkErrors = [];

function send(ws, method, params = {}, sessionId) {
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

async function main() {
    // 1. 获取 WebSocket URL
    const http = require('http');
    const versionInfo = await new Promise((resolve, reject) => {
        http.get(`${CDP_HTTP}/json/version`, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => resolve(JSON.parse(data)));
        }).on('error', reject);
    });
    console.log('Browser:', versionInfo.Browser);
    const wsUrl = versionInfo.webSocketDebuggerUrl;
    console.log('WS URL:', wsUrl);

    // 2. 连接 WebSocket
    const ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
        ws.on('open', resolve);
        ws.on('error', reject);
    });
    console.log('CDP 已连接');

    // 3. 创建新标签页
    const { targetId } = await send(ws, 'Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send(ws, 'Target.attachToTarget', { targetId, flatten: true });
    console.log('标签页+会话就绪');

    // 4. 启用域
    await send(ws, 'Runtime.enable', {}, sessionId);
    await send(ws, 'Log.enable', {}, sessionId);
    await send(ws, 'Network.enable', {}, sessionId);
    await send(ws, 'Page.enable', {}, sessionId);

    // 5. 监听事件
    ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        if (msg.method === 'Runtime.consoleAPICalled') {
            const type = msg.params.type;
            const args = msg.params.args.map(a => a.value || a.description || '').join(' ');
            logs.push(`[console.${type}] ${args}`);
        } else if (msg.method === 'Runtime.exceptionThrown') {
            const d = msg.params.exceptionDetails;
            errors.push(`[exception] ${d.text} ${d.exception?.description || ''}`);
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

    // 6. 导航
    console.log('导航到:', TARGET_URL);
    await send(ws, 'Page.navigate', { url: TARGET_URL }, sessionId);

    // 7. 等待加载
    console.log('等待 20 秒...');
    await new Promise(r => setTimeout(r, 20000));

    // 8. 输出结果
    console.log('\n========== 控制台日志 ==========');
    if (logs.length === 0) console.log('(无)');
    else logs.slice(-40).forEach(l => console.log(l));

    console.log('\n========== JS 异常/错误 ==========');
    if (errors.length === 0) console.log('(无)');
    else errors.forEach(e => console.log(e));

    console.log('\n========== 网络错误 ==========');
    if (networkErrors.length === 0) console.log('(无)');
    else networkErrors.forEach(e => console.log(e));

    // 9. 页面状态
    const { result } = await send(ws, 'Runtime.evaluate', {
        expression: `JSON.stringify({
            title: document.title,
            crossOriginIsolated: self.crossOriginIsolated,
            hasRecorder: typeof recorder !== 'undefined',
            recorderType: typeof recorder,
            hasApp: typeof app !== 'undefined',
            hasRecordPage: typeof recordPage !== 'undefined',
            hasStorage: typeof Storage !== 'undefined',
            speechConfig: (typeof Storage !== 'undefined' && Storage.getSpeechConfig) ? Storage.getSpeechConfig() : null,
            bodyLen: document.body ? document.body.innerHTML.length : 0,
            scriptsLoaded: Array.from(document.scripts).map(s => s.src).filter(s => s).length,
            hasSpeechApi: (window.SpeechRecognition || window.webkitSpeechRecognition) ? true : false
        })`
    }, sessionId);
    console.log('\n========== 页面状态 ==========');
    console.log(result.value);

    ws.close();
    process.exit(0);
}

main().catch(err => { console.error('错误:', err.message); process.exit(1); });
