const puppeteer = require('puppeteer-core');

(async () => {
    const browser = await puppeteer.connect({
        browserURL: 'http://127.0.0.1:9224',
        defaultViewport: { width: 1280, height: 900 }
    });

    const page = await browser.newPage();
    const consoleLogs = [];
    const pageErrors = [];
    const failedRequests = [];

    page.on('console', msg => {
        consoleLogs.push(`[${msg.type()}] ${msg.text()}`);
    });
    page.on('pageerror', err => {
        pageErrors.push(`[pageerror] ${err.message}\n${err.stack || ''}`);
    });
    page.on('requestfailed', req => {
        failedRequests.push(`[failed] ${req.url()} - ${req.failure()?.errorText}`);
    });
    page.on('response', resp => {
        if (resp.status() >= 400) {
            failedRequests.push(`[http ${resp.status()}] ${resp.url()}`);
        }
    });

    console.log('导航到页面...');
    await page.goto('https://classroom-feedback.pages.dev/', { waitUntil: 'networkidle2', timeout: 30000 });
    console.log('页面加载完成，等待 5 秒...');
    await new Promise(r => setTimeout(r, 5000));

    console.log('\n========== 页面状态 ==========');
    const state = await page.evaluate(() => ({
        title: document.title,
        crossOriginIsolated: self.crossOriginIsolated,
        hasRecorder: typeof recorder !== 'undefined',
        recorderType: typeof recorder,
        hasApp: typeof app !== 'undefined',
        hasRecordPage: typeof recordPage !== 'undefined',
        speechConfig: (typeof Storage !== 'undefined' && Storage.getSpeechConfig) ? Storage.getSpeechConfig() : null,
        scriptsLoaded: Array.from(document.scripts).map(s => s.src).filter(s => s).length,
        hasSpeechApi: !!(window.SpeechRecognition || window.webkitSpeechRecognition),
        bodyText: document.body ? document.body.innerText.substring(0, 200) : ''
    }));
    console.log(JSON.stringify(state, null, 2));

    console.log('\n========== 控制台日志 ==========');
    if (consoleLogs.length === 0) console.log('(无)');
    else consoleLogs.slice(-30).forEach(l => console.log(l));

    console.log('\n========== 页面 JS 错误 ==========');
    if (pageErrors.length === 0) console.log('(无)');
    else pageErrors.forEach(e => console.log(e));

    console.log('\n========== 失败的网络请求 ==========');
    if (failedRequests.length === 0) console.log('(无)');
    else failedRequests.forEach(r => console.log(r));

    // 尝试导航到录音页并检查
    console.log('\n========== 尝试导航到录音页 ==========');
    try {
        await page.evaluate(() => { if (typeof app !== 'undefined') app.navigate('record'); });
        await new Promise(r => setTimeout(r, 2000));
        const recordPageState = await page.evaluate(() => ({
            hasRecordBtn: !!document.querySelector('[onclick*="record"]') || !!document.getElementById('btn-record'),
            recordStatus: (document.querySelector('.record-status') || {}).textContent || null,
            bodySnippet: document.body ? document.body.innerText.substring(0, 300) : ''
        }));
        console.log(JSON.stringify(recordPageState, null, 2));
    } catch (e) {
        console.log('导航失败:', e.message);
    }

    await browser.disconnect();
    process.exit(0);
})().catch(err => { console.error('错误:', err.message); process.exit(1); });
