# Agent guide: Spoke's Firestore fork

This fork exists to ship performance and type fixes to `@firebase/firestore` before upstream does. The `spoke` branch is an upstream release plus our changes. `spoke-patch/build-patch.sh` turns it into the Yarn patch that Spoke's apps install. Read `spoke-patch/README.md` before changing anything; it explains the branches, the build, the checks and the upgrade steps.

## Rules

- Work on `spoke`, or on a branch cut from it. Never commit to `main`, which mirrors upstream. Bring upstream in only by merging a release tag (`git merge firebase@12.16.0`), never upstream `main`: the patch must apply to the package npm published.
- Never force-push `spoke` or move a `spoke-firestore-*` tag. Tags mark the commit a shipped patch was built from.
- Every change reaches `spoke` through a pull request in this fork, and its CI (`.github/workflows/spoke.yml`: type check, unit and spec tests, patch build) must pass before it merges. Merge with "Rebase and merge" so `spoke` keeps one commit per change. A consuming repository's pull request that adds or updates the patch links the fork pull request and the green `spoke` run for the commit its patch banner names, and uses that run's `firestore-patch` artifact or a local build of the same commit.
- Never edit a generated patch. Change `spoke`, then rebuild with `spoke-patch/build-patch.sh`, passing the consumer's existing patches for that package version.
- Keep behavior identical to upstream except for the change you mean. Every change comes with a test that compares it with upstream behavior (the release's View in `upstream_view.ts`, or a plain reference implementation) and fails when the change is reverted. Check that it fails before you commit.
- One commit per change. Its message says what changed, why (the cost measured or the bug), the decisions and the alternatives rejected, the commands run with their results, and an `Upstream:` line: the issue or pull request, or `none found (searched <terms>, <date>); draft in spoke-patch/upstream/issues/`.
- Mark every site a change touches in `packages/firestore/src` with a comment `Spoke patch (<marker>): <upstream issue link, or the draft path>`, using the marker from `spoke-patch/upstream/README.md`. `git grep -n "Spoke patch ("` is how the next person finds what to recheck, update or remove when upstream moves. Example: `// Spoke patch (doc-overloads): https://github.com/firebase/firebase-js-sdk/issues/7826.`
- Keep `spoke-patch/patch-header.txt` (what each change does and how it was checked) and `spoke-patch/upstream/` (upstream status, and one issue draft per change without an upstream issue) current in the same commit as the change.
- This repository is public, and anything meant for upstream is read by strangers. Write no customer names, app or internal project names, internal URLs, or production data. Describe workloads generically ("370 listeners over 24,000 documents") and reduce repros to the smallest code that shows the problem.

## Where things are

- Our changes: `packages/firestore/src`, with tests in `packages/firestore/test/unit/core/` and `test/unit/api/`.
- Patch tooling: `spoke-patch/build-patch.sh`, `compare-build.mjs`, `upstream-view.sh`.
- Patch documentation: `spoke-patch/patch-header.txt`, which the build puts under a banner naming the source commit.
- Upstream status per change: `spoke-patch/upstream/README.md`; issue drafts in `spoke-patch/upstream/issues/`.
