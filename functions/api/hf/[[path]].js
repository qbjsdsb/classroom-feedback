// HuggingFace 模型同源代理
// 作用：transformers.js 加载 Whisper 模型时，URL 拼接为 remoteHost + modelId/resolve/main/file
// 设置 env.remoteHost = '/api/hf/' 后，所有模型请求变为同源 /api/hf/Xenova/whisper-tiny/resolve/main/...
// 本函数把路径转发到 hf-mirror.com（国内镜像），并添加 CORS 头
// 这样避免了 hf-mirror.com 307 重定向可能导致的 CORS 问题，也保证了 COEP 环境下的兼容性
//
// 路径匹配：functions/api/hf/[[path]].js → /api/hf/* (包括子路径)
// context.params.path 是路径数组（如 ['Xenova', 'whisper-tiny', 'resolve', 'main', 'config.json']）

const HF_MIRROR_BASE = 'https://hf-mirror.com/';

export async function onRequest(context) {
    const { request, params } = context;

    // 拼接路径
    const pathParts = params.path || [];
    const path = Array.isArray(pathParts) ? pathParts.join('/') : String(pathParts);

    if (!path) {
        return new Response('Missing path', { status: 400 });
    }

    const targetUrl = HF_MIRROR_BASE + path;

    try {
        // 构造代理请求
        const proxyReq = new Request(targetUrl, {
            method: request.method,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': '*/*',
                'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7',
            },
            body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
            redirect: 'follow',
        });

        // 支持 Range 请求（大文件分块下载，如 30MB 的 ONNX 模型）
        const range = request.headers.get('Range');
        if (range) {
            proxyReq.headers.set('Range', range);
        }

        const response = await fetch(proxyReq);

        // 复制响应，添加 CORS 头
        const newHeaders = new Headers(response.headers);
        newHeaders.set('Access-Control-Allow-Origin', '*');
        newHeaders.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
        newHeaders.set('Access-Control-Allow-Headers', 'Range');
        newHeaders.set('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Content-Type, ETag');

        // 处理 OPTIONS 预检
        if (request.method === 'OPTIONS') {
            return new Response(null, {
                status: 204,
                headers: newHeaders,
            });
        }

        return new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers: newHeaders,
        });
    } catch (err) {
        return new Response('HF proxy error: ' + err.message, { status: 502 });
    }
}
