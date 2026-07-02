#!/usr/bin/env python3
"""把 dumps/real 和 dumps/vm 里的 CF challenge 请求/响应做对账 diff，
报告哪个端点缺失、长度/字节差异在哪。"""
import argparse
import difflib
import json
import re
import sys
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent.parent


def load_side(dir_path):
    if not dir_path.exists():
        return []
    records = []
    for meta_path in sorted(dir_path.glob("*.meta.json")):
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
        except Exception as e:
            print(f"[warn] 读 meta 失败 {meta_path}: {e}", file=sys.stderr)
            continue
        meta["_meta_path"] = meta_path
        meta["_dir"] = dir_path
        records.append(meta)
    records.sort(key=lambda r: r.get("seq", 0))
    return records


def group_by_endpoint(records):
    out = {}
    for r in records:
        ep = r.get("endpoint", "unknown")
        out.setdefault(ep, []).append(r)
    return out


def read_body(record, kind):
    rel = record.get(f"{kind}_body_path")
    if not rel:
        return b""
    p = ROOT / rel
    if not p.exists():
        meta_dir = record["_meta_path"].parent
        p = meta_dir / Path(rel).name
        if not p.exists():
            return b""
    try:
        return p.read_bytes()
    except Exception:
        return b""


def looks_like_text(buf, threshold=0.95):
    if not buf:
        return True
    sample = buf[:4096]
    if not sample:
        return True
    printable = sum(1 for b in sample if 9 <= b <= 13 or 32 <= b <= 126)
    return printable / len(sample) >= threshold


def try_parse_json(buf):
    if not buf:
        return None
    try:
        return json.loads(buf.decode("utf-8"))
    except Exception:
        return None


def json_deep_diff(a, b, path="$"):
    diffs = []
    if type(a) is not type(b):
        diffs.append((path, f"type {type(a).__name__} -> {type(b).__name__}", a, b))
        return diffs
    if isinstance(a, dict):
        keys = sorted(set(a) | set(b))
        for k in keys:
            if k not in a:
                diffs.append((f"{path}.{k}", "added in vm", None, b[k]))
            elif k not in b:
                diffs.append((f"{path}.{k}", "missing in vm", a[k], None))
            else:
                diffs.extend(json_deep_diff(a[k], b[k], f"{path}.{k}"))
    elif isinstance(a, list):
        if len(a) != len(b):
            diffs.append((path, f"len {len(a)} -> {len(b)}", a[:3], b[:3]))
        for i in range(min(len(a), len(b))):
            diffs.extend(json_deep_diff(a[i], b[i], f"{path}[{i}]"))
    else:
        if a != b:
            diffs.append((path, "value", a, b))
    return diffs


def first_diff_offset(a, b):
    n = min(len(a), len(b))
    for i in range(n):
        if a[i] != b[i]:
            return i
    if len(a) != len(b):
        return n
    return -1


def hex_dump(buf, n=64):
    return " ".join(f"{b:02x}" for b in buf[:n])


def strip_dynamic(url):
    if not url:
        return ""
    try:
        u = urlparse(url)
        return f"{u.scheme}://{u.netloc}{u.path}"
    except Exception:
        return url


