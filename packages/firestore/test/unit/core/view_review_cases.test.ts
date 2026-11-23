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
 * Deterministic cases from a code review: each runs the same steps on the
 * patched View and on a verbatim upstream View and expects the same outcome,
 * including thrown errors.
 */
import { expect } from 'chai';

import { LimitType, queryWithLimit } from '../../../src/core/query';
import { View } from '../../../src/core/view';
import {
  documentKeySet,
  mutableDocumentMap
} from '../../../src/model/collections';
import { MutableDocument } from '../../../src/model/document';
import {
  deletedDoc,
  doc,
  documentUpdates,
  key,
  orderBy,
  query,
  updateMapping,
  version
} from '../../util/helpers';

import { View as UView } from './upstream_view';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyView = any;

/** Runs one step and records its result or the error it throws. */
function outcome(run: () => AnyView): string {
  try {
    const change = run();
    if (change === undefined) {
      return 'ok';
    }
    return JSON.stringify({
      limbo: (change.limboChanges ?? []).map(
        (c: AnyView) => `${c.constructor.name}:${c.key.toString()}`
      ),
      docs: change.snapshot?.docs
        .toArray()
        .map((d: AnyView) => d.key.toString()),
      fromCache: change.snapshot?.fromCache,
      changes: change.snapshot?.docChanges.map(
        (c: AnyView) => `${c.type}:${c.doc.key.toString()}`
      )
    });
  } catch (error) {
    return `throws ${(error as Error).message}`;
  }
}

function both(steps: Array<(view: AnyView) => AnyView>): void {
  const patched: AnyView = new View(query('c'), documentKeySet());
  const upstream: AnyView = new UView(query('c'), documentKeySet());
  for (const step of steps) {
    expect(outcome(() => step(patched))).to.equal(
      outcome(() => step(upstream))
    );
  }
}

describe('review cases: patched View matches upstream', () => {
  it('throws the same with limbo disabled and a malformed numeric id', () => {
    const patched: AnyView = new View(
      query('c'),
      documentKeySet(key('c/__id1__'))
    );
    const upstream: AnyView = new UView(
      query('c'),
      documentKeySet(key('c/__id1__'))
    );
    for (const view of [patched, upstream]) {
      view.__result = outcome(() =>
        view.applyChanges(
          view.computeDocChanges(documentUpdates(doc('c/__id__', 1, {}))),
          false,
          updateMapping(version(1), [], [], ['c/__id1__'], true)
        )
      );
    }
    expect(patched.__result).to.equal(upstream.__result);
  });

  it('removes a document offered under its key with a mismatched document', () => {
    both([
      view =>
        view.applyChanges(
          view.computeDocChanges(documentUpdates(doc('c/a', 1, {}))),
          true,
          updateMapping(version(1), [], [], [], true)
        ),
      view =>
        view.applyChanges(
          view.computeDocChanges(
            mutableDocumentMap().insert(key('c/a'), deletedDoc('other/a', 2))
          ),
          true
        )
    ]);
  });

  it('recovers limbo after a call that throws midway', () => {
    both([
      view =>
        view.applyChanges(
          view.computeDocChanges(documentUpdates()),
          true,
          updateMapping(version(1), [], [], [], true)
        ),
      view =>
        view.applyChanges(
          view.computeDocChanges(documentUpdates(doc('c/a', 2, {}))),
          true,
          updateMapping(version(2), [], ['c/b'], [], true)
        ),
      view => view.applyChanges(view.computeDocChanges(documentUpdates()), true)
    ]);
  });

  for (const [limitType, sign] of [
    [LimitType.First, 1],
    [LimitType.Last, -1]
  ] as const) {
    for (const refill of [false, true]) {
      it(`keeps limbo exact for a limit ${limitType} query with a mismatched map${
        refill ? ' and a refill' : ''
      }`, () => {
        const q = queryWithLimit(
          query('c', orderBy('n')),
          refill ? 2 : 1,
          limitType
        );
        const run = (V: AnyView): string[] => {
          const view: AnyView = new V(q, documentKeySet());
          const results: string[] = [];
          const start = [doc('c/b', 1, { n: 2 * sign })];
          if (refill) {
            start.push(doc('c/d', 1, { n: 4 * sign }));
          }
          results.push(
            outcome(() =>
              view.applyChanges(
                view.computeDocChanges(documentUpdates(...start)),
                true,
                updateMapping(version(1), [], [], [], true)
              )
            )
          );
          const local = (k: string, n: number): MutableDocument =>
            doc(k, 2, { n: n * sign }).setHasLocalMutations();
          let batch = mutableDocumentMap().insert(
            key('c/a'),
            doc('c/b', 2, { n: 3 * sign })
          );
          batch = refill
            ? batch.insert(key('c/d'), deletedDoc('c/d', 2))
            : batch.insert(key('c/c'), local('c/c', 1));
          results.push(
            outcome(() => {
              let computed = view.computeDocChanges(batch);
              if (computed.needsRefill) {
                computed = view.computeDocChanges(
                  documentUpdates(local('c/e', 0), local('c/f', 1)),
                  computed
                );
              }
              return view.applyChanges(computed, true);
            })
          );
          return results;
        };
        expect(run(View)).to.deep.equal(run(UView));
      });
    }
  }

  for (const [name, make] of [
    ['deleted', () => deletedDoc('c/__id__', 1)],
    [
      'unknown',
      () => MutableDocument.newUnknownDocument(key('c/__id__'), version(1))
    ]
  ] as const) {
    it(`matches a document query offered a mismatched ${name} malformed numeric id`, () => {
      const run = (V: AnyView): string => {
        const view: AnyView = new V(query('c/__id1__'), documentKeySet());
        return outcome(() =>
          view.applyChanges(
            view.computeDocChanges(
              mutableDocumentMap().insert(key('c/a'), make())
            ),
            true
          )
        );
      };
      expect(run(View)).to.equal(run(UView));
    });
  }
});
