const https = require('https');
const http = require('http');
const zlib = require('zlib');
const {URL} = require('url');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const EventTarget = require('../env/EventTarget');
const {nativize, cookieJar} = require('../utils/tools');

// ---------------------------------------------------------------------------
// 原生 https/http 请求 —— 替代 node-fetch。
// 原因：node-fetch 的 redirect:'follow' 与 CF CDN 的 gzip+chunked 流管道有兼容问题，
// 实测经常抛 "Invalid response body ... Premature close"。
// 原生 https 手动跟 30x + 手动 gunzip 完全稳定。
// ---------------------------------------------------------------------------
const MAX_REDIRECTS = 5;
const HTTP_TIMEOUT_MS = 30000;

function _decompress(res) {
    const enc = String(res.headers['content-encoding'] || '').toLowerCase();
    if (enc === 'gzip') return res.pipe(zlib.createGunzip());
    if (enc === 'deflate') return res.pipe(zlib.createInflate());
    if (enc === 'br') { try { return res.pipe(zlib.createBrotliDecompress()); } catch (e) {} }
    return res;
}

/**
 * @param {string} url
 * @param {{method:string, headers:object, body:string|Buffer|null}} opts
 * @returns {Promise<{status:number, statusText:string, body:string, headers:object, url:string, rawSetCookie:string[]|null}>}
 */
function nativeRequest(url, opts = {}) {
    const method = (opts.method || 'GET').toUpperCase();
    const reqBody = opts.body || null;
    const reqHeaders = Object.assign({'Accept-Encoding': 'gzip, deflate'}, opts.headers || {});
    if (reqBody && !reqHeaders['Content-Length']) {
        reqHeaders['Content-Length'] = Buffer.byteLength(reqBody);
    }

    const doOne = (currentUrl, hopsLeft) => new Promise((resolve, reject) => {
        let u;
        try { u = new URL(currentUrl); } catch (e) { return reject(new Error('Bad URL: ' + currentUrl)); }
        const lib = u.protocol === 'https:' ? https : http;
        const reqOpts = {
            protocol: u.protocol,
            hostname: u.hostname,
            port: u.port || (u.protocol === 'https:' ? 443 : 80),
            path: u.pathname + u.search,
            method: hopsLeft < MAX_REDIRECTS ? 'GET' : method, // redirects become GET
            headers: hopsLeft < MAX_REDIRECTS ? ((() => { const h = {...reqHeaders}; delete h['Content-Length']; return h; })()) : reqHeaders,
            rejectUnauthorized: false,
        };
        const req = lib.request(reqOpts, (res) => {
            // Collect raw set-cookie for caller
            const rawSetCookie = res.headers['set-cookie'] || null;

            // 3xx redirect
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && hopsLeft > 0) {
                res.resume();
                const nextUrl = new URL(res.headers.location, currentUrl).toString();
                return resolve(doOne(nextUrl, hopsLeft - 1));
            }

            const stream = _decompress(res);
            const chunks = [];
            stream.on('data', (c) => chunks.push(c));
            stream.on('end', () => {
                const body = Buffer.concat(chunks).toString('utf8');
                const headers = {};
                for (const [k, v] of Object.entries(res.headers)) {
                    if (typeof v === 'string') headers[k.toLowerCase()] = v;
                    else if (Array.isArray(v)) headers[k.toLowerCase()] = v.join(', ');
                }
                resolve({status: res.statusCode, statusText: res.statusMessage || '', body, headers, url: currentUrl, rawSetCookie});
            });
            stream.on('error', (e) => reject(new Error('decompress error: ' + e.message)));
        });
        req.setTimeout(HTTP_TIMEOUT_MS, () => req.destroy(new Error('Request timeout')));
        req.on('error', (e) => reject(e));
        if (reqBody && hopsLeft === MAX_REDIRECTS) req.write(reqBody);
        req.end();
    });

    return doOne(url, MAX_REDIRECTS);
}

const CHALLENGE_URL_PATTERN = '/cdn-cgi/challenge-platform/';

