# ResourcePath.fromString copies its segments twice

**Problem.** `ResourcePath.fromString` splits each path string on `/`, filters out empty segments, and spreads the result into a new array. A non-empty string with no leading, trailing or doubled slash has no empty segment, so the filter removes nothing and both copies hold the same segments as the split. Valid resource names (`projects/{project}/databases/{database}/documents/{document path}`) have that form, and two hot callers parse them:

- The serializer's `fromName` parses the resource name of every document the watch stream delivers (`fromWatchChange`), then takes the document key from it.
- `documentId()` `in` and `not-in` filters hold their references as resource names, the form the backend receives. Their constructor parses each one back with `DocumentKey.fromName`, which drops the five-segment resource-name prefix (`projects/{project}/databases/{database}/documents`) to get the document key it matches documents with.

**Repro sketch.**

```js
const refs = ids.map(id => doc(db, `rooms/r1/messages/${id}`)); // 30 ids
for (let i = 0; i < 620; i++) {
  query(collectionGroup(db, 'messages'), where(documentId(), 'in', refs));
}
```

**Measured** in Node 24.18 on the built node bundle of a fork that also keeps each path's string after its first `canonicalString()` call ([path-string-cache](path-string-cache.md)) and indexes the filter's keys by document id in its constructor ([key-filter-scan](key-filter-scan.md)), five alternating runs, each the median of 7 rounds of 620 queries: building one such query with 30 references took 16.7-20.0 µs (median 17.2), and 10.9-13.2 µs (median 11.2) when `fromString` keeps the split array. A loop that pushes each non-empty segment, without keeping the split array, took 13.0-16.0 µs (median 13.4). In a CPU profile of the build before the fix, `fromString` (including the `split` it calls) is about 75% of the self time.

**Proposed fix.** Inside the existing loop, after the `//` check, return the split array as the path's segments when it is the only component and has no empty segment. Every other input (no strings, several strings, an empty string, leading, trailing or doubled slashes) takes the existing code, so results and thrown errors stay the same. Paths never write to their segment array, so the path can own the array `split` returned. One difference: the spread throws `RangeError` for a lone component with no empty segment past the engine's argument limit (between 60,000 and 130,000 segments in Node 24), and such a component now parses. The SDK already builds such a path from several shorter components, but throws when a `documentId()` filter or the IndexedDB decoder parses its resource name back. With the fix those parses succeed too, so a listen target with such a filter is now persisted in IndexedDB, and an older SDK sharing that cache throws when it reads the target back. Firestore allows at most 100 levels of subcollections, so the backend rejects such a path. Implementation and test: [#8](https://github.com/getcircuit/firebase-js-sdk/pull/8).
