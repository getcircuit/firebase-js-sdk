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
 * Edge cases where the incremental limbo update or the path skip could differ
 * from upstream's full walk. Each expected result was recorded from the View of
 * firebase@12.15.0 on the same steps; if an upgrade changes one, check the new
 * release's behavior before updating it.
 */
import { expect } from 'chai';

import { LimitType, Query, queryWithLimit } from '../../../src/core/query';
import { AddedLimboDocument, View, ViewChange } from '../../../src/core/view';
import { ChangeType } from '../../../src/core/view_snapshot';
import {
  documentKeySet,
  DocumentKeySet,
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

type Outcome =
  | {
      limbo: string[];
      docs: string[];
      fromCache: boolean | undefined;
      changes: string[];
    }
  | { throws: string };

const changeNames: Record<ChangeType, string> = {
  [ChangeType.Added]: 'added',
  [ChangeType.Removed]: 'removed',
  [ChangeType.Modified]: 'modified',
  [ChangeType.Metadata]: 'metadata'
};

/** Runs one step and describes its result, or the error it throws. */
function outcome(run: () => ViewChange): Outcome {
  try {
    const change = run();
    const docs: string[] = [];
    change.snapshot?.docs.forEach(d => docs.push(d.key.toString()));
    return {
      limbo: change.limboChanges.map(
        c =>
          `${
            c instanceof AddedLimboDocument ? 'added' : 'removed'
          } ${c.key.toString()}`
      ),
      docs,
      fromCache: change.snapshot?.fromCache,
      changes: (change.snapshot?.docChanges ?? []).map(
        c => `${changeNames[c.type]} ${c.doc.key.toString()}`
      )
    };
  } catch (error) {
    // Drop the SDK version and assertion id, which change between releases.
    const message = (error as Error).message
      .replace(/^FIRESTORE \([^)]*\) INTERNAL ASSERTION FAILED: /, '')
      .replace(/ \(ID: \w+\)$/, '');
    return { throws: message };
  }
}

function newView(q: Query, synced: DocumentKeySet = documentKeySet()): View {
  return new View(q, synced);
}

