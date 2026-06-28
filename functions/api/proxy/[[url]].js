// cors-proxy.js - Cloudflare Worker CORS 代理
// 作用：为不支持 CORS 的资源（Vosk 模型、Sherpa WASM 等）添加 CORS 头
// 部署：在 Cloudflare Pages 项目根目录创建 functions/ 目录，此文件放在 functions/api/proxy/
// 访问：https://classroom-feedback.pages.dev/api/proxy?url=<原始URL>

export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url);

    // 获取要代理的目标 URL
    const targetUrl = url.searchParams.get('url');
    if (!targetUrl) {
        return new Response('Missing url parameter', { status: 400 });
    }

    // 安全检查：只允许代理白名单域名，防止被滥用为开放代理
    const allowedDomains = [
        'alphacephei.com',           // Vosk 模型
        'huggingface.co',            // Sherpa 模型/WASM（国际）
        'hf-mirror.com',             // HuggingFace 镜像（国内）
        'github.com',                // silero_vad.onnx 等 GitHub releases
        'release-assets.githubusercontent.com',  // GitHub releases 重定向目标
        'objects.githubusercontent.com',         // GitHub releases 重定向目标
    ];

    let parsedTarget;
    try {
        parsedTarget = new URL(targetUrl);
    } catch (e) {
        return new Response('Invalid url parameter', { status: 400 });
    }

    const isAllowed = allowedDomains.some(domain =>
        parsedTarget.hostname === domain || parsedTarget.hostname.endsWith('.' + domain)
    );

    if (!isAllowed) {
        return new Response('Domain not allowed: ' + parsedTarget.hostname, { status: 403 });
    }

    try {
        // 转发请求
        // 注意：HuggingFace Spaces 对某些 User-Agent 返回 401，
        // 使用通用浏览器 UA 避免被拒绝
        const proxyReq = new Request(targetUrl, {
            method: request.method,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': '*/*',
                'Accept-Language': 'en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7',
            },
            // GET/HEAD 不需要 body
            body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
            redirect: 'follow',  // 自动跟随重定向
        });

        // 支持 Range 请求（大文件分块下载）
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
        newHeaders.set('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Content-Type');

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
        return new Response('Proxy error: ' + err.message, { status: 502 });
    }
}
