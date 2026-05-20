#!/usr/bin/env python3
"""真浏览器跑 CF challenge，把所有 /cdn-cgi/challenge-platform/ 请求体/响应体 dump 到本地，
和 VM 框架的 dumps/vm 配对做对账分析。"""
import argparse
import hashlib
import json
import re
import shutil
import sys
import time
from pathlib import Path

try:
    from patchright.sync_api import sync_playwright
except ImportError:
    print(
        "[fatal] 需要 patchright（Playwright 反检测分叉）。请先执行:\n"
        "    pip install patchright\n"
        "    patchright install chromium   # 可选，channel=chrome 时不需要",
        file=sys.stderr,
    )
    sys.exit(1)

from capture_challenge_playwright import DEFAULT_URL, DEFAULT_UA

ROOT = Path(__file__).resolve().parent
CHALLENGE_PATTERN = "/cdn-cgi/challenge-platform/"


def url_to_endpoint(url):
    m = re.search(r"/cdn-cgi/challenge-platform/h/[^/]+/([^?#]+)", url)
    if not m:
        return "unknown"
    slug = m.group(1).rstrip("/").replace("/", "-")[:60]
    return slug or "root"


def sha256_hex(data):
    return hashlib.sha256(data or b"").hexdigest()


def normalize_headers(headers):
    out = {}
    for k, v in (headers or {}).items():
        out[str(k).lower()] = str(v)
    return out


