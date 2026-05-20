#!/usr/bin/env python3
import argparse
import os
import re
import sys
import time
from pathlib import Path
from urllib.parse import urlparse

try:
    from patchright.sync_api import TimeoutError as PlaywrightTimeoutError
    from patchright.sync_api import sync_playwright
except ImportError:
    print(
        "[fatal] 需要 patchright（Playwright 反检测分叉）。请先执行:\n"
        "    pip install patchright\n"
        "    patchright install chromium   # 可选，channel=chrome 时不需要",
        file=sys.stderr,
    )
    sys.exit(1)


ROOT = Path(__file__).resolve().parent
DEFAULT_URL = (
    "https://www.sciencedirect.com/science/article/pii/S2214914725004428"
    "?ref=cra_js_challenge&fr=RR-102&arc=HV-3&rr=9fa78124ca97c9fd"
)
DEFAULT_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/119.0.0.0 Safari/537.36"
)


def extract_cf_chl_opt(html):
    marker = "window._cf_chl_opt"
    pos = html.find(marker)
    if pos < 0:
        return None

    eq = html.find("=", pos)
    if eq < 0:
        return None

    start = html.find("{", eq)
    if start < 0:
        return None

    depth = 0
    quote = None
    escaped = False
    line_comment = False
    block_comment = False

    for i in range(start, len(html)):
        ch = html[i]
        nxt = html[i + 1] if i + 1 < len(html) else ""

        if line_comment:
            if ch in "\r\n":
                line_comment = False
            continue

        if block_comment:
            if ch == "*" and nxt == "/":
                block_comment = False
            continue

        if quote:
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == quote:
                quote = None
            continue

        if ch in ("'", '"', "`"):
            quote = ch
            continue

        if ch == "/" and nxt == "/":
            line_comment = True
            continue

        if ch == "/" and nxt == "*":
            block_comment = True
            continue

        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return html[start:i + 1]

    return None


def extract_value(obj, key):
    match = re.search(rf"{re.escape(key)}['\"]?\s*:\s*['\"]([^'\"]+)", obj)
    return match.group(1) if match else None


def extract_orchestrate_url(html, page_url):
    match = re.search(r"""src=['"]([^'"]*orchestrate/chl_page/[^'"]*)['"]""", html)
    if not match:
        return None
    src = match.group(1)
    if src.startswith("//"):
        return "https:" + src
    if src.startswith("/"):
        parsed = urlparse(page_url)
        return f"{parsed.scheme}://{parsed.netloc}{src}"
    if src.startswith("http://") or src.startswith("https://"):
        return src
    parsed = urlparse(page_url)
    base_path = parsed.path.rsplit("/", 1)[0]
    return f"{parsed.scheme}://{parsed.netloc}{base_path}/{src}"


def extract_ray_from_orchestrate_url(url):
    match = re.search(r"[?&]ray=([^&]+)", url)
    return match.group(1) if match else None


def looks_like_article_challenge(url, status, body):
    if status not in (403, 503):
        return False
    if "_cf_chl_opt" not in body:
        return False
    parsed = urlparse(url)
    return parsed.netloc.endswith("sciencedirect.com") and "/science/article/pii/" in parsed.path


