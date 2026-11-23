# View recomputes limbo documents by walking every document on every update

**Problem.** `View.applyChanges` calls `updateLimboDocuments`, which walks every document in the view to recompute the limbo set (`TODO(klimt): Do this incrementally` in `src/core/view.ts`). The sync engine offers every changed document to every view, so a client with many listeners pays for every document of every view on each server update, even when the update changes one document that no view holds.

**Repro sketch.**

```js
// One client: many listeners over one collection.
for (let group = 0; group < 366; group++) {
  onSnapshot(query(collection(db, 'items'), where('group', '==', group)), () => {});
}
// With ~24,000 matching documents loaded, update one unrelated document repeatedly
// from another client and measure the first client's CPU per update.
```

**Measured** (CPU per update, unpatched and then with the incremental update and the path skip):

| Workload | Before | After |
| --- | --- | --- |
| 366 queries over 24,300 documents | 25.8 ms | about 1.45 ms |
| One query holding 10,000 documents | 27.6 ms | 0.4 ms |
| 10,000 single-document listeners | 113 ms | 33 ms |

**Proposed fix.** Recheck only the keys an update changed plus the keys its target change added or removed. Fall back to the full walk after any call that skips the limbo step or replaces the synced keys, and always for views holding numeric-id keys (`__id5__` equals `__id05__`, so only the full walk reports the spelling the view holds). Separately, skip a changed document in `computeDocChanges` when its path cannot match the query, before the document set lookup. Implementation and tests that compare against the current View: [ba285eb](https://github.com/getcircuit/firebase-js-sdk/commit/ba285eb).

**About the numbers.** They come from a benchmark of the same shape as the sketch, not from running the sketch itself: against the emulator, a second client holds the documents live while another client updates one unrelated document 200 times, and the metric is process CPU per update.
