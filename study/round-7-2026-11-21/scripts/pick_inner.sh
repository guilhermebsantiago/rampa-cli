#!/usr/bin/env bash
# For each inner slot given as "slot<TAB>site url" on stdin: list the site's home page links with scripts/links.mjs (into
# DATA/links/<slot>.txt) and print scripts/pick.py's proposal by the stratum's rule (pre-registration, section 2;
# scripts/candidates.tsv). The person choosing confirms the first proposal or writes down why not (scripts/selection.tsv).
# Run from the repository root: bash study/round-7-2026-11-21/scripts/pick_inner.sh <public_suffix_list.dat> < slots.tsv
set -u
PSL="$1"
DIR="$(dirname "$0")"
DATA="${RECORDINGS:-C:/Users/guilh/dev/rampa-study-recordings/round-7}"
mkdir -p "$DATA/links"
while IFS=$'\t' read -r slot url; do
  [ -z "$slot" ] && continue
  case "$slot" in
    *-news-i*|*-health-i*) rule=article ;;
    *-shop-i*) rule=category ;;
    *-edu-i*) rule=undergraduate ;;
    *-br-gov-i*) rule=ombudsman ;;
    *-culture-i*) rule=contact ;;
    *) echo "$slot: no rule (the international government pool names the form itself)"; continue ;;
  esac
  out="$DATA/links/${slot}.txt"
  if ! timeout 120 node "$DIR/links.mjs" "$url" > "$out" 2> "$out.err"; then
    echo "$slot	$url	listing failed: $(head -c 160 "$out.err" | tr '\n' ' ')"
    continue
  fi
  echo "$slot	$url	$(python -I -B "$DIR/pick.py" "$PSL" "$rule" "$url" "$out")"
done
