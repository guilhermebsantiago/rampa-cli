#!/usr/bin/env bash
# The fourth study's run-judged.sh, for the fifth study's pages (only default is run), with --concurrency 2, because
# the GPU may be shared with another job (the number of parallel model calls changes no prompt).
#
# Judges each saved snapshot with the study's model, offline from the page: the default configuration
# (the default criteria, --max-candidates 50, one run, no --runs), with --min-confidence low so that the
# report lists every finding and both the default threshold and all findings can be counted. The study's
# time budget of 900 s per page goes to Rampa as --time-limit 900 (a page that runs out writes a partial
# report), with a hard stop at 1000 s.
#
#   default  every page: pages/<slug>/recording/<slug>.snapshot.json -> pages/<slug>/report.json
#   probe    the probe subset: pages/<slug>/probe-recording/<slug>.snapshot.json -> pages/<slug>/probe-report.json.
#            Its judgment cache starts as a copy of the default run's, so the default criteria's prompts that
#            are the same on both loads of the page are not asked again; only the probe findings and the
#            probe judgments of this run are labelled.
#
# Pages run one at a time. Run from the repository root:
#   bash study/round-5-2026-10-28/scripts/run-judged.sh default|probe [slug ...]
set -u
MODE="$1"; shift
ROOT="$(pwd)"
STUDY="$ROOT/study/round-5-2026-10-28"
export RAMPA_BROWSER_CHANNEL=msedge
unset RAMPA_MODEL OPENAI_API_KEY ANTHROPIC_API_KEY GOOGLE_GENERATIVE_AI_API_KEY OPENROUTER_API_KEY GROQ_API_KEY

pages() {
  python -I -c "
import json, sys
sys.stdout.reconfigure(newline='\n')
d = json.load(open(sys.argv[1], encoding='utf-8'))
for p in d['pages']:
    if sys.argv[2] == 'default' or p['probeRun']:
        print(p['slug'])
" "$STUDY/data/pages-input.json" "$MODE"
}

pages | while read -r slug; do
  slug="${slug%$'\r'}"
  [ -z "$slug" ] && continue
  if [ "$#" -gt 0 ]; then
    case " $* " in *" $slug "*) ;; *) continue ;; esac
  fi
  dir="$STUDY/pages/$slug"
  if [ "$MODE" = probe ]; then
    rec="$dir/probe-recording"; cache="$dir/cache-probe"; out="$dir/probe-report.json"; console="$dir/probe-console.txt"
    rm -rf "$cache"; [ -d "$dir/cache" ] && cp -r "$dir/cache" "$cache"
  else
    rec="$dir/recording"; cache="$dir/cache"; out="$dir/report.json"; console="$dir/console.txt"
  fi
  snapshot=$(ls "$rec"/*.snapshot.json 2>/dev/null | head -n 1)
  if [ -z "$snapshot" ]; then echo "$(date -Iseconds) $MODE $slug: no recording" | tee -a "$STUDY/run-log.txt"; continue; fi
  start=$(date +%s)
  ( cd "$dir" && timeout 1000 node "$ROOT/dist/cli.mjs" check "$snapshot" \
      --model ollama:gemma4:12b --locale en --min-confidence low --time-limit 900 --concurrency 2 \
      --cache-dir "$cache" --json "$out" > "$console" 2>&1 )
  code=$?
  end=$(date +%s)
  printf '{"slug":"%s","mode":"%s","start":%s,"end":%s,"seconds":%s,"exitCode":%s}\n' \
    "$slug" "$MODE" "$start" "$end" "$((end - start))" "$code" > "$dir/run-$MODE-judged.json"
  echo "$(date -Iseconds) $MODE $slug exit $code in $((end - start)) s" | tee -a "$STUDY/run-log.txt"
done
