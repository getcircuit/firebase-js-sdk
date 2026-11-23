# The memory cache keeps a full copy of a document's fields per cache entry and per view

**Problem.** `MemoryRemoteDocumentCache` stores `doc.mutableCopy()` and returns `mutableCopy()` from every read, so a view never sees another view's local writes. `MutableDocument.mutableCopy()` deep-clones the fields (`ObjectValue.clone()`). A document that the cache and several views hold is therefore stored once per holder, and every listener that starts from cached results deep-clones every matching document.

**Repro sketch.**

```js
const db = initializeFirestore(app, { localCache: memoryLocalCache() });
const items = collection(db, 'items'); // 300 documents, each with ~50 nested maps
onSnapshot(query(items), () => {});
// Once synced, add queries that match the same documents:
onSnapshot(query(items, where('n', '>=', 0)), () => {});
onSnapshot(query(items, orderBy('name')), () => {});
// ...and compare the heap after GC before and after them.
```

**Measured** against the emulator in Node, heap after GC, 3 runs: the first query added 20.0 MiB; four more queries over the same 300 documents added 27.5 MiB, and their first (cached) snapshot took 54-66 ms, most of it in `deepClone`. With shared fields: 13.7 MiB, 2.2 MiB and 15-19 ms. Remote updates, offline writes and acknowledgements took the same time.

**Proposed fix.** Let copies share field data until one of them writes. `ObjectValue.mutableCopy()` returns an `ObjectValue` over the same proto and marks both as shared; `set()`, `setAll()` and `delete()` deep-copy a shared proto before changing it. `MutableDocument.mutableCopy()` uses it, so each document keeps its own version, read time and state, and ownership stays as #4548 set it up: the cache and each view own their documents. `clone()` keeps copying at once, for code that hands raw fields to callers. Implementation and tests: TODO: commit link.

Sharing whole documents instead (the cache storing the object it is given) breaks `does not apply document modifications to cache` in `remote_document_cache.test.ts`, and needs every later caller to copy before writing.
