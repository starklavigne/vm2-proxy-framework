const fetch = require('node-fetch');
const {URL} = require('url');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const EventTarget = require('../env/EventTarget');
const {nativize, cookieJar} = require('../utils/tools');

module.exports = function (context, rawWindow, profile) {
    context.Headers = context.Headers || rawWindow.Headers;
    context.FormData = context.FormData || rawWindow.FormData;

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

        try {
            const response = await fetch(finalUrl, {
                method: options.method || 'GET',
                headers: headers,
                body: options.body,
                redirect: 'manual'
            });

            const setCookie = response.headers.raw()['set-cookie'];
            if (setCookie) {
                const updated = cookieJar.setCookie(setCookie);
                console.log(`>>> [Cookie] Updated: ${updated.join(', ') || 'unknown'}`);
            }

            const text = await response.text();
            console.log(`>>> [Network] Response (${response.status}): ${text.substring(0, 50)}...`);

            return {
                ok: response.ok, status: response.status, statusText: response.statusText, url: response.url,
                headers: {get: (n) => response.headers.get(n)},
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
            throw e;
        }
    }, 'fetch');
    rawWindow.fetch = context.fetch;

    const dumpChallengeRequest = (kind, url, headers, body) => {
        if (!url || !String(url).includes('/cdn-cgi/challenge-platform/')) return;
        if (body == null) return;

        const bodyText = typeof body === 'string' || Buffer.isBuffer(body)
            ? String(body)
            : String(body);
        const hash = crypto.createHash('sha256').update(bodyText).digest('hex');
        const safeName = `${kind}-${Date.now()}-${hash.slice(0, 10)}.txt`;
        const dumpPath = path.join(os.tmpdir(), safeName);
        fs.writeFileSync(dumpPath, bodyText, 'utf8');

        const headerEntries = Object.entries(headers || {})
            .map(([k, v]) => [String(k).toLowerCase(), String(v)]);
        const contentType = (headerEntries.find(([k]) => k === 'content-type') || [null, ''])[1];
        const preview = bodyText.slice(0, 180).replace(/\s+/g, ' ');
        const tail = bodyText.slice(-120).replace(/\s+/g, ' ');

        console.log(`>>> [${kind}] body len=${bodyText.length}, sha256=${hash}, content-type=${contentType || 'none'}`);
        console.log(`>>> [${kind}] body head=${preview}`);
        console.log(`>>> [${kind}] body tail=${tail}`);
        console.log(`>>> [${kind}] body dump=${dumpPath}`);
    };

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
                this._url.includes('/cdn-cgi/challenge-platform/') &&
                !Object.keys(reqHeaders).some((key) => key.toLowerCase() === 'content-type')
            ) {
                reqHeaders['Content-Type'] = 'text/plain;charset=UTF-8';
            }

            console.log(`\n>>> [XHR] ${this._method} ${this._url}`);
            dumpChallengeRequest('XHR', this._url, reqHeaders, body);

            fetch(this._url, {
                method: this._method,
                headers: reqHeaders,
                body: body || undefined,
                redirect: 'manual',
            }).then(async (resp) => {
                this.status = resp.status;
                this.statusText = resp.statusText || '';
                this.responseURL = resp.url || this._url;

                // 收集响应头
                const rawHeaders = {};
                resp.headers.forEach((val, key) => { rawHeaders[key.toLowerCase()] = val; });
                this._respHeaders = rawHeaders;

                // 更新 cookie
                const setCookieArr = resp.headers.raw ? resp.headers.raw()['set-cookie'] : null;
                if (setCookieArr) {
                    const updated = cookieJar.setCookie(setCookieArr);
                    console.log(`>>> [XHR] Cookie 已更新: ${updated.join(', ') || 'unknown'}`);
                }

                const text = await resp.text();
                this.responseText = text;
                this.response = text;
                this.readyState = 4;
                console.log(`>>> [XHR] 响应 ${resp.status}: ${text.substring(0, 100)}`);

                if (this.onreadystatechange) this.onreadystatechange();
                if (this.onload) this.onload();
                this.dispatchEvent({type: 'load'});
            }).catch((err) => {
                console.log(`>>> [XHR] 错误: ${err.message}`);
                this.readyState = 4;
                this.status = 0;
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
