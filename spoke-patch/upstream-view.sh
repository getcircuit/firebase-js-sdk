#!/usr/bin/env bash
# Writes, or checks, test/unit/core/upstream_view.ts: the release's View with import
# paths rebased, which the comparison tests run next to the current View.
#
# Usage: spoke-patch/upstream-view.sh <release-tag> [--check]
#   release-tag  the upstream tag spoke is based on, eg. firebase@12.15.0
#   --check      exit with status 1 instead of writing when the file is out of date
#
# Run it after merging a new release tag, so the tests compare with that release.
set -euo pipefail

TAG=${1:?release tag, eg. firebase@12.15.0}
ROOT=$(git rev-parse --show-toplevel)
TARGET=packages/firestore/test/unit/core/upstream_view.ts
GENERATED=$(mktemp)
trap 'rm -f "$GENERATED"' EXIT

{
  # Keep the source file's license header, then say what the copy is.
  git -C "$ROOT" show "$TAG:packages/firestore/src/core/view.ts" | sed -n '1,/^ \*\//p'
  cat <<DOC

/**
 * The View class from src/core/view.ts at tag $TAG, unchanged
 * except for import paths. Tests run the same steps on it and on the current
 * View and expect identical results, limbo changes and errors.
 */
DOC
  # Everything from the first import on, with paths rebased from src/core to test/unit/core.
  git -C "$ROOT" show "$TAG:packages/firestore/src/core/view.ts" |
    sed -n '/^import/,$p' |
    sed -e "s#from '\.\./#from '../../../src/#g" -e "s#from '\./#from '../../../src/core/#g"
} > "$GENERATED"

# Rebasing the paths changes how the imports sort, so apply the package's ESLint fixes
# (import order) and then Prettier, as upstream's lint and format checks expect. ESLint
# resolves its config by path, so the file sits next to the target while it runs.
SCRATCH="$ROOT/packages/firestore/test/unit/core/upstream_view.generating.ts"
cp "$GENERATED" "$SCRATCH"
trap 'rm -f "$GENERATED" "$SCRATCH"' EXIT
(cd "$ROOT/packages/firestore" && npx eslint -c .eslintrc.js --fix "$SCRATCH" >&2)
(cd "$ROOT" && npx prettier --write "$SCRATCH" > /dev/null)
cp "$SCRATCH" "$GENERATED"

if [ "${2:-}" = --check ]; then
  if ! cmp -s "$GENERATED" "$ROOT/$TARGET"; then
    echo "$TARGET is not the View of $TAG; run spoke-patch/upstream-view.sh $TAG and commit it" >&2
    exit 1
  fi
  exit 0
fi
cp "$GENERATED" "$ROOT/$TARGET"
