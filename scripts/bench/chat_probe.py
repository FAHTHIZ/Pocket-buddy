#!/usr/bin/env python3
"""Streams one OpenAI-compatible chat request and reports TTFT and decode speed.
Works against llama-server and bmoe-server. Uses the engine's own timings when it reports them."""
import json, sys, time, urllib.request
url, key, prompt, max_tokens = sys.argv[1], sys.argv[2], sys.argv[3], int(sys.argv[4])
body = {"messages": [{"role": "system", "content": "You are Pocket Buddy, a friendly and concise assistant running fully on this phone."},
                     {"role": "user", "content": prompt}],
        "stream": True, "max_tokens": max_tokens, "temperature": 0, "seed": 7,
        "chat_template_kwargs": {"enable_thinking": False}}
headers = {"Content-Type": "application/json"}
if key: headers["Authorization"] = "Bearer " + key
req = urllib.request.Request(url + "/v1/chat/completions", data=json.dumps(body).encode(), headers=headers)
t0 = time.time(); first = None; chunks = 0; timings = None; summary = None; text = ""
with urllib.request.urlopen(req, timeout=1800) as r:
    for raw in r:
        line = raw.decode().strip()
        if not line.startswith("data:"): continue
        d = line[5:].strip()
        if d == "[DONE]": break
        p = json.loads(d)
        if p.get("timings"): timings = p["timings"]
        if (p.get("bmoe") or {}).get("summary"): summary = p["bmoe"]["summary"]
        ch = (p.get("choices") or [{}])[0].get("delta", {}) if p.get("choices") else {}
        c = ch.get("content") or ch.get("reasoning_content")
        if c:
            if first is None: first = time.time()
            chunks += 1; text += c
t1 = time.time()
out = {"client_ttft_s": round(first - t0, 3) if first else None, "total_s": round(t1 - t0, 3), "chunks": chunks,
       "client_decode_tps": round((chunks - 1) / (t1 - first), 3) if first and chunks > 1 and t1 > first else None, "text": text[:160]}
if timings:
    out.update({"engine": "llama.cpp", "prompt_n": timings.get("prompt_n"), "prefill_tps": round(timings.get("prompt_per_second", 0), 2),
                "predicted_n": timings.get("predicted_n"), "decode_tps": round(timings.get("predicted_per_second", 0), 3)})
if summary:
    out.update({"engine": "bmoe", "prompt_n": summary.get("n_prompt"), "prefill_tps": summary.get("prefill_tps"), "predicted_n": summary.get("tokens"),
                "decode_tps": summary.get("tok_s"), "engine_ttft_s": summary.get("ttft_s"), "cache_hit_pct": summary.get("cache_hit_pct"),
                "read_mib": summary.get("read_mib"), "io_s_tok": summary.get("io_s_tok"), "compute_s_tok": summary.get("compute_s_tok")})
print(json.dumps(out))
