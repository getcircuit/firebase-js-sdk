# Firestore performance patch

The `spoke` branch of this fork carries changes to `@firebase/firestore` that Spoke applies to the published package as a Yarn patch. With them, each server update costs work in proportion to what changed, instead of to every listener and document the client holds. `patch-header.txt` describes each change, how it was checked and what it measured.

## Branches and tags

- `main` mirrors upstream `main`. Update it with GitHub's "Sync fork" and never commit to it.
- `spoke` is the default branch: upstream's latest release we use, plus our changes. `git diff firebase@<version> spoke` shows exactly what we change.
- `spoke-firestore-<version>` tags mark the commit each shipped patch was built from, eg. `spoke-firestore-4.16.0`. The patch header names its tag.

Upstream `main` is ahead of any release, so `spoke` only ever takes in release tags (`firebase@12.16.0`), never `main`. The patch has to apply to the package npm published, and `build-patch.sh` stops when the base build does not match it.

## What lives here

- Our changes in `packages/firestore/src`, with their tests under `packages/firestore/test/unit/core/`. Most compare the changed code with upstream's: `view_upstream_diff.test.ts` runs both on the same random steps against a verbatim copy of the release's View (`upstream_view.ts`).
- `packages/firestore/rollup.shared.js` can load and save terser's name cache (`NC_IN`, `NC_OUT`). With both unset it builds exactly what upstream builds.
- `spoke-patch/build-patch.sh` builds the Yarn patch, and `compare-build.mjs` compares a build with the published package.

## Run the tests

From the repository root, after `yarn` and `yarn --cwd packages/firestore build:deps`:

```bash
cd packages/firestore
NO_TS_NODE=true TEST_PLATFORM=node NODE_OPTIONS=--no-experimental-strip-types \
  ../../node_modules/.bin/mocha --require babel-register.js --require test/register.ts \
  --config ../../config/mocharc.node.js \
  'test/unit/core/*.test.ts' 'test/unit/remote/*.test.ts' 'test/unit/specs/*.test.ts' 'test/unit/local/*.test.ts'
```

Add `USE_MOCK_PERSISTENCE=YES` and `--require test/util/node_persistence.ts` to run the spec and local tests with IndexedDB persistence. Two LRU tests named "skips a cache that is too small" fail on the upstream release too.

## Build the patch

```bash
spoke-patch/build-patch.sh firebase@12.15.0 /tmp/firestore.patch
```

The script downloads the published package, builds the release tag and stops unless every main bundle matches the published one byte for byte. Then it builds `spoke` and writes the difference with `patch-header.txt` on top. Copy the output over the patch file in the consuming repository (for Yarn, `.yarn/patches/@firebase-firestore-npm-<version>-<hash>.patch`) and run `yarn install`. Never edit the patch by hand: change `spoke` and build it again.

## Move to a new SDK release

1. Fetch upstream tags: `git fetch https://github.com/firebase/firebase-js-sdk.git 'refs/tags/firebase@*:refs/tags/firebase@*'`.
2. On `spoke`, merge the new release tag: `git merge firebase@<new>`. Resolve conflicts in the merge commit, and drop any change upstream now ships, with a revert or in the merge itself.
3. Update the version and tag named in `patch-header.txt`.
4. Run the tests above.
5. Build the patch with the new tag and replace it in the consuming repository.
6. Tag the commit you built from, `spoke-firestore-<new firestore version>`, and push `spoke` and the tag.

To propose a change upstream, cut a branch from the release tag and cherry-pick or rewrite that change on it.
