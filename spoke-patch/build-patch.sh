#!/usr/bin/env bash
# Builds a Yarn patch for the published @firebase/firestore package from this branch.
#
# Usage: spoke-patch/build-patch.sh <base-tag> <output.patch>
#   base-tag      the upstream tag this branch is based on, eg. firebase@12.15.0
#   output.patch  where to write the patch; the header from spoke-patch/patch-header.txt goes first
#
# Requires `yarn` (install) and the builds of Firestore's dependencies, from the repository root:
#   yarn && yarn --cwd packages/firestore build:deps
#
# Steps:
# 1. Downloads the published package for the version in packages/firestore/package.json.
# 2. Builds the base tag and stops unless every main bundle is byte-identical to the
#    published one, so the patch only ever changes what this branch changes.
# 3. Builds this branch with the base build's terser name cache. Without it, every new
#    private property shifts the mangled names of the ones after it (`this.R` becomes
#    `this.I`), and each minified bundle changes on thousands of lines instead of hundreds.
# 4. Maps the new chunk file names back to the published ones and diffs each changed file.
set -euo pipefail

BASE=${1:?base tag, eg. firebase@12.15.0}
OUT=$(cd "$(dirname "${2:?output patch path}")" && pwd)/$(basename "$2")
ROOT=$(git rev-parse --show-toplevel)
HERE=$ROOT/spoke-patch
PKG=$ROOT/packages/firestore
VERSION=$(node -p "require('$PKG/package.json').version")
WORK=$(mktemp -d)
trap 'git -C "$ROOT" worktree remove --force "$WORK/base" >/dev/null 2>&1 || true; rm -rf "$WORK"' EXIT

if [ -n "$(git -C "$ROOT" status --porcelain -- packages/firestore)" ]; then
  echo "packages/firestore has uncommitted changes; commit or remove them first" >&2; exit 1
fi

echo "Downloading @firebase/firestore@$VERSION"
(cd "$WORK" && npm pack "@firebase/firestore@$VERSION" --silent >/dev/null && mkdir npm && tar -xzf ./*.tgz -C npm)
PUBLISHED=$WORK/npm/package/dist

echo "Preparing a checkout of $BASE"
git -C "$ROOT" worktree add --detach "$WORK/base" "$BASE" >/dev/null 2>&1
# The base build needs this branch's rollup.shared.js, which loads and saves the name cache.
# With NC_IN and NC_OUT unset it builds exactly what upstream's does.
git -C "$WORK/base" checkout "$(git -C "$ROOT" rev-parse HEAD)" -- packages/firestore/rollup.shared.js
ln -s "$ROOT/node_modules" "$WORK/base/node_modules"
[ -d "$PKG/node_modules" ] && ln -s "$PKG/node_modules" "$WORK/base/packages/firestore/node_modules"
for dist in "$ROOT"/packages/*/dist; do
  name=$(basename "$(dirname "$dist")")
  [ "$name" = firestore ] || ln -sfn "$dist" "$WORK/base/packages/$name/dist"
done

# The build reads the public declarations of a previous build to decide which names it may
# mangle (externs.json). Use the published ones, which come from the same source.
seed() {
  rm -rf "$1/dist"; mkdir -p "$1/dist/lite"
  for f in internal.d.ts internal.pipelines.d.ts lite/internal.d.ts lite/internal.pipelines.d.ts; do
    cp "$PUBLISHED/$f" "$1/dist/$f"
  done
}

# rollup exits non-zero on the declaration bundle (global.d.ts), which the patch does not use;
# the JavaScript bundles are checked below instead.
build() { (cd "$1" && npx rollup -c rollup.config.js > "$WORK/$2.log" 2>&1) || true; }

echo "Building $BASE"
seed "$WORK/base/packages/firestore"
NC_OUT=$WORK/name-cache.json build "$WORK/base/packages/firestore" base
node "$HERE/compare-build.mjs" "$PUBLISHED" "$WORK/base/packages/firestore/dist" --expect-identical

echo "Building $(git -C "$ROOT" rev-parse --short HEAD)"
seed "$PKG"
NC_IN=$WORK/name-cache.json build "$PKG" patched
node "$HERE/compare-build.mjs" "$PUBLISHED" "$PKG/dist" --write "$WORK/normalized"

echo "Writing $OUT"
cp "$HERE/patch-header.txt" "$OUT"
(cd "$WORK/normalized" && find . -type f | sed 's#^\./##' | sort) | while read -r f; do
  # git diff --no-index exits 1 when the files differ.
  (cd "$WORK" && git diff --no-index --src-prefix=a/ --dst-prefix=b/ "npm/package/dist/$f" "normalized/$f" || true) |
    sed -e "s#a/npm/package/dist/$f#a/dist/$f#g" -e "s#b/normalized/$f#b/dist/$f#g" >> "$OUT"
done
grep '^diff --git' "$OUT" | sed 's#^diff --git a/#  #; s# b/.*##'