const urlToEndpoint = (url) => {
    const m = /\/cdn-cgi\/challenge-platform\/h\/[^/]+\/([^?#]+)/.exec(String(url || ''));
    if (!m) return 'unknown';
    return m[1].replace(/\/+$/, '').replace(/\//g, '-').slice(0, 60) || 'root';
};

const sha256Hex = (buf) =>
    crypto.createHash('sha256').update(buf).digest('hex');

const toBuffer = (value) => {
    if (value == null) return Buffer.alloc(0);
    if (Buffer.isBuffer(value)) return value;
    if (typeof value === 'string') return Buffer.from(value, 'utf8');
    if (value instanceof ArrayBuffer) return Buffer.from(new Uint8Array(value));
    if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
    try {
        return Buffer.from(String(value), 'utf8');
    } catch (e) {
        return Buffer.alloc(0);
    }
};

const normalizeHeaders = (headers) => {
    const out = {};
    if (!headers) return out;
    if (typeof headers.forEach === 'function' && !Array.isArray(headers)) {
        try {
            headers.forEach((val, key) => { out[String(key).toLowerCase()] = String(val); });
            return out;
        } catch (e) {}
    }
    for (const [k, v] of Object.entries(headers)) {
        out[String(k).toLowerCase()] = Array.isArray(v) ? v.join(', ') : String(v);
    }
    return out;
};

module.exports = function (context, rawWindow, profile, opts = {}) {
    context.Headers = context.Headers || rawWindow.Headers;
    context.FormData = context.FormData || rawWindow.FormData;

    const dumpDir = opts.dumpDir
        || process.env.CHALLENGE_DUMP_DIR
        || path.resolve(__dirname, '../../dumps/vm');
    let dumpSeq = 0;
    let dumpDirReady = false;

    const ensureDumpDir = () => {
        if (dumpDirReady) return;
        try {
            fs.mkdirSync(dumpDir, {recursive: true});
            dumpDirReady = true;
        } catch (e) {
            console.log(`[Dump] 创建目录失败 ${dumpDir}: ${e.message}`);
        }
    };

    const recordRequest = (kind, method, url, headers, body) => {
        if (!url || !String(url).includes(CHALLENGE_URL_PATTERN)) return null;
        ensureDumpDir();
        const seq = ++dumpSeq;
        const seqStr = String(seq).padStart(3, '0');
        const endpoint = urlToEndpoint(url);
        const ts = Date.now();
        const baseName = `${seqStr}-${endpoint}-${ts}`;

        const bodyBuf = toBuffer(body);
        const bodyPath = path.join(dumpDir, `${baseName}.bin`);
        try {
            fs.writeFileSync(bodyPath, bodyBuf);
        } catch (e) {
            console.log(`[Dump] 写请求体失败: ${e.message}`);
        }

        const reqHeaders = normalizeHeaders(headers);
        const bodySha = sha256Hex(bodyBuf);
        const preview = bodyBuf.toString('utf8', 0, Math.min(180, bodyBuf.length)).replace(/\s+/g, ' ');
        const tail = bodyBuf.length > 120
            ? bodyBuf.toString('utf8', bodyBuf.length - 120, bodyBuf.length).replace(/\s+/g, ' ')
            : preview;
        const contentType = reqHeaders['content-type'] || '';
        console.log(`>>> [${kind}] body len=${bodyBuf.length}, sha256=${bodySha}, content-type=${contentType || 'none'}`);
        console.log(`>>> [${kind}] body head=${preview}`);
        console.log(`>>> [${kind}] body tail=${tail}`);
        console.log(`>>> [${kind}] body dump=${bodyPath}`);

        const cookieHeader = (() => {
            try { return cookieJar.getCookieString(url); } catch (e) { return ''; }
        })();

        return {
            seq,
            seqStr,
            kind,
            method,
            url,
            endpoint,
            baseName,
            bodyPath,
            bodyLength: bodyBuf.length,
            bodySha,
            reqHeaders,
            cookieHeader,
            startedAt: ts,
        };
    };

    const finalizeRecord = (token, status, statusText, respHeaders, respBody, error) => {
        if (!token) return;
        const respBuf = toBuffer(respBody);
        const respPath = path.join(dumpDir, `${token.baseName}.resp.bin`);
        try {
            fs.writeFileSync(respPath, respBuf);
        } catch (e) {
            console.log(`[Dump] 写响应体失败: ${e.message}`);
        }

        const meta = {
            seq: token.seq,
            side: 'vm',
            kind: token.kind,
            method: token.method,
            url: token.url,
            endpoint: token.endpoint,
            request_headers: token.reqHeaders,
            request_cookie_string: token.cookieHeader,
            request_body_path: path.relative(path.resolve(dumpDir, '..', '..'), token.bodyPath),
            request_body_length: token.bodyLength,
            request_body_sha256: token.bodySha,
            response_status: status == null ? null : Number(status),
            response_status_text: statusText || '',
            response_headers: normalizeHeaders(respHeaders),
            response_body_path: path.relative(path.resolve(dumpDir, '..', '..'), respPath),
            response_body_length: respBuf.length,
            response_body_sha256: sha256Hex(respBuf),
            error: error ? String(error.message || error) : null,
            timestamp_ms: token.startedAt,
            finished_ms: Date.now(),
        };
        const metaPath = path.join(dumpDir, `${token.baseName}.meta.json`);
        try {
            fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
        } catch (e) {
            console.log(`[Dump] 写 meta 失败: ${e.message}`);
        }
    };

    // Fetch 模拟
    context.fetch = nativize(async (url, options = {}) => {
        console.log(`\n>>> [Network] Real Fetch: ${url}`);
        let finalUrl = url;
        if (url.startsWith('/')) {
            const baseUrl = new URL(context.location.href);
            finalUrl = `${baseUrl.origin}${url}`;
        }

        const cookieHeader = cookieJar.getCookieString(finalUrl);
        const headers = {
            ...(options.headers || {}),
            'User-Agent': profile.userAgent,
            'Referer': context.location.href,
            'Cookie': cookieHeader
        };

        const method = options.method || 'GET';
        const token = recordRequest('Fetch', method, finalUrl, headers, options.body);

        try {
            const response = await nativeRequest(finalUrl, {
                method,
                headers: headers,
                body: options.body || null,
            });

            if (response.rawSetCookie) {
                const updated = cookieJar.setCookie(response.rawSetCookie);
                console.log(`>>> [Cookie] Updated: ${updated.join(', ') || 'unknown'}`);
            }

            const text = response.body;
            console.log(`>>> [Network] Response (${response.status}): ${text.substring(0, 50)}...`);

            finalizeRecord(token, response.status, response.statusText, response.headers, text, null);

            return {
                ok: response.status >= 200 && response.status < 300,
                status: response.status,
                statusText: response.statusText,
                url: response.url,
                headers: {get: (n) => response.headers[String(n).toLowerCase()] || null},
                text: async () => text,
                json: async () => {
                    try {
                        return JSON.parse(text);
                    } catch (e) {
                        return {};
                    }
                }
            };
        } catch (e) {
            console.error("Fetch Error:", e);
            finalizeRecord(token, 0, '', {}, '', e);
            throw e;
        }
    }, 'fetch');
    rawWindow.fetch = context.fetch;

    // XHR 模拟
    context.XMLHttpRequest = nativize(class XMLHttpRequest extends EventTarget {
        constructor() {
            super();
            this.readyState = 0;
            this.status = 0;
            this.statusText = '';
            this.response = '';
            this.responseText = '';
            this.responseType = '';
            this.responseURL = '';
            this.withCredentials = false;
            this.timeout = 0;
            this.onreadystatechange = null;
            this.onload = null;
            this.onerror = null;
            this.ontimeout = null;
            this._reqHeaders = {};
            this._respHeaders = {};
            this._url = '';
            this._method = 'GET';
        }

        open(method, url) {
            this._method = method;
            this._url = url;
            if (this._url && this._url.startsWith('/')) {
                this._url = `${new URL(context.location.href).origin}${this._url}`;
            }
            // 非侵入观测点：challenge XHR 一旦 open 就打印（不改 this 的可检测特征）。
            // 配合 send 日志可判断“open 了但没 send”这种卡点。
            if (this._url.includes(CHALLENGE_URL_PATTERN)) {
                console.log(`>>> [XHR] open ${method} ${this._url.slice(0, 90)}`);
            }
            this.readyState = 1;
            if (this.onreadystatechange) this.onreadystatechange();
        }

        setRequestHeader(k, v) {
            this._reqHeaders[k] = v;
        }

        send(body) {
            const reqHeaders = {
                ...this._reqHeaders,
                'User-Agent': profile.userAgent,
                'Referer': context.location.href,
            };
            const cookie = cookieJar.getCookieString(this._url);
            if (cookie) reqHeaders['Cookie'] = cookie;
            if (
                body != null &&
                this._url.includes(CHALLENGE_URL_PATTERN) &&
                !Object.keys(reqHeaders).some((key) => key.toLowerCase() === 'content-type')
            ) {
                reqHeaders['Content-Type'] = 'text/plain;charset=UTF-8';
            }

            console.log(`\n>>> [XHR] ${this._method} ${this._url}`);
            const token = recordRequest('XHR', this._method, this._url, reqHeaders, body);

            nativeRequest(this._url, {
                method: this._method,
                headers: reqHeaders,
                body: body || null,
            }).then((resp) => {
                this.status = resp.status;
                this.statusText = resp.statusText || '';
                this.responseURL = resp.url || this._url;

                // 收集响应头
                this._respHeaders = resp.headers;

                // 更新 cookie
                if (resp.rawSetCookie) {
                    const updated = cookieJar.setCookie(resp.rawSetCookie);
                    console.log(`>>> [XHR] Cookie 已更新: ${updated.join(', ') || 'unknown'}`);
                }

                const text = resp.body;
                this.responseText = text;
                this.response = text;
                this.readyState = 4;
                console.log(`>>> [XHR] 响应 ${resp.status}: ${text.substring(0, 100)}`);

                finalizeRecord(token, resp.status, resp.statusText, resp.headers, text, null);

                if (this.onreadystatechange) this.onreadystatechange();
                if (this.onload) this.onload();
                this.dispatchEvent({type: 'load'});
            }).catch((err) => {
                console.log(`>>> [XHR] 错误: ${err.message}`);
                this.readyState = 4;
                this.status = 0;
                finalizeRecord(token, 0, '', {}, '', err);
                if (this.onerror) this.onerror(err);
                this.dispatchEvent({type: 'error'});
            });
        }

        abort() { this.readyState = 0; }

        getAllResponseHeaders() {
            return Object.entries(this._respHeaders).map(([k, v]) => `${k}: ${v}`).join('\r\n');
        }

        getResponseHeader(k) {
            return this._respHeaders[k.toLowerCase()] || null;
        }
    }, 'XMLHttpRequest');
    rawWindow.XMLHttpRequest = context.XMLHttpRequest;
    rawWindow.Headers = context.Headers;
    rawWindow.FormData = context.FormData;
    if (context.Request) rawWindow.Request = context.Request;
    if (context.Response) rawWindow.Response = context.Response;
};
