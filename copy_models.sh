#!/bin/bash
# Copy gpt-oss:20b and qwen3:14b from the SanDisk drive into Ollama's model store.
# Run with: sudo bash copy_models.sh
set -euo pipefail

SRC="/media/dell/SanDisk/OLLAMA MODELS"
DST="/usr/share/ollama/.ollama/models"
MODELS="gpt-oss/20b gpt-oss/120b qwen3/14b"

for path in $MODELS; do
  name=$(dirname "$path")
  mkdir -p "$DST/manifests/registry.ollama.ai/library/$name"
  cp -v "$SRC/manifests/registry.ollama.ai/library/$path" \
        "$DST/manifests/registry.ollama.ai/library/$name/"
done

python3 - "$SRC" <<'EOF' > /tmp/blob_list.txt
import json, sys
src = sys.argv[1]
for path in ["gpt-oss/20b", "gpt-oss/120b", "qwen3/14b"]:
    m = json.load(open(f"{src}/manifests/registry.ollama.ai/library/{path}"))
    for d in [l["digest"] for l in m["layers"]] + [m["config"]["digest"]]:
        print(d.replace(":", "-"))
EOF

sort -u /tmp/blob_list.txt | while read -r blob; do
  rsync -ah --progress "$SRC/blobs/$blob" "$DST/blobs/"
done

chown -R ollama:ollama "$DST"
systemctl restart ollama
sleep 2
ollama list
