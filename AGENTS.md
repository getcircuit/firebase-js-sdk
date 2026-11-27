# Agent guide: Spoke's Firestore fork

This fork exists to ship performance and type fixes to `@firebase/firestore` before upstream does. The `spoke` branch is an upstream release plus our changes. `spoke-patch/build-patch.sh` turns it into the Yarn patch that Spoke's apps install. Read `spoke-patch/README.md` before changing anything; it explains the branches, the build, the checks and the upgrade steps.

## Rules

- Work on `spoke`, or on a branch cut from it. Never commit to `main`, which mirrors upstream. Bring upstream in only by merging a release tag (`git merge firebase@12.16.0`), never upstream `main`: the patch must apply to the package npm published.
- Never force-push `spoke` or move a `spoke-firestore-*` tag. CI creates those tags: every push to `spoke` is a release with the patch attached.
- Every change reaches `spoke` through a pull request in this fork, and its CI (`.github/workflows/spoke.yml`: type check, unit and spec tests, patch build) must pass before it merges. Squash-merge it, so `spoke` keeps one commit per change. A consuming repository's pull request uses the release's `firestore.patch`, links the release, and adds that repository's release entry (in web-apps, a changeset).
- Never edit a generated patch. Change `spoke`, then rebuild with `spoke-patch/build-patch.sh`, passing the consumer's existing patches for that package version.
- Keep behavior identical to upstream except for the change you mean. Every change comes with a test that compares it with upstream behavior (a full recompute, a plain reference implementation, or results recorded from the release) and fails when the change is reverted. Check that it fails before you commit.
- One commit per change. Its message says what changed, why (the cost measured or the bug), the decisions and the alternatives rejected, the commands run with their results, and an `Upstream:` line: the issue or pull request, or `none found (searched <terms>, <date>); draft in spoke-patch/upstream/issues/`.
- Mark every site a change touches in `packages/firestore/src` with a comment `Spoke patch (<marker>): <upstream issue link, or the draft path>`, using the marker from `spoke-patch/upstream/README.md`. `git grep -n "Spoke patch ("` is how the next person finds what to recheck, update or remove when upstream moves. Example: `// Spoke patch (doc-overloads): https://github.com/firebase/firebase-js-sdk/issues/7826.`
- A change updates, in its own commit, every place that lists the changes: the opening summary and numbered list in `spoke-patch/patch-header.txt`, the intro and checks table in `spoke-patch/README.md`, the table in `spoke-patch/upstream/README.md`, and its issue draft in `spoke-patch/upstream/issues/`.
- Link a change by its fork pull request, never by a placeholder for the commit: the pull request exists before the merge, and a squash merge picks the commit only when it merges. Example: `[#5](https://github.com/getcircuit/firebase-js-sdk/pull/5)`.
- This repository is public, and anything meant for upstream is read by strangers. Write no customer names, app or internal project names, internal URLs, or production data. Describe workloads generically ("370 listeners over 24,000 documents") and reduce repros to the smallest code that shows the problem.

## Where things are

- Our changes: `packages/firestore/src`, with tests in `packages/firestore/test/unit/core/` and `test/unit/api/`.
- Patch tooling: `spoke-patch/build-patch.sh`, `compare-build.mjs`.
- Patch documentation: `spoke-patch/patch-header.txt`, which the build puts under a banner naming the source commit.
- Upstream status per change: `spoke-patch/upstream/README.md`; issue drafts in `spoke-patch/upstream/issues/`.

## Upstream notes

Upstream firebase-js-sdk added these instructions for its own repository in 12.19.0. For the checks a change here needs, follow `spoke-patch/README.md`.

### Testing instructions
- Before testing, create a `config/project.json` file. Copy `config/ci.config.json` if another project config is not specified by the user.
- This is a web SDK and is most commonly used in a browser environment, so if you are running unit tests, you must run browser unit tests, not just Node tests, even if the Node tests seem like they would be faster.

### Preparing code for PRs
- Run `yarn format` after any changes to `*.ts` or `*.js` files, to do a formatting and license pass.
- Run `yarn docgen:all` after any changes that affect the public API or that change the text of comments that are the source of public documentation
