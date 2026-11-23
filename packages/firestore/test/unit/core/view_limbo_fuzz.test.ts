/**
 * @license
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Randomized check that View reports the same limbo documents and limbo
 * changes as a full recompute after every call, across document updates,
 * local mutations, target changes, `current` flips, pending resets, calls with
 * limbo resolution disabled, going offline, and multi-tab resynchronization.
 * Two of the keys are one numeric id spelled two ways (`__id5__` and
 * `__id05__` compare equal), so updates can name a held document by another
 * spelling; limbo changes must still name the key the view holds.
 */

import { expect } from 'chai';

import { LimitType, queryWithLimit } from '../../../src/core/query';
import { OnlineState } from '../../../src/core/types';
import {
  AddedLimboDocument,
  LimboDocumentChange,
  RemovedLimboDocument,
  View
} from '../../../src/core/view';
import {
  documentKeySet,
  DocumentKeySet,
  mutableDocumentMap
} from '../../../src/model/collections';
import { MutableDocument } from '../../../src/model/document';
import { DocumentSet } from '../../../src/model/document_set';
import {
  deletedDoc,
  doc,
  documentUpdates,
  filter,
  key,
  query,
  updateMapping,
  version
} from '../../util/helpers';

// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
type ViewInternals = {
  documentSet: DocumentSet;
  limboDocuments: DocumentKeySet;
  current: boolean;
  _syncedDocuments: DocumentKeySet;
};

/** Small deterministic PRNG so failures can be replayed by seed. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

function fullLimbo(view: ViewInternals): DocumentKeySet {
  let result = documentKeySet();
  view.documentSet.forEach(d => {
    if (!view._syncedDocuments.has(d.key) && !d.hasLocalMutations) {
      result = result.add(d.key);
    }
  });
  return result;
}

function diff(
  before: DocumentKeySet,
  after: DocumentKeySet
): LimboDocumentChange[] {
  const changes: LimboDocumentChange[] = [];
  before.forEach(k => {
    if (!after.has(k)) {
      changes.push(new RemovedLimboDocument(k));
    }
  });
  after.forEach(k => {
    if (!before.has(k)) {
      changes.push(new AddedLimboDocument(k));
    }
  });
  return changes;
}

describe('View limbo tracking (randomized)', () => {
  const paths = [
    ...Array.from({ length: 10 }, (_, i) => `rooms/eros/msgs/${i}`),
    'rooms/eros/msgs/__id5__',
    'rooms/eros/msgs/__id05__'
  ];

  for (const limit of [undefined, 4]) {
    for (let seed = 1; seed <= 150; seed++) {
      it(`matches a full recompute (seed ${seed}, limit ${limit})`, () => {
        const next = random(seed * 7919 + (limit ?? 0));
        const pick = (): string[] => paths.filter(() => next() < 0.3);
        const baseQuery = query('rooms/eros/msgs', filter('match', '==', true));
        const q = limit
          ? queryWithLimit(baseQuery, limit, LimitType.First)
          : baseQuery;
        const view = new View(q, documentKeySet());
        const internals = view as unknown as ViewInternals;
        let cache = mutableDocumentMap();
        let fullChecks = 0;

        for (let step = 0; step < 60; step++) {
          const roll = next();
          const before = internals.limboDocuments;

          if (roll < 0.05) {
            const change = view.applyOnlineStateChange(OnlineState.Offline);
            expect(change.limboChanges).to.deep.equal([]);
            expect(internals.limboDocuments.isEqual(before)).to.equal(true);
            continue;
          }

          if (roll < 0.1 && limit === undefined) {
            let remoteKeys = documentKeySet();
            for (const p of pick()) {
              remoteKeys = remoteKeys.add(key(p));
            }
            const change = view.synchronizeWithPersistedState({
              documents: cache,
              remoteKeys
            });
            const expected = internals.current
              ? fullLimbo(internals)
              : documentKeySet();
            expect(internals.limboDocuments.isEqual(expected)).to.equal(true);
            expect(change.limboChanges).to.deep.equal(
              diff(documentKeySet(), expected)
            );
            continue;
          }

          const updates: MutableDocument[] = [];
          for (const p of pick()) {
            const d =
              next() < 0.2
                ? deletedDoc(p, step + 1)
                : doc(p, step + 1, { match: next() < 0.8, n: step });
            if (d.isFoundDocument() && next() < 0.25) {
              d.setHasLocalMutations();
            }
            updates.push(d);
            cache = cache.insert(d.key, d);
          }

          let changes = view.computeDocChanges(documentUpdates(...updates));
          if (changes.needsRefill) {
            changes = view.computeDocChanges(cache, changes);
          }

          const targetChange =
            next() < 0.6
              ? updateMapping(
                  version(step + 1),
                  pick(),
                  [],
                  pick(),
                  /* current= */ next() < 0.75
                )
              : undefined;
          const limboEnabled = next() < 0.9;
          const pendingReset = next() < 0.1;

          const change = view.applyChanges(
            changes,
            limboEnabled,
            targetChange,
            pendingReset
          );

          if (limboEnabled && !pendingReset && internals.current) {
            const expected = fullLimbo(internals);
            expect(internals.limboDocuments.isEqual(expected)).to.equal(true);
            expect(change.limboChanges).to.deep.equal(diff(before, expected));
            fullChecks++;
          } else {
            expect(change.limboChanges).to.deep.equal([]);
            expect(internals.limboDocuments.isEqual(before)).to.equal(true);
          }
        }
        expect(fullChecks).to.be.greaterThan(0);
      });
    }
  }
});
