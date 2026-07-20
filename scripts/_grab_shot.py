import sys, json, base64

jsonl_path = sys.argv[1]
out_path = sys.argv[2]

def walk(o):
    found = []
    if isinstance(o, dict):
        if o.get("type") == "image" and isinstance(o.get("source"), dict):
            src = o["source"]
            if "data" in src:
                found.append(src["data"])
        for v in o.values():
            found.extend(walk(v))
    elif isinstance(o, list):
        for v in o:
            found.extend(walk(v))
    return found

with open(jsonl_path, "rb") as f:
    f.seek(0, 2)
    size = f.tell()
    # read last ~6MB (or whole file) to get the last few lines cheaply
    chunk = min(size, 8_000_000)
    f.seek(size - chunk)
    tail = f.read().decode("utf-8", errors="ignore")

lines = [l for l in tail.split("\n") if l.strip()]

last_data = None
last_ts = None
for line in reversed(lines):
    if '"image"' not in line:
        continue
    try:
        obj = json.loads(line)
    except Exception:
        continue
    imgs = walk(obj)
    if imgs:
        last_data = imgs[0]
        last_ts = obj.get("timestamp")
        break

if last_data is None:
    print("NO_IMAGE_FOUND")
    sys.exit(1)

with open(out_path, "wb") as f:
    f.write(base64.b64decode(last_data))

print("OK", out_path, "ts=", last_ts)
