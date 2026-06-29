// Service Worker - 课堂反馈助手离线缓存
// P3-1: 静态资源 ?v= 精确匹配 + ignoreSearch 兜底，确保预缓存条目可用
// P3-2: 大模型/大 WASM 走纯 cache-first，避免重复下载 40MB
// P3-3: activate 只清理本应用前缀的旧缓存，保留 transformers.js 等第三方缓存
const CACHE_NAME = 'classroom-feedback-v1.9.78';
const CACHE_PREFIX = 'classroom-feedback-';

// 大资源路径前缀：命中即返回，不后台拉取（避免每次访问浪费带宽下载 40MB）
// - /api/hf/ : HuggingFace 模型代理（whisper-tiny onnx 权重等）
// - /vendor/ort-wasm-simd-threaded.jsep.wasm : ONNX Runtime 24MB WASM
const LARGE_ASSET_PREFIXES = [
    '/api/hf/',
    '/vendor/ort-wasm-simd-threaded.jsep.wasm'
];

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
// P3-3: 只清理本应用前缀（classroom-feedback-）的旧版本缓存，
// 保留 transformers.js 等第三方库自管理的 Cache Storage 条目，
// 避免每次版本升级都让用户重新下载 40MB Whisper 模型
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
                    .map((key) => caches.delete(key))
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

    // P3-2: 大模型/大 WASM 走纯 cache-first（命中即返回，不做后台 revalidate）
    // 这类资源体积大（24-40MB）、版本稳定，频繁后台拉取浪费带宽
    const isLargeAsset = LARGE_ASSET_PREFIXES.some(p => url.pathname.startsWith(p));
    if (isLargeAsset) {
        event.respondWith(
            caches.match(event.request).then((cached) => {
                if (cached) return cached;
                // 缓存未命中：走网络，成功后缓存
                return fetch(event.request).then((response) => {
                    if (response && response.ok) {
                        const responseClone = response.clone();
                        caches.open(CACHE_NAME).then((cache) => {
                            cache.put(event.request, responseClone);
                        }).catch(() => {});
                    }
                    return response;
                });
            })
        );
        return;
    }

    // 静态资源：缓存优先，后台更新（stale-while-revalidate）
    // P3-1: 先用 ?v= 精确匹配（保留版本化缓存破坏能力），
    // 未命中再用 ignoreSearch 兜底命中预缓存条目（无 ?v= 的预缓存）。
    // 这样：
    //   - 正常情况下 ?v= 命中，直接返回正确版本
    //   - 首次访问/版本升级后 ?v= 未命中，ignoreSearch 命中预缓存（即最新版本，install 时刚拉取）
    //   - 后台 SWR 拉取带 ?v= 的版本写入缓存，供下次直接命中
    event.respondWith(
        caches.match(event.request).then((cached) => {
            const serveAndRevalidate = (response) => {
                // 后台更新缓存
                fetch(event.request).then((networkResp) => {
                    if (networkResp && networkResp.ok) {
                        caches.open(CACHE_NAME).then((cache) => {
                            cache.put(event.request, networkResp);
                        });
                    }
                }).catch(() => {});
                return response;
            };

            if (cached) {
                return serveAndRevalidate(cached);
            }
            // P3-1: ?v= 精确匹配未命中，尝试 ignoreSearch 兜底
            return caches.match(event.request, { ignoreSearch: true }).then((fallbackCached) => {
                if (fallbackCached) {
                    return serveAndRevalidate(fallbackCached);
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
            });
        })
    );
});
