# Firestore performance patch

This branch carries changes to `@firebase/firestore` that Spoke applies to the published package as a Yarn patch. Each server update then costs work in proportion to what changed, instead of to every listener and document the client holds. `patch-header.txt` describes each change, how it was checked and what it measured.

## Layout

- One commit per change on top of the upstream tag, each with its tests under `packages/firestore/test/unit/core/`.
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

Add `USE_MOCK_PERSISTENCE=YES` and `--require test/util/node_persistence.ts` to run the spec and local tests with IndexedDB persistence. Two LRU tests named "skips a cache that is too small" fail on the upstream tag too.

## Build the patch

```bash
spoke-patch/build-patch.sh firebase@12.15.0 /tmp/firestore.patch
```

The script stops unless the build of the tag is byte-identical to the published package, so the patch changes only what this branch changes. Copy the output over the patch file in the consuming repository (for Yarn, `.yarn/patches/@firebase-firestore-npm-<version>-<hash>.patch`) and run `yarn install`.

## Upgrade to a new SDK release

1. Rebase this branch onto the new `firebase@` tag and rename it after the new `@firebase/firestore` version.
2. Run the tests above.
3. Run `build-patch.sh` with the new tag, and replace the patch in the consuming repository.

Delete a change from the branch once upstream ships an equivalent.
