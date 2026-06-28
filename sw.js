// Service Worker - 课堂反馈助手离线缓存
const CACHE_NAME = 'classroom-feedback-v1.9.75';

// 需要缓存的静态资源（同时包含 /tutorial 兼容 Cloudflare Pretty URL）
const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/tutorial.html',
    '/tutorial',
    '/icon.svg',
    '/icon-192.png',
    '/icon-512.png',
    '/icon-maskable-192.png',
    '/icon-maskable-512.png',
    '/css/style.css',
    '/js/ai.js',
    '/js/app.js',
    '/js/db.js',
    '/js/models.js',
    '/js/recorder.js',
    '/js/speech/providerInterface.js',
    '/js/speech/whisperProvider.js',
    '/js/speech/voskProvider.js',
    '/js/speech/sherpaProvider.js',
    '/js/whisperWorker.js',
    '/js/storage.js',
    '/js/ui.js',
    '/js/components/bottomSheet.js',
    '/js/pages/historyPage.js',
    '/js/pages/recordPage.js',
    '/js/pages/settingsPage.js',
    '/js/pages/studentFormPage.js',
    '/js/pages/studentsPage.js',
    '/js/pages/subjectSelectPage.js',
    '/vendor/transformers.min.js',
    // ONNX Runtime Web 辅助文件（Whisper 推理所需）
    // ort.bundle.min.mjs: em-pthread worker 脚本（多线程模式用，单线程模式下不加载但预缓存备用）
    // ort-wasm-simd-threaded.jsep.mjs: ESM WASM 加载器
    // 注意：ort-wasm-simd-threaded.jsep.wasm（24MB）不预缓存，首次使用时按需加载
    '/vendor/ort.bundle.min.mjs',
    '/vendor/ort-wasm-simd-threaded.jsep.mjs',
    // Whisper-tiny 模型文件不再预缓存：
    // - Cloudflare Pages 单文件 25MB 限制，30MB 的 onnx 模型不会部署
    // - Whisper 引擎会自动探测本地模型不可用，切换到 hf-mirror.com 远程加载
    // - 远程加载后 transformers.js 会自动缓存到浏览器 Cache Storage
    '/manifest.json'
];

// 安装事件：预缓存静态资源
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            // 使用 addAll 但忽略单个文件失败，避免整体安装失败
            return Promise.allSettled(
                STATIC_ASSETS.map(url => cache.add(url))
            );
        }).then(() => {
            return self.skipWaiting();
        })
    );
});

// 激活事件：清理旧缓存并立即接管
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
            );
        }).then(() => {
            return self.clients.claim();
        })
    );
});

// 请求拦截
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // 非 GET 请求或跨域请求不走缓存
    if (event.request.method !== 'GET' || url.hostname !== self.location.hostname) {
        return;
    }

    // 导航请求：网络优先（确保总是获取最新 HTML 内容）
    if (event.request.mode === 'navigate') {
        event.respondWith(
            fetch(event.request).then((response) => {
                // 网络成功，缓存并返回（跟随308重定向后的最终200响应）
                if (response && response.ok) {
                    const responseClone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(event.request, responseClone);
                    }).catch(() => {});
                }
                return response;
            }).catch(() => {
                // 网络失败，尝试缓存
                // 导航请求无 ?v= 版本号，用 ignoreSearch 兼容 /tutorial → /tutorial.html 等场景
                return caches.match(event.request, { ignoreSearch: true }).then((cached) => {
                    if (cached) return cached;
                    // 完全离线且无缓存时返回首页
                    return caches.match('/index.html');
                });
            })
        );
        return;
    }

    // 静态资源：缓存优先，后台更新（stale-while-revalidate）
    // 注意：match 与 put 必须使用相同的键语义。静态资源用 ?v= 做缓存破坏，
    // 让 ?v= 参与匹配（不用 ignoreSearch），这样升级 ?v= 后旧缓存自然失效走网络，
    // 避免"match 命中旧版本但 put 写入新键"导致版本升级后仍返回旧资源的问题。
    event.respondWith(
        caches.match(event.request).then((cached) => {
            if (cached) {
                // 后台更新缓存
                fetch(event.request).then((response) => {
                    if (response && response.ok) {
                        caches.open(CACHE_NAME).then((cache) => {
                            cache.put(event.request, response);
                        });
                    }
                }).catch(() => {});
                return cached;
            }
            // 缓存未命中，走网络
            return fetch(event.request).then((response) => {
                if (response && response.ok) {
                    const responseClone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(event.request, responseClone);
                    });
                }
                return response;
            });
        })
    );
});
