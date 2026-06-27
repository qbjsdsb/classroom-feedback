"""
模拟 webkitSpeechRecognition，手动触发 onstart/onresult/onend，
验证合并后的去重逻辑是否会导致识别文字被错误丢弃。
"""
from playwright.sync_api import sync_playwright
import json

page_errors = []
console_logs = []

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    context = browser.new_context(service_workers='block')
    page = context.new_page()

    def on_console(msg):
        console_logs.append(f"[{msg.type}] {msg.text}")
    page.on('console', on_console)
    page.on('pageerror', lambda e: page_errors.append(str(e)))

    page.goto('http://localhost:8080')
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(1500)

    # 导航到录音页
    page.locator('[data-page="record"]').first.click()
    page.wait_for_timeout(800)

    # 1) Mock getUserMedia，让 start() 的设备检查通过
    page.evaluate("""() => {
        navigator.mediaDevices.getUserMedia = async () => new MediaStream();
        navigator.permissions.query = async () => ({ state: 'granted' });
    }""")

    # 2) 用 fake webkitSpeechRecognition 替换真实的，能手动触发事件
    #    关键：所有事件通过 window.__mockEvents 触发
    page.evaluate("""() => {
        class FakeRecognition {
            constructor() {
                this.continuous = false;
                this.interimResults = false;
                this.lang = '';
                this.maxAlternatives = 1;
                this.onstart = null;
                this.onend = null;
                this.onresult = null;
                this.onerror = null;
                this._results = [];
                this._instanceId = FakeRecognition._nextId++;
                FakeRecognition._lastInstance = this;
            }
            start() {
                console.log('[MOCK] start() called, instance #' + this._instanceId);
                // 延迟触发 onstart，模拟真实异步行为
                setTimeout(() => {
                    if (this.onstart) this.onstart();
                }, 50);
            }
            stop() {
                console.log('[MOCK] stop() called, instance #' + this._instanceId);
                setTimeout(() => {
                    if (this.onend) this.onend();
                }, 30);
            }
            abort() {
                console.log('[MOCK] abort() called, instance #' + this._instanceId);
                setTimeout(() => {
                    if (this.onend) this.onend();
                }, 30);
            }
            // 测试辅助方法
            _emitResult(results, resultIndex) {
                const event = { results, resultIndex };
                if (this.onresult) this.onresult(event);
            }
            _emitEnd() {
                if (this.onend) this.onend();
            }
            _emitError(err) {
                if (this.onerror) this.onerror({ error: err });
            }
        }
        FakeRecognition._nextId = 0;
        FakeRecognition._lastInstance = null;
        window.FakeRecognition = FakeRecognition;
        window.webkitSpeechRecognition = FakeRecognition;
        window.SpeechRecognition = FakeRecognition;
    }""")

    # 点击录音按钮触发 start()
    page.locator('#btn-record').click()
    page.wait_for_timeout(300)  # 等 start() 的 async 流程完成

    # 此时 onstart 超时定时器（5秒）已设置；立即手动触发 onstart
    page.evaluate("""() => {
        const r = window.FakeRecognition._lastInstance;
        if (r && r.onstart) r.onstart();
    }""")
    page.wait_for_timeout(200)

    state = page.evaluate("""() => ({
        isRecording: recorder.isRecording,
        userIntendsToRecord: recorder._userIntendsToRecord,
        shouldRestart: recorder.shouldRestart,
        lastProcessedResultIdx: recorder._lastProcessedResultIdx,
        dedupPending: recorder._dedupPending,
        lastCommittedInterim: recorder._lastCommittedInterim
    })""")
    print(f"=== onstart 后状态 ===")
    print(json.dumps(state, ensure_ascii=False, indent=2))

    # 触发 onresult：1 个 final 结果，内容 "你好"
    # SpeechRecognitionResultList / SpeechRecognitionResult 的最小 mock
    page.evaluate("""() => {
        const r = window.FakeRecognition._lastInstance;
        // 构造类似真实 event.results 的对象
        const results = [{
            0: { transcript: '你好' },
            isFinal: true,
            length: 1
        }];
        // 让 results.length 可用
        Object.defineProperty(results, 'length', { value: 1 });
        r._emitResult(results, 0);
    }""")
    page.wait_for_timeout(100)

    state = page.evaluate("""() => ({
        finalTranscript: recorder.finalTranscript,
        accumulatedText: recorder.accumulatedText,
        interimTranscript: recorder.interimTranscript,
        lastProcessedResultIdx: recorder._lastProcessedResultIdx,
        textareaValue: document.getElementById('transcript').value
    })""")
    print(f"\n=== 触发 1 个 final='你好' 后 ===")
    print(json.dumps(state, ensure_ascii=False, indent=2))

    # 再触发一个 final，内容 "我是老师"
    page.evaluate("""() => {
        const r = window.FakeRecognition._lastInstance;
        const results = [
            { 0: { transcript: '你好' }, isFinal: true, length: 1 },
            { 0: { transcript: '我是老师' }, isFinal: true, length: 1 }
        ];
        Object.defineProperty(results, 'length', { value: 2 });
        // resultIndex=1，表示从索引1开始变化
        r._emitResult(results, 1);
    }""")
    page.wait_for_timeout(100)

    state = page.evaluate("""() => ({
        finalTranscript: recorder.finalTranscript,
        accumulatedText: recorder.accumulatedText,
        lastProcessedResultIdx: recorder._lastProcessedResultIdx,
        textareaValue: document.getElementById('transcript').value
    })""")
    print(f"\n=== 再触发 final='我是老师' (resultIndex=1) 后 ===")
    print(json.dumps(state, ensure_ascii=False, indent=2))

    # 测试 interim 结果
    page.evaluate("""() => {
        const r = window.FakeRecognition._lastInstance;
        const results = [
            { 0: { transcript: '你好' }, isFinal: true, length: 1 },
            { 0: { transcript: '我是老师' }, isFinal: true, length: 1 },
            { 0: { transcript: '今天天气' }, isFinal: false, length: 1 }
        ];
        Object.defineProperty(results, 'length', { value: 3 });
        r._emitResult(results, 2);
    }""")
    page.wait_for_timeout(100)

    state = page.evaluate("""() => ({
        interimTranscript: recorder.interimTranscript,
        textareaValue: document.getElementById('transcript').value
    })""")
    print(f"\n=== 触发 interim='今天天气' 后 ===")
    print(json.dumps(state, ensure_ascii=False, indent=2))

    print(f"\n=== Console Logs ===")
    for l in console_logs[-20:]:
        print(f"  {l}")

    print(f"\n=== Page Errors ({len(page_errors)}) ===")
    for e in page_errors:
        print(f"  {e}")

    browser.close()