def diff_pair(real, vm, lines):
    ep = (real or vm).get("endpoint", "?")
    seq_r = real.get("seq") if real else None
    seq_v = vm.get("seq") if vm else None
    lines.append("")
    lines.append(f"### endpoint={ep}  seq real={seq_r} / vm={seq_v}")

    if real is None:
        lines.append(f"  ! MISSING on real side (vm sent extra request: {vm.get('url')})")
        return
    if vm is None:
        lines.append(f"  ! MISSING on vm side  (real had: {real.get('method')} {strip_dynamic(real.get('url'))})")
        lines.append(f"    real body_len={real.get('request_body_length')} status={real.get('response_status')}")
        return

    real_url = strip_dynamic(real.get("url"))
    vm_url = strip_dynamic(vm.get("url"))
    if real_url != vm_url:
        lines.append(f"  URL  : real={real_url}")
        lines.append(f"         vm  ={vm_url}")
    else:
        lines.append(f"  URL  : {real_url}")

    if real.get("method") != vm.get("method"):
        lines.append(f"  METHOD diff: real={real.get('method')} vm={vm.get('method')}")

    rl, vl = real.get("request_body_length", 0), vm.get("request_body_length", 0)
    rs, vs = real.get("request_body_sha256"), vm.get("request_body_sha256")
    same_body = (rl == vl) and (rs == vs)
    lines.append(
        f"  REQ  : len real={rl:>6} vm={vl:>6} Δ={vl - rl:+d}  "
        f"sha {'EQUAL' if rs == vs else 'DIFF'}"
    )

    resp_r = real.get("response_status")
    resp_v = vm.get("response_status")
    if resp_r != resp_v:
        lines.append(f"  RESP : status real={resp_r} vm={resp_v}  *** MISMATCH ***")
    else:
        lines.append(f"  RESP : status={resp_r}  resp_len real={real.get('response_body_length')} vm={vm.get('response_body_length')}")

    if same_body:
        lines.append("  body identical, skip content diff")
        return

    rbuf = read_body(real, "request")
    vbuf = read_body(vm, "request")

    rj, vj = try_parse_json(rbuf), try_parse_json(vbuf)
    if rj is not None and vj is not None:
        diffs = json_deep_diff(rj, vj)
        lines.append(f"  JSON diff: {len(diffs)} 处差异")
        for path, kind, ra, rv in diffs[:40]:
            ra_s = json.dumps(ra, ensure_ascii=False) if not isinstance(ra, str) else ra
            rv_s = json.dumps(rv, ensure_ascii=False) if not isinstance(rv, str) else rv
            if isinstance(ra_s, str) and len(ra_s) > 100:
                ra_s = ra_s[:100] + "..."
            if isinstance(rv_s, str) and len(rv_s) > 100:
                rv_s = rv_s[:100] + "..."
            lines.append(f"    {path:30s} [{kind}] real={ra_s} vm={rv_s}")
        if len(diffs) > 40:
            lines.append(f"    ... 还有 {len(diffs) - 40} 处省略")
        return

    if looks_like_text(rbuf) and looks_like_text(vbuf):
        rl_lines = rbuf.decode("utf-8", errors="replace").splitlines()
        vl_lines = vbuf.decode("utf-8", errors="replace").splitlines()
        diff = list(difflib.unified_diff(rl_lines, vl_lines, lineterm="", fromfile="real", tofile="vm", n=2))
        if diff:
            lines.append("  TEXT unified diff (前 60 行):")
            for ln in diff[:60]:
                lines.append("    " + ln)
            if len(diff) > 60:
                lines.append(f"    ... 还有 {len(diff) - 60} 行省略")
        else:
            lines.append("  TEXT diff: 内容相同但 sha 不同（可能尾部空白差异）")
        return

    # binary
    off = first_diff_offset(rbuf, vbuf)
    lines.append(f"  BIN  : first diff offset = {off if off >= 0 else 'EQUAL'}")
    lines.append(f"    real[0:64]={hex_dump(rbuf)}")
    lines.append(f"    vm  [0:64]={hex_dump(vbuf)}")
    if off >= 0:
        s, e = max(0, off - 8), off + 32
        lines.append(f"    real[{s}:{e}]={hex_dump(rbuf[s:e], e - s)}")
        lines.append(f"    vm  [{s}:{e}]={hex_dump(vbuf[s:e], e - s)}")


def render_summary(real_by_ep, vm_by_ep, lines):
    eps = sorted(set(real_by_ep) | set(vm_by_ep))
    lines.append("## 摘要")
    lines.append("")
    lines.append("| endpoint | real | vm  | 备注 |")
    lines.append("|---|---|---|---|")
    for ep in eps:
        r = len(real_by_ep.get(ep, []))
        v = len(vm_by_ep.get(ep, []))
        note = ""
        if v == 0 and r > 0:
            note = "**VM 没跑到这里**"
        elif r == 0 and v > 0:
            note = "VM 多发了不该有的请求"
        elif v != r:
            note = f"数量不齐 (Δ={v - r:+d})"
        lines.append(f"| {ep} | {r} | {v} | {note} |")
    lines.append("")


def main():
    parser = argparse.ArgumentParser(
        description="对比 dumps/real 和 dumps/vm 的 CF challenge 请求/响应"
    )
    parser.add_argument("--real", default="dumps/real")
    parser.add_argument("--vm", default="dumps/vm")
    parser.add_argument("--out", default=None, help="输出报告到指定文件（同时打印到 stdout）")
    args = parser.parse_args()

    real_dir = (ROOT / args.real).resolve()
    vm_dir = (ROOT / args.vm).resolve()

    real_records = load_side(real_dir)
    vm_records = load_side(vm_dir)

    if not real_records and not vm_records:
        print(f"[fail] {real_dir} 和 {vm_dir} 都为空，没东西可对账", file=sys.stderr)
        return 1
    if not real_records:
        print(f"[fail] {real_dir} 为空（先跑 capture_payloads_playwright.py）", file=sys.stderr)
        return 1
    if not vm_records:
        print(f"[warn] {vm_dir} 为空（先跑 PURE_TURNSTILE=1 node main.js）", file=sys.stderr)

    real_by_ep = group_by_endpoint(real_records)
    vm_by_ep = group_by_endpoint(vm_records)

    lines = []
    lines.append(f"# CF Challenge Payload 对账报告")
    lines.append("")
    lines.append(f"- real dir: {real_dir}  ({len(real_records)} 条)")
    lines.append(f"- vm   dir: {vm_dir}  ({len(vm_records)} 条)")
    lines.append("")
    render_summary(real_by_ep, vm_by_ep, lines)

    lines.append("## 逐条 diff")

    eps = sorted(set(real_by_ep) | set(vm_by_ep))
    for ep in eps:
        rs = real_by_ep.get(ep, [])
        vs = vm_by_ep.get(ep, [])
        n = max(len(rs), len(vs))
        for i in range(n):
            r = rs[i] if i < len(rs) else None
            v = vs[i] if i < len(vs) else None
            diff_pair(r, v, lines)

    text = "\n".join(lines)
    print(text)
    if args.out:
        out_path = Path(args.out)
        if not out_path.is_absolute():
            out_path = ROOT / out_path
        out_path.write_text(text, encoding="utf-8")
        print(f"\n[write] 报告已写入 {out_path}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
