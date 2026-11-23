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

import { expect } from 'chai';

import {
  LimitType,
  newQueryForCollectionGroup,
  queryWithAddedFilter,
  queryWithAddedOrderBy,
  queryWithLimit
} from '../../../src/core/query';
import { OnlineState } from '../../../src/core/types';
import { AddedLimboDocument, View } from '../../../src/core/view';
import {
  documentKeySet,
  mutableDocumentMap
} from '../../../src/model/collections';
import { MutableDocument } from '../../../src/model/document';
import {
  deletedDoc,
  doc,
  documentUpdates,
  filter,
  key,
  orderBy,
  query,
  updateMapping,
  version
} from '../../util/helpers';

import { AddedLimboDocument as UAdded, View as UView } from './upstream_view';

function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function limbo(changes: any[], added: any): string[] {
  return changes.map(
    c => `${c instanceof added ? '+' : '-'}${c.key.toString()}`
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function snap(s: any): unknown {
  if (!s) {
    return null;
  }
  return {
    docs: (() => {
      const o: string[] = [];
      s.docs.forEach((d: MutableDocument) => o.push(d.key.toString()));
      return o;
    })(),
    changes: s.docChanges.map(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (c: any) => `${c.type}:${c.doc.key.toString()}:${c.doc.hasLocalMutations}`
    ),
    fromCache: s.fromCache,
    syncStateChanged: s.syncStateChanged,
    pending: s.mutatedKeys.toArray().map((k: unknown) => String(k))
  };
}

describe('View limbo: patched vs upstream (scratch)', () => {
  // Documents in the query's collection, plus sibling, nested and parent paths that a
  // collection query never matches and a collection-group query on msgs partly does.
  const paths = [
    ...Array.from({ length: 8 }, (_, i) => `rooms/eros/msgs/${i}`),
    'rooms/eros/other/0',
    'rooms/eros/other/1',
    'rooms/ares/msgs/1',
    'rooms/eros/msgs/3/msgs/0',
    'rooms/eros',
    // Numeric ids compare by value: __id5__ and __id05__ name the same document.
    'rooms/__id5__/msgs/1',
    'rooms/__id5__/msgs/2',
    'rooms/__id05__/msgs/1',
    'rooms/__id005__/msgs/2'
  ];
  const variants: Array<[string, number | undefined, LimitType, boolean]> = [
    ['none', undefined, LimitType.First, false],
    ['first3', 3, LimitType.First, false],
    ['last3', 3, LimitType.Last, false],
    ['group', undefined, LimitType.First, true],
    ['group-first3', 3, LimitType.First, true],
    ['numeric', undefined, LimitType.First, false],
    ['numeric-first2', 2, LimitType.First, false]
  ];

  for (const [name, limit, limitType, group] of variants) {
    for (let seed = 1; seed <= 400; seed++) {
      it(`${name} seed ${seed}`, () => {
        const next = random(
          seed * 104729 + (limit ?? 0) * 31 + limitType.length
        );
        const pick = (p = 0.3): string[] => paths.filter(() => next() < p);
        const base = group
          ? queryWithAddedOrderBy(
              queryWithAddedFilter(
                newQueryForCollectionGroup('msgs'),
                filter('match', '==', true)
              ),
              orderBy('n')
            )
          : query(
              name.startsWith('numeric')
                ? 'rooms/__id5__/msgs'
                : 'rooms/eros/msgs',
              filter('match', '==', true),
              orderBy('n')
            );
        const q = limit ? queryWithLimit(base, limit, limitType) : base;
        const initialSynced = documentKeySet();
        const a = new View(q, initialSynced);
        const b = new UView(q, initialSynced);
        let cache = mutableDocumentMap();
        const log: string[] = [];

        for (let step = 0; step < 50; step++) {
          const roll = next();
          if (roll < 0.05) {
            const ca = a.applyOnlineStateChange(OnlineState.Offline);
            const cb = b.applyOnlineStateChange(OnlineState.Offline);
            log.push('offline');
            expect(limbo(ca.limboChanges, AddedLimboDocument)).to.deep.equal(
              limbo(cb.limboChanges, UAdded)
            );
            expect(snap(ca.snapshot)).to.deep.equal(snap(cb.snapshot));
            continue;
          }
          if (roll < 0.1) {
            let remoteKeys = documentKeySet();
            for (const p of pick(0.4)) {
              remoteKeys = remoteKeys.add(key(p));
            }
            let cb;
            try {
              cb = b.synchronizeWithPersistedState({
                documents: cache,
                remoteKeys
              });
            } catch (e) {
              // Both views must stay in identical states; give up on seed.
              return;
            }
            const ca = a.synchronizeWithPersistedState({
              documents: cache,
              remoteKeys
            });
            log.push('sync ' + remoteKeys.toArray().join(','));
            expect(
              limbo(ca.limboChanges, AddedLimboDocument),
              log.join('\n')
            ).to.deep.equal(limbo(cb.limboChanges, UAdded));
            expect(snap(ca.snapshot)).to.deep.equal(snap(cb.snapshot));
            continue;
          }

          const updates: MutableDocument[] = [];
          for (const p of pick()) {
            const existing = cache.get(key(p));
            let d: MutableDocument;
            const r = next();
            if (r < 0.15) {
              d = deletedDoc(p, step + 1);
            } else if (r < 0.45 && existing && existing.isFoundDocument()) {
              // Same data, new metadata.
              d = existing.mutableCopy();
              d = MutableDocument.newFoundDocument(
                d.key,
                version(step + 1),
                d.createTime,
                d.data.clone()
              );
            } else {
              d = doc(p, step + 1, {
                match: next() < 0.8,
                n: Math.floor(next() * 5)
              });
            }
            if (d.isFoundDocument()) {
              const m = next();
              if (m < 0.25) {
                d.setHasLocalMutations();
              } else if (m < 0.45) {
                d.setHasCommittedMutations();
              }
            }
            updates.push(d);
            cache = cache.insert(d.key, d);
          }

          const input = documentUpdates(...updates);
          let ch1;
          try {
            ch1 = b.computeDocChanges(input);
            if (ch1.needsRefill) {
              ch1 = b.computeDocChanges(cache, ch1);
            }
          } catch (e) {
            continue;
          }
          let ch2 = a.computeDocChanges(input);
          if (ch2.needsRefill) {
            ch2 = a.computeDocChanges(cache, ch2);
          }

          const tc =
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
          const pendingReset =
            next() < 0.1 ? true : next() < 0.5 ? undefined : false;
          log.push(
            `step ${step} upd=${updates
              .map(
                u =>
                  `${u.key.path.lastSegment()}${
                    u.isFoundDocument() ? '' : 'x'
                  }${u.hasLocalMutations ? 'L' : ''}${
                    u.hasCommittedMutations ? 'C' : ''
                  }`
              )
              .join(',')} tc=${
              tc
                ? `+${tc.addedDocuments
                    .toArray()
                    .join(',')} -${tc.removedDocuments
                    .toArray()
                    .join(',')} cur=${tc.current}`
                : '-'
            } limbo=${limboEnabled} reset=${pendingReset}`
          );
          const ca = a.applyChanges(ch2, limboEnabled, tc, pendingReset);
          const cb = b.applyChanges(ch1, limboEnabled, tc, pendingReset);
          expect(
            limbo(ca.limboChanges, AddedLimboDocument),
            log.join('\n')
          ).to.deep.equal(limbo(cb.limboChanges, UAdded));
          expect(snap(ca.snapshot), log.join('\n')).to.deep.equal(
            snap(cb.snapshot)
          );
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const la = (a as any).limboDocuments.toArray().map(String);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const lb = (b as any).limboDocuments.toArray().map(String);
          expect(la, log.join('\n')).to.deep.equal(lb);
        }
      });
    }
  }
});
