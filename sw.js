// Service Worker - 课堂反馈助手离线缓存
const CACHE_NAME = 'classroom-feedback-v1.9.42';

// 需要缓存的静态资源（同时包含 /tutorial 兼容 Cloudflare Pretty URL）
const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/tutorial.html',
    '/tutorial',
    '/icon.svg',
    '/css/style.css',
    '/js/ai.js',
    '/js/app.js',
    '/js/db.js',
    '/js/models.js',
    '/js/recorder.js',
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
    event.respondWith(
        caches.match(event.request, { ignoreSearch: true }).then((cached) => {
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
