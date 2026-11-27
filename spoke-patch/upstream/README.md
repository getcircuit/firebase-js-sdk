# Upstream status

Where each change on `spoke` stands upstream, and the issue to open when there is none. Searched firebase/firebase-js-sdk issues and pull requests on 2026-11-23 for: updateLimboDocuments, limbo incrementally, limbo performance many listeners, onSnapshot performance, onSnapshot CPU many listeners, KeyFieldInFilter, documentId in performance, compareUtf8Strings performance, ensureDocumentUpdateByTarget, computeDocChanges performance, ObjectMap canonifyQuery performance.

| Change | Marker | Commit or pull request | Upstream | Next step |
| --- | --- | --- | --- | --- |
| Incremental limbo update (1) and path skip (6) | `limbo-walk` | [ba285eb](https://github.com/getcircuit/firebase-js-sdk/commit/ba285eb) | None found. The code carries `TODO(klimt): Do this incrementally`. Related but different, both closed: [#2668](https://github.com/firebase/firebase-js-sdk/issues/2668) (`SortedSet.unionWith`, fixed in 2020) and [#6578](https://github.com/firebase/firebase-js-sdk/issues/6578) (closed as stale). | TODO: open [limbo-walk](issues/limbo-walk.md), then offer the commit as a pull request. |
| Indexed `documentId()` in / not-in filters (5) | `key-filter-scan` | [706ab39](https://github.com/getcircuit/firebase-js-sdk/commit/706ab39) | None found. | TODO: open [key-filter-scan](issues/key-filter-scan.md). |
| Pending update lookup (2), equal-string compare (3), `ObjectMap` identity (4) | `small-fixes` | [d532fb9](https://github.com/getcircuit/firebase-js-sdk/commit/d532fb9), [e133b5b](https://github.com/getcircuit/firebase-js-sdk/commit/e133b5b), [1510bd5](https://github.com/getcircuit/firebase-js-sdk/commit/1510bd5) | None found. | TODO: offer as one small pull request after the limbo-walk issue, citing it; too small for issues of their own. |
| Shared field data between document copies (8) | `field-copies` | [#3](https://github.com/getcircuit/firebase-js-sdk/pull/3) | None found (searched 2026-11-23: mutableCopy, deepClone, ObjectValue clone, memoryLocalCache memory usage, firestore memory duplicate documents cache, firestore OOM). Related: [#4548](https://github.com/firebase/firebase-js-sdk/pull/4548) (2021) made documents mutable with one owner each, the cache or a view. | TODO: open [field-copies](issues/field-copies.md), then offer the commit as a pull request. |
| Cached path string (9) | `path-string-cache` | [#5](https://github.com/getcircuit/firebase-js-sdk/pull/5) | None found (searched 2026-11-27: canonicalString, ResourcePath performance, memoize path, DocumentReference path performance, toArray join path). | TODO: open [path-string-cache](issues/path-string-cache.md), then offer the commit as a pull request. |
| `doc(collectionReference, path)` types (7) | `doc-overloads` | [3a7e86f](https://github.com/getcircuit/firebase-js-sdk/commit/3a7e86f) | Open: [#7826](https://github.com/firebase/firebase-js-sdk/issues/7826). | TODO: comment on #7826 with the overload split and offer a pull request. |

Every site a change touches in `packages/firestore/src` carries a comment `Spoke patch (<marker>): <upstream link, or where the draft is>`. `git grep -n "Spoke patch ("` lists them all, so at an upgrade you can recheck each one against the upstream issue, update it, or remove it once upstream ships the fix.

Update this table and the markers in the same commit as any change. A new row links the change's fork pull request, which exists before the merge. When an issue or pull request is opened, replace the TODO here and the draft path in every marker with its link.

## Issue drafts

`issues/` holds one draft per likely upstream issue, ready to paste: [limbo-walk](issues/limbo-walk.md), [key-filter-scan](issues/key-filter-scan.md), [field-copies](issues/field-copies.md), [path-string-cache](issues/path-string-cache.md). Add a draft whenever a change has no upstream issue, and delete it once the issue is open (the table keeps the link).

Drafts are generic on purpose: no product, customer or company detail. The repro sketches show the shape of the workload. The numbers come from a benchmark of the same shape (a second client holds the documents live while another client updates one unrelated document 200 times, against the emulator; process CPU per update), not from running the sketch itself.
