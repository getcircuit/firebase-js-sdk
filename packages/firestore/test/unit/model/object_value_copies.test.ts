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
 * Document copies share field data until one of them changes a field. These
 * tests check that sharing is invisible: random writes on a family of copies
 * give the same fields as the same writes on deep copies.
 */

import { expect } from 'chai';

import { FieldPath } from '../../../src/model/path';
import { canonicalId } from '../../../src/model/values';
import { Value as ProtoValue } from '../../../src/protos/firestore_proto_api';
import { doc, field, wrap, wrapObject } from '../../util/helpers';

// Field paths the random steps write to: top-level fields, nested map fields,
// a whole map and an array, so writes hit every depth of the shared proto.
const paths = ['a', 'b', 'm', 'm.x', 'm.y', 'm.n', 'm.n.z', 'arr'];
// Values the random steps write: scalars, null, an array, and maps that
// replace or create nested structure.
const values: unknown[] = [
  1,
  'two',
  true,
  null,
  [1, { k: 'v' }],
  { x: 1 },
  { n: { z: 'deep' } }
];

/**
 * Returns a seeded pseudo-random generator of numbers in [0, 1).
 *
 * It is a linear congruential generator, so a failing seed replays the same
 * steps on every run.
 */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

describe('ObjectValue copies', () => {
  it('a document copy shares field data until one side changes a field', () => {
    const original = doc('coll/doc', 1, { m: { x: 1 }, a: 'one' });
    const copy = original.mutableCopy();
    // Before any write, both documents hold the same proto object.
    expect(copy.data.value).to.equal(original.data.value);

    // The first write gives the copy a proto of its own.
    copy.data.set(field('m.x'), wrap(2));
    expect(copy.data.value).not.to.equal(original.data.value);
    // The original keeps its fields, and the copy has only its own change.
    expect(original.data.isEqual(wrapObject({ m: { x: 1 }, a: 'one' }))).to.be
      .true;
    expect(copy.data.isEqual(wrapObject({ m: { x: 2 }, a: 'one' }))).to.be.true;
  });

  it('a write on the original does not show in an earlier copy', () => {
    const original = wrapObject({ m: { n: { z: 1 } } });
    const copy = original.mutableCopy();
    // The original writes first, so the copy is the side left holding the
    // shared proto.
    original.delete(field('m.n.z'));
    original.set(field('m.y'), wrap('y'));
    // The original has both changes, and the copy has neither.
    expect(original.isEqual(wrapObject({ m: { n: {}, y: 'y' } }))).to.be.true;
    expect(copy.isEqual(wrapObject({ m: { n: { z: 1 } } }))).to.be.true;
  });

  it('clone() returns field data of its own', () => {
    const original = wrapObject({ m: { x: 1 } });
    // Mark the original as sharing, then check that clone() still copies.
    original.mutableCopy();
    expect(original.clone().value).not.to.equal(original.value);
  });

  it('random writes on copies match the same writes on deep copies', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const next = random(seed);
      // Picks one item at random.
      const pick = <T>(items: T[]): T =>
        items[Math.floor(next() * items.length)];
      // `shared[i]` and `deep[i]` start equal; `shared` copies with
      // mutableCopy(), `deep` with clone(), which always copies the fields.
      const start = { a: 1, m: { x: 1, n: { z: 'z' } }, arr: [1, 2] };
      const shared = [wrapObject(start)];
      const deep = [wrapObject(start)];
      // Step log for the failure message, so a failing seed shows its history.
      const steps: string[] = [];

      for (let step = 0; step < 60; step++) {
        // The copy this step acts on.
        const i = Math.floor(next() * shared.length);
        // 'copy' is listed twice so families of copies grow while writes land.
        const kind = pick(['copy', 'copy', 'set', 'setAll', 'delete']);
        if (kind === 'copy') {
          shared.push(shared[i].mutableCopy());
          deep.push(deep[i].clone());
        } else if (kind === 'set') {
          const path = field(pick(paths));
          const value = wrap(pick(values));
          shared[i].set(path, value);
          deep[i].set(path, value);
        } else if (kind === 'delete') {
          const path = field(pick(paths));
          shared[i].delete(path);
          deep[i].delete(path);
        } else {
          // Up to three changes, some of them deletes (null), as patch
          // mutations pass them.
          const data = new Map<FieldPath, ProtoValue | null>();
          for (let n = 0; n < 3; n++) {
            data.set(
              field(pick(paths)),
              next() < 0.3 ? null : wrap(pick(values))
            );
          }
          shared[i].setAll(data);
          deep[i].setAll(data);
        }
        steps.push(`${kind}@${i}`);

        // Every copy must still match its deep-copied twin, not only the one
        // this step wrote to: a leak shows up in the others.
        shared.forEach((value, k) => {
          const context = `seed ${seed}, after ${steps.join(' ')}, copy ${k}`;
          expect(canonicalId(value.value), context).to.equal(
            canonicalId(deep[k].value)
          );
        });
      }
    }
  });
});
