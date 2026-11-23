# documentId() in / not-in filters scan every key for each offered document

**Problem.** `KeyFieldInFilter` and `KeyFieldNotInFilter` check a document by scanning all listed keys with `DocumentKey.isEqual`. Because every changed document is offered to every view, a client with many `in` listeners does listeners × keys comparisons per changed document.

**Repro sketch.**

```js
for (let i = 0; i < 360; i++) {
  const ids = Array.from({ length: 30 }, (_, j) => `doc${i * 30 + j}`);
  onSnapshot(query(collection(db, 'items'), where(documentId(), 'in', ids)), () => {});
}
// Then change many documents in one batch and measure the client's CPU.
```

**Measured** on the built node bundle, calling the filters directly: offering 10,777 changed documents to 360 filters of 30 ids took 17 to 20 s, and 0.16 s with an index by document id.

**Proposed fix.** Group the listed keys by document id and confirm candidates with `isEqual`. Keys with numeric ids (which compare by value) or an empty path keep the ordered scan, so results and thrown errors stay the same. Implementation and a randomized test against the plain scan: [706ab39](https://github.com/getcircuit/firebase-js-sdk/commit/706ab39).
