# DocumentReference.path rebuilds its string on every read

**Problem.** `ResourcePath.canonicalString()` copies the path's segments with `toArray()` and joins them on every call. `DocumentReference.path`, `CollectionReference.path`, the serializer's resource names and target canonical ids all go through it. Paths never change after construction (`child`, `popFirst`, `popLast` and `construct` return new objects, and nothing writes to `segments`), so every call rebuilds the same string. Code that reads `ref.path` repeatedly, for example as a `Map` key or to compare references, pays for a new array and a new string each time.

**Repro sketch.**

```js
const ref = doc(db, 'rooms/r1/messages/m1');
for (let i = 0; i < 1e6; i++) {
  map.get(ref.path);
}
```

**Measured** in Node 24.16 on the built node bundle (median of 3 runs, each the median of 9 rounds of 100,000 calls): a repeated `ref.path` read on a document 2, 4 and 6 segments deep takes 38, 59 and 79 ns and allocates 145, 200 and 264 B. With the string stored on the path, it takes 4 ns and allocates nothing, at every depth. `CollectionReference.path` drops from 25-71 ns to 4 ns the same way. The first read costs the same as before, and each path object is 8 B larger.

**Proposed fix.** Store the string on the path object the first time `canonicalString()` builds it, and return the stored string afterwards. Declare the field in the `BasePath` constructor, so every path has the same object shape from birth: a field added on first use gives paths two shapes, and V8 then deoptimizes the code that reads them. This costs one property slot per path object, and the string stays alive as long as its path. A path whose string was read is no longer structurally equal to one whose string was not, so a test that deep-compares paths or references without `isEqual` sees the field (one randomized View test did, and now uses `addEqualityMatcher` like the others). A native `#private` field would hide it, but the es2020 build compiles those to WeakMap lookups, and `Object.defineProperty` with `enumerable: false` made construction about 10 times slower in a micro benchmark. Implementation and test: [#5](https://github.com/getcircuit/firebase-js-sdk/pull/5).

`FieldPath.canonicalString()` could use the same field, but its callers build canonical ids and request protos once per query or write, so it is left as is.