def collect(args):
    dump_dir = (ROOT / args.dump_dir).resolve()
    if args.clear_dir and dump_dir.exists():
        shutil.rmtree(dump_dir)
    dump_dir.mkdir(parents=True, exist_ok=True)
    print(f"[Dump] real-side dump dir: {dump_dir}")

    state = {"seq": 0, "by_request": {}}

    def write_meta(token, status, status_text, resp_headers, resp_body, error):
        resp_buf = resp_body or b""
        resp_path = dump_dir / f"{token['base']}.resp.bin"
        try:
            resp_path.write_bytes(resp_buf)
        except OSError as e:
            print(f"[Dump] 写响应体失败: {e}")
        meta = {
            "seq": token["seq"],
            "side": "real",
            "kind": "playwright",
            "method": token["method"],
            "url": token["url"],
            "endpoint": token["endpoint"],
            "request_headers": token["request_headers"],
            "request_body_path": str(token["body_path"].relative_to(ROOT)),
            "request_body_length": token["body_length"],
            "request_body_sha256": token["body_sha256"],
            "response_status": status,
            "response_status_text": status_text or "",
            "response_headers": normalize_headers(resp_headers or {}),
            "response_body_path": str(resp_path.relative_to(ROOT)),
            "response_body_length": len(resp_buf),
            "response_body_sha256": sha256_hex(resp_buf),
            "error": str(error) if error else None,
            "timestamp_ms": token["timestamp_ms"],
            "finished_ms": int(time.time() * 1000),
        }
        meta_path = dump_dir / f"{token['base']}.meta.json"
        try:
            meta_path.write_text(json.dumps(meta, indent=2, ensure_ascii=False))
        except OSError as e:
            print(f"[Dump] 写 meta 失败: {e}")

    def on_request(request):
        url = request.url
        if CHALLENGE_PATTERN not in url:
            return
        state["seq"] += 1
        seq = state["seq"]
        seq_str = f"{seq:03d}"
        endpoint = url_to_endpoint(url)
        ts = int(time.time() * 1000)
        base = f"{seq_str}-{endpoint}-{ts}"

        try:
            body_buf = request.post_data_buffer or b""
        except Exception:
            body_buf = b""

        body_path = dump_dir / f"{base}.bin"
        try:
            body_path.write_bytes(body_buf)
        except OSError as e:
            print(f"[Dump] 写请求体失败: {e}")

        token = {
            "seq": seq,
            "base": base,
            "url": url,
            "method": request.method,
            "endpoint": endpoint,
            "body_path": body_path,
            "body_length": len(body_buf),
            "body_sha256": sha256_hex(body_buf),
            "request_headers": normalize_headers(request.headers),
            "timestamp_ms": ts,
        }
        state["by_request"][id(request)] = token
        preview = body_buf[:120].decode("utf-8", errors="replace").replace("\n", " ")
        print(f"[req {seq_str}] {request.method} {endpoint} len={len(body_buf)} head={preview[:80]}")

    def on_request_finished(request):
        token = state["by_request"].pop(id(request), None)
        if not token:
            return
        try:
            resp = request.response()
        except Exception as e:
            write_meta(token, None, "", {}, b"", f"response() raised: {e}")
            return
        if resp is None:
            write_meta(token, None, "", {}, b"", "no response")
            return
        try:
            body = resp.body()
        except Exception as e:
            write_meta(token, resp.status, resp.status_text, resp.headers, b"", f"body() raised: {e}")
            return
        write_meta(token, resp.status, resp.status_text, resp.headers, body, None)
        print(f"[resp {token['seq']:03d}] {resp.status} {token['endpoint']} body_len={len(body)}")

    def on_request_failed(request):
        token = state["by_request"].pop(id(request), None)
        if not token:
            return
        failure = ""
        try:
            failure = request.failure or ""
        except Exception:
            pass
        write_meta(token, None, "", {}, b"", f"failed: {failure}")
        print(f"[fail {token['seq']:03d}] {token['endpoint']}: {failure}")

    clearance_value = None
    clearance_seen_at = None

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
            },
        )
        page = context.new_page()
        page.on("request", on_request)
        page.on("requestfinished", on_request_finished)
        page.on("requestfailed", on_request_failed)

        print(f"[open] {args.url}")
        try:
            page.goto(args.url, wait_until="domcontentloaded", timeout=args.goto_timeout)
        except Exception as e:
            print(f"[warn] goto 异常: {e}")

        deadline = time.time() + args.timeout / 1000
        while time.time() < deadline:
            try:
                cookies = context.cookies()
            except Exception:
                cookies = []
            for c in cookies:
                if c.get("name") == "cf_clearance" and c.get("value") and clearance_seen_at is None:
                    clearance_seen_at = time.time()
                    clearance_value = c["value"]
                    print(f"[hit] cf_clearance={clearance_value[:48]}{'...' if len(clearance_value) > 48 else ''}")
            if clearance_seen_at and time.time() - clearance_seen_at >= args.grace / 1000:
                print("[done] cf_clearance 后宽限期结束，准备退出")
                break
            page.wait_for_timeout(500)

        if not clearance_seen_at:
            print("[fail] 超时未拿到 cf_clearance")

        # 把当前 cookie 整套快照存下来，方便业务方复用
        try:
            cookies = context.cookies()
            (dump_dir / "_cookies.json").write_text(
                json.dumps(cookies, indent=2, ensure_ascii=False)
            )
        except Exception as e:
            print(f"[warn] dump cookies 失败: {e}")

        # 收尾：把 still-pending 的请求标成未完成
        for token in list(state["by_request"].values()):
            write_meta(token, None, "", {}, b"", "still pending at browser close")
        state["by_request"].clear()

        browser.close()

    files = sorted(dump_dir.glob("*.meta.json"))
    print(f"\n[summary] {len(files)} 条完整记录写入 {dump_dir}")
    by_ep = {}
    for f in files:
        try:
            meta = json.loads(f.read_text())
            by_ep[meta["endpoint"]] = by_ep.get(meta["endpoint"], 0) + 1
        except Exception:
            pass
    for ep, n in sorted(by_ep.items(), key=lambda x: (-x[1], x[0])):
        print(f"  {ep:40s} {n}")

    return 0 if clearance_seen_at else 2


def main():
    parser = argparse.ArgumentParser(
        description="Playwright 真浏览器解 CF challenge，把 challenge-platform 请求/响应 dump 到本地用于对账。"
    )
    parser.add_argument("url", nargs="?", default=DEFAULT_URL)
    parser.add_argument("--dump-dir", default="dumps/real")
    parser.add_argument("--clear-dir", action="store_true", help="运行前清空 dump 目录")
    parser.add_argument("--timeout", type=int, default=60000,
                        help="等待 cf_clearance 的最长毫秒数")
    parser.add_argument("--grace", type=int, default=3000,
                        help="拿到 cf_clearance 后再等多久退出（毫秒）")
    parser.add_argument("--goto-timeout", type=int, default=60000)
    parser.add_argument("--headless", action="store_true")
    parser.add_argument("--user-agent", default=DEFAULT_UA)
    parser.add_argument("--locale", default="zh-CN")
    parser.add_argument("--accept-language", default="zh-CN,zh;q=0.9,en;q=0.8")
    parser.add_argument("--channel", default="chrome",
                        help='Chromium channel，默认 "chrome" 使用系统安装的真 Chrome；'
                             '传空串走 patchright 自带 chromium')
    args = parser.parse_args()
    if args.channel == "":
        args.channel = None
    raise SystemExit(collect(args))


if __name__ == "__main__":
    main()