def write_text(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def capture(args):
    out_config = ROOT / args.config
    out_target = ROOT / args.target
    out_html = ROOT / args.html

    state = {
        "cf_config": None,
        "cf_url": None,
        "cf_ray": None,
        "target_js": None,
        "target_url": None,
        "html": None,
        "orchestrate_url": None,
    }

    def maybe_done():
        return state["cf_config"] is not None and state["target_js"] is not None

    def on_response(resp):
        url = resp.url
        status = resp.status

        is_orchestrate = "/cdn-cgi/challenge-platform/" in url and "/orchestrate/chl_page/" in url
        is_candidate_doc = (
            url.startswith("https://www.sciencedirect.com/science/article/pii/")
            or resp.request.resource_type == "document"
        )

        if not is_orchestrate and not is_candidate_doc:
            return

        if is_orchestrate:
            target_ray = extract_ray_from_orchestrate_url(url)
            if state["cf_ray"] and target_ray == state["cf_ray"]:
                state["orchestrate_url"] = url

        try:
            body = resp.text()
        except Exception as exc:
            print(f"[skip] 无法读取响应体 {status} {url[:120]}: {exc}")
            return

        if state["cf_config"] is None and looks_like_article_challenge(url, status, body):
            obj = extract_cf_chl_opt(body)
            if obj:
                state["cf_config"] = f"module.exports = {obj};\n"
                state["cf_url"] = url
                state["cf_ray"] = extract_value(obj, "cRay")
                state["html"] = body
                state["orchestrate_url"] = extract_orchestrate_url(body, url)
                ctype = extract_value(obj, "cType")
                print("[hit] 403 HTML")
                print(f"      url   : {url}")
                print(f"      cRay  : {state['cf_ray'] or '-'}")
                print(f"      cType : {ctype or '-'}")
                if state["orchestrate_url"]:
                    print(f"      script: {state['orchestrate_url']}")
            return

        if state["target_js"] is None and is_orchestrate and len(body) > 1000:
            target_ray = extract_ray_from_orchestrate_url(url)
            if state["cf_ray"] and target_ray and target_ray != state["cf_ray"]:
                print(f"[skip] orchestrate ray 不匹配: {target_ray} != {state['cf_ray']}")
                return
            state["target_js"] = body
            state["target_url"] = url
            print("[hit] orchestrate JS")
            print(f"      url  : {url}")
            print(f"      size : {len(body)} bytes")

    with sync_playwright() as p:
        launch_args = {}
        if args.channel:
            launch_args["channel"] = args.channel
        browser = p.chromium.launch(headless=args.headless, **launch_args)
        context = browser.new_context(
            user_agent=args.user_agent,
            locale=args.locale,
            viewport={"width": 1365, "height": 900},
            extra_http_headers={
                "Accept-Language": args.accept_language,
                "Cache-Control": "no-cache",
                "Pragma": "no-cache",
            },
        )
        page = context.new_page()
        page.on("response", on_response)

        try:
            print(f"[open] {args.url}")
            page.goto(args.url, wait_until="domcontentloaded", timeout=args.goto_timeout)
        except PlaywrightTimeoutError:
            print("[warn] 首次打开超时，继续等待网络响应")
        except Exception as exc:
            print(f"[warn] 首次打开异常: {exc}")

        if args.reload:
            try:
                print("[reload] 刷新页面以重新捕获 Network 响应")
                page.reload(wait_until="domcontentloaded", timeout=args.goto_timeout)
            except PlaywrightTimeoutError:
                print("[warn] 刷新超时，继续等待网络响应")
            except Exception as exc:
                print(f"[warn] 刷新异常: {exc}")

        deadline = time.time() + args.wait / 1000
        while time.time() < deadline and not maybe_done():
            page.wait_for_timeout(250)

        if state["cf_config"] and state["orchestrate_url"]:
            target_ray = extract_ray_from_orchestrate_url(state["target_url"] or "")
            if state["target_js"] is None or (state["cf_ray"] and target_ray != state["cf_ray"]):
                print("[fetch] 用 403 HTML 中的 script src 主动获取配套 orchestrate JS")
                try:
                    resp = context.request.get(
                        state["orchestrate_url"],
                        headers={
                            "Referer": state["cf_url"],
                            "Accept": "*/*",
                            "Cache-Control": "no-cache",
                            "Pragma": "no-cache",
                        },
                        timeout=args.goto_timeout,
                    )
                    body = resp.text()
                    if resp.ok and len(body) > 1000:
                        state["target_js"] = body
                        state["target_url"] = state["orchestrate_url"]
                        print("[hit] paired orchestrate JS")
                        print(f"      url  : {state['target_url']}")
                        print(f"      size : {len(body)} bytes")
                    else:
                        print(f"[fail] 配套 orchestrate 响应异常: {resp.status} size={len(body)}")
                except Exception as exc:
                    print(f"[fail] 主动获取配套 orchestrate 失败: {exc}")

        browser.close()

    if not state["cf_config"]:
        print("[fail] 没有捕获到包含 window._cf_chl_opt 的 403/503 HTML")
    if not state["target_js"]:
        print("[fail] 没有捕获到 orchestrate/chl_page/v1 响应")

    if not maybe_done():
        return 1

    if args.dry_run:
        print("[dry-run] 已捕获但不写文件")
        return 0

    write_text(out_config, state["cf_config"])
    write_text(out_target, state["target_js"])
    if args.save_html:
        write_text(out_html, state["html"])

    print("[write] " + str(out_config.relative_to(ROOT)))
    print("[write] " + str(out_target.relative_to(ROOT)))
    if args.save_html:
        print("[write] " + str(out_html.relative_to(ROOT)))
    print("[done] 已更新 cfConfig.js 和 target.js")
    return 0


def main():
    parser = argparse.ArgumentParser(
        description="用 Playwright 自动捕获 ScienceDirect CF challenge 的 _cf_chl_opt 和 orchestrate JS。"
    )
    parser.add_argument("url", nargs="?", default=DEFAULT_URL)
    parser.add_argument("--config", default="src/config/cfConfig.js")
    parser.add_argument("--target", default="target/target.js")
    parser.add_argument("--html", default="target/challenge.html")
    parser.add_argument("--wait", type=int, default=45000, help="等待响应的毫秒数")
    parser.add_argument("--goto-timeout", type=int, default=60000)
    parser.add_argument("--headless", action="store_true")
    parser.add_argument("--no-reload", dest="reload", action="store_false")
    parser.add_argument("--no-save-html", dest="save_html", action="store_false")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--channel", default=os.environ.get("PW_CHROME_CHANNEL", "chrome"),
                        help='Chromium channel，默认 "chrome" 用系统真 Chrome；传空串走 patchright 自带 chromium')
    parser.add_argument("--locale", default="zh-CN")
    parser.add_argument("--accept-language", default="zh-CN,zh;q=0.9,en;q=0.8")
    parser.add_argument("--user-agent", default=DEFAULT_UA)
    parser.set_defaults(reload=True, save_html=True)
    args = parser.parse_args()

    if args.channel == "":
        args.channel = None

    raise SystemExit(capture(args))


if __name__ == "__main__":
    main()