describe('View limbo edge cases', () => {
  it('does not throw for a malformed numeric id while limbo resolution is off', () => {
    const view = newView(query('c'), documentKeySet(key('c/__id1__')));
    expect(
      outcome(() =>
        view.applyChanges(
          view.computeDocChanges(documentUpdates(doc('c/__id__', 1, {}))),
          /* limboResolutionEnabled= */ false,
          updateMapping(version(1), [], [], ['c/__id1__'], true)
        )
      )
    ).to.deep.equal({
      limbo: [],
      docs: ['c/__id__'],
      fromCache: false,
      changes: ['added c/__id__']
    });
  });

  it('removes a document offered under its key with a document of another key', () => {
    const view = newView(query('c'));
    expect(
      outcome(() =>
        view.applyChanges(
          view.computeDocChanges(documentUpdates(doc('c/a', 1, {}))),
          true,
          updateMapping(version(1), [], [], [], true)
        )
      )
    ).to.deep.equal({
      limbo: ['added c/a'],
      docs: ['c/a'],
      fromCache: true,
      changes: ['added c/a']
    });
    expect(
      outcome(() =>
        view.applyChanges(
          view.computeDocChanges(
            mutableDocumentMap().insert(key('c/a'), deletedDoc('other/a', 2))
          ),
          true
        )
      )
    ).to.deep.equal({
      limbo: ['removed c/a'],
      docs: [],
      fromCache: false,
      changes: ['removed c/a']
    });
  });

  it('checks every document for limbo after an update that throws midway', () => {
    const view = newView(query('c'));
    expect(
      outcome(() =>
        view.applyChanges(
          view.computeDocChanges(documentUpdates()),
          true,
          updateMapping(version(1), [], [], [], true)
        )
      )
    ).to.deep.equal({ limbo: [], docs: [], fromCache: false, changes: [] });
    expect(
      outcome(() =>
        view.applyChanges(
          view.computeDocChanges(documentUpdates(doc('c/a', 2, {}))),
          true,
          updateMapping(version(2), [], ['c/b'], [], true)
        )
      )
    ).to.deep.equal({ throws: 'Modified document c/b not found in view.' });
    expect(
      outcome(() =>
        view.applyChanges(view.computeDocChanges(documentUpdates()), true)
      )
    ).to.deep.equal({
      limbo: ['added c/a'],
      docs: ['c/a'],
      fromCache: true,
      changes: []
    });
  });

  /**
   * A limit query whose update maps key c/a to the document c/b, with either a
   * local write (c/c) or a deletion that forces a refill (c/d, refilled from
   * c/e and c/f).
   */
  function runLimitQuery(limitType: LimitType, refill: boolean): Outcome[] {
    const sign = limitType === LimitType.First ? 1 : -1;
    const view = newView(
      queryWithLimit(query('c', orderBy('n')), refill ? 2 : 1, limitType)
    );
    const start = [doc('c/b', 1, { n: 2 * sign })];
    if (refill) {
      start.push(doc('c/d', 1, { n: 4 * sign }));
    }
    const local = (k: string, n: number): MutableDocument =>
      doc(k, 2, { n: n * sign }).setHasLocalMutations();
    let batch = mutableDocumentMap().insert(
      key('c/a'),
      doc('c/b', 2, { n: 3 * sign })
    );
    batch = refill
      ? batch.insert(key('c/d'), deletedDoc('c/d', 2))
      : batch.insert(key('c/c'), local('c/c', 1));
    return [
      outcome(() =>
        view.applyChanges(
          view.computeDocChanges(documentUpdates(...start)),
          true,
          updateMapping(version(1), [], [], [], true)
        )
      ),
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
    ];
  }

  for (const limitType of [LimitType.First, LimitType.Last]) {
    it(`keeps limbo exact for a limit query (${limitType}) offered a mismatched map entry`, () => {
      expect(runLimitQuery(limitType, /* refill= */ false)).to.deep.equal([
        {
          limbo: ['added c/b'],
          docs: ['c/b'],
          fromCache: true,
          changes: ['added c/b']
        },
        {
          limbo: ['removed c/b'],
          docs: ['c/c'],
          fromCache: false,
          changes: ['added c/c']
        }
      ]);
    });
  }

  it('keeps limbo exact for a limit-to-first query that refills after a mismatched map entry', () => {
    expect(runLimitQuery(LimitType.First, /* refill= */ true)).to.deep.equal([
      {
        limbo: ['added c/b', 'added c/d'],
        docs: ['c/b', 'c/d'],
        fromCache: true,
        changes: ['added c/b', 'added c/d']
      },
      {
        limbo: ['removed c/b', 'removed c/d'],
        docs: ['c/e', 'c/f'],
        fromCache: false,
        changes: ['removed c/d', 'added c/e', 'added c/f']
      }
    ]);
  });

  it('keeps limbo exact for a limit-to-last query that refills after a mismatched map entry', () => {
    expect(runLimitQuery(LimitType.Last, /* refill= */ true)).to.deep.equal([
      {
        limbo: ['added c/b', 'added c/d'],
        docs: ['c/d', 'c/b'],
        fromCache: true,
        changes: ['added c/d', 'added c/b']
      },
      {
        limbo: ['removed c/b', 'removed c/d'],
        docs: ['c/f', 'c/e'],
        fromCache: false,
        changes: ['removed c/d', 'added c/f', 'added c/e']
      }
    ]);
  });

  for (const [name, make] of [
    ['deleted', () => deletedDoc('c/__id__', 1)],
    [
      'unknown',
      () => MutableDocument.newUnknownDocument(key('c/__id__'), version(1))
    ]
  ] as const) {
    it(`ignores a ${name} document with a malformed numeric id offered under another key to a document query`, () => {
      const view = newView(query('c/__id1__'));
      expect(
        outcome(() =>
          view.applyChanges(
            view.computeDocChanges(
              mutableDocumentMap().insert(key('c/a'), make())
            ),
            true
          )
        )
      ).to.deep.equal({ limbo: [], docs: [], fromCache: true, changes: [] });
    });
  }
});
