#!/usr/bin/env bash
# The fifth study's no-nesting ablation, as the precision-fixes notes did it (study/notes-precision-fixes/shared-text.sh):
# writes the copy of src/criteria/link-purpose.ts before the H81 nesting (6a8de75; its only difference from b759128's
# is `nestingOf` and the `nesting` part of `contextKey`; imports pointed at this worktree's src) to .rampa/base-src, then
# runs shared-text.ts on this study's snapshots. No model. Run from the repository root:
#   bash study/round-5-2026-10-28/scripts/shared-text.sh
set -eu
mkdir -p .rampa/base-src/criteria study/round-5-2026-10-28/data
git show 6a8de75:src/criteria/link-purpose.ts \
  | sed -e "s#from '\.\./#from '@SRC@/#g" -e "s#from '\./#from '@SRC@/criteria/#g" -e "s#@SRC@#../../../src#g" \
  > .rampa/base-src/criteria/link-purpose.ts
node study/round-5-2026-10-28/scripts/shared-text.ts | tee study/round-5-2026-10-28/data/shared-text.md
