#!/usr/bin/env bash
# Writes the frozen "before" copy of src/criteria/link-purpose.ts (at 6a8de75, imports pointed at this worktree's src)
# to .rampa/base-src, then runs shared-text.ts. Run from the repository root: bash study/notes-precision-fixes/shared-text.sh
set -eu
mkdir -p .rampa/base-src/criteria study/notes-precision-fixes/data
git show 6a8de75:src/criteria/link-purpose.ts \
  | sed -e "s#from '\.\./#from '@SRC@/#g" -e "s#from '\./#from '@SRC@/criteria/#g" -e "s#@SRC@#../../../src#g" \
  > .rampa/base-src/criteria/link-purpose.ts
node study/notes-precision-fixes/shared-text.ts | tee study/notes-precision-fixes/data/shared-text.md
