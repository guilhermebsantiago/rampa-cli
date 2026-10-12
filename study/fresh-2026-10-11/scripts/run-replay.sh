#!/usr/bin/env bash
# The study's own model answers, read by today's code: the effect of the 2.4.4/2.4.6 change with the answers held
# fixed. The new run (run-after.sh) asks 2.4.4 and 2.4.6 again, and a model on a shared GPU does not always give
# the same answer twice, so its differences mix the change with the model's run-to-run variation. This replay
# does not call the model.
#
# The criteria's version is part of the judgment cache key, and the change raised it (2.4.4 2 -> 3, 2.4.6 3 -> 4)
# without changing their prompts. So a copy of the build, in .rampa/dist-replay (kept out of git), is patched
# back to the old versions, and each page's saved snapshot is checked --offline with a copy of the study's cache
# and the study's flags. A candidate the study never asked (the cap now judges first those a fact could ground)
# is an offline miss: it is not judged, and the report counts it.
#
#   pages/<slug>/recording/<slug>.snapshot.json -> pages/<slug>/replay-report.json, replay-console.txt;
#   cache copy in pages/<slug>/cache-replay/ (kept out of git); log in replay-run-log.txt.
#
# Run from the repository root, after `pnpm build`: bash study/fresh-2026-10-11/scripts/run-replay.sh [slug ...]
set -u
ROOT="$(pwd)"
STUDY="$ROOT/study/fresh-2026-10-11"
DIST="$ROOT/.rampa/dist-replay"
export RAMPA_BROWSER_CHANNEL=msedge
unset RAMPA_MODEL OPENAI_API_KEY ANTHROPIC_API_KEY GOOGLE_GENERATIVE_AI_API_KEY OPENROUTER_API_KEY GROQ_API_KEY

rm -rf "$DIST"; mkdir -p "$ROOT/.rampa"; cp -r "$ROOT/dist" "$DIST"
python -I - "$DIST" <<'EOF' || exit 1
import glob, os, sys
patched = 0
for path in glob.glob(os.path.join(sys.argv[1], "*.mjs")):
    with open(path, encoding="utf-8", newline="") as f:
        text = f.read()
    before = text
    for cid, level, new, old in (("2.4.4", "A", "3", "2"), ("2.4.6", "AA", "4", "3")):
        a = f'id: "{cid}",\n\tlevel: "{level}",\n\tversion: "{new}",'
        if a in text:
            text = text.replace(a, f'id: "{cid}",\n\tlevel: "{level}",\n\tversion: "{old}",', 1)
            patched += 1
    if text != before:
        with open(path, "w", encoding="utf-8", newline="") as f:
            f.write(text)
if patched != 2:
    sys.exit(f"expected to patch 2 criterion versions, patched {patched}")
print("dist-replay: 2.4.4 -> version 2, 2.4.6 -> version 3")
EOF

python -I -c "
import json, sys
sys.stdout.reconfigure(newline='\n')
for p in json.load(open(sys.argv[1], encoding='utf-8'))['pages']:
    print(p['slug'])
" "$STUDY/data/pages-input.json" | while read -r slug; do
  slug="${slug%$'\r'}"
  [ -z "$slug" ] && continue
  if [ "$#" -gt 0 ]; then
    case " $* " in *" $slug "*) ;; *) continue ;; esac
  fi
  dir="$STUDY/pages/$slug"
  cache="$dir/cache-replay"
  rm -rf "$cache"; cp -r "$dir/cache" "$cache"
  snapshot=$(ls "$dir/recording"/*.snapshot.json 2>/dev/null | head -n 1)
  ( cd "$dir" && timeout 1000 node "$DIST/cli.mjs" check "$snapshot" \
      --model ollama:gemma4:12b --offline --locale en --min-confidence low --time-limit 900 \
      --cache-dir "$cache" --json "$dir/replay-report.json" > "$dir/replay-console.txt" 2>&1 )
  code=$?
  echo "$(date -Iseconds) replay $slug exit $code" | tee -a "$STUDY/replay-run-log.txt"
done
