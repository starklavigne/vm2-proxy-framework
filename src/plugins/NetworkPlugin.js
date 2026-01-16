const fetch = require('node-fetch');
const {URL} = require('url');
const EventTarget = require('../env/EventTarget');
const {nativize, cookieJar} = require('../utils/tools');

module.exports = function (context, rawWindow, profile) {

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
                cookieJar.setCookie(setCookie);
                console.log(">>> [Cookie] Updated");
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

    // XHR 模拟
    context.XMLHttpRequest = nativize(class XMLHttpRequest extends EventTarget {
        constructor() {
            super();
            this.readyState = 0;
            this._headers = {};
        }

        open(method, url) {
            this._method = method;
            this._url = url;
            if (this._url.startsWith('/')) this._url = `${new URL(context.location.href).origin}${this._url}`;
            this.readyState = 1;
            if (this.onreadystatechange) this.onreadystatechange();
        }

        setRequestHeader(k, v) {
            this._headers[k] = v;
        }

        send(body) {
            this._headers['User-Agent'] = profile.userAgent;
            this._headers['Referer'] = context.location.href;
            const cookie = cookieJar.getCookieString(this._url);
            if (cookie) this._headers['Cookie'] = cookie;

            fetch(this._url, {method: this._method, headers: this._headers, body: body}).then(async (resp) => {
                this.status = resp.status;
                this.responseText = await resp.text();
                this.response = this.responseText;
                this.readyState = 4;
                if (this.onreadystatechange) this.onreadystatechange();
                if (this.onload) this.onload();
                this.dispatchEvent({type: 'load'});
            });
        }

        getAllResponseHeaders() {
            return "";
        }
    }, 'XMLHttpRequest');
};