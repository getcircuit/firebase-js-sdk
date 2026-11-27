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

import { ResourcePath } from '../../../src/model/path';
import { Code, FirestoreError } from '../../../src/util/error';

/**
 * Upstream's `ResourcePath.fromString`, copied from firebase@12.19.0.
 *
 * Returns the segments it parses, so the tests can compare them with the
 * patched function's.
 */
function upstreamFromString(...pathComponents: string[]): string[] {
  const segments: string[] = [];
  for (const path of pathComponents) {
    if (path.indexOf('//') >= 0) {
      throw new FirestoreError(
        Code.INVALID_ARGUMENT,
        `Invalid segment (${path}). Paths must not contain // in them.`
      );
    }
    segments.push(...path.split('/').filter(segment => segment.length > 0));
  }
  return segments;
}

/**
 * Describes what a parse returned or threw, so two parses can be compared
 * with one `equal`.
 */
function outcome(parse: () => string[]): string {
  try {
    return JSON.stringify(parse());
  } catch (error) {
    if (error instanceof FirestoreError) {
      return `throws ${error.code}: ${error.message}`;
    }
    return `throws ${String(error)}`;
  }
}

/** Pieces the random path strings are made of. */
const PIECES = [
  '/',
  '/',
  '//',
  'rooms',
  'm1',
  'a',
  '__id5__',
  '__id05__',
  'é',
  '😀',
  '\uD83D',
  '.',
  ' ',
  '__proto__'
];

/** A small seeded random number generator, so a failing seed can be rerun. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

/** Builds a path string of 0 to 11 random pieces, often slash-separated. */
function randomPathString(next: () => number): string {
  const pieceCount = Math.floor(next() * 12);
  let path = '';
  for (let i = 0; i < pieceCount; i++) {
    if (i > 0 && next() < 0.6) {
      path += '/';
    }
    path += PIECES[Math.floor(next() * PIECES.length)];
  }
  return path;
}

describe('ResourcePath.fromString', () => {
  const fixedCases: string[][] = [
    [],
    [''],
    ['/'],
    ['//'],
    ['a'],
    ['/a'],
    ['a/'],
    ['/a/'],
    ['a//b'],
    ['rooms/Eros/messages/m1'],
    ['rooms/😀/messages/é'],
    ['a', 'b/c'],
    ['', 'a'],
    ['a/', '/b'],
    ['a', 'b//c']
  ];
  for (const components of fixedCases) {
    it(`parses ${JSON.stringify(components)} as upstream does`, () => {
      expect(
        outcome(() => ResourcePath.fromString(...components).toArray())
      ).to.equal(outcome(() => upstreamFromString(...components)));
    });
  }

  for (let seed = 1; seed <= 200; seed++) {
    it(`parses random path strings as upstream does (seed ${seed})`, () => {
      const next = random(seed);
      for (let round = 0; round < 50; round++) {
        const componentCount = next() < 0.8 ? 1 : Math.floor(next() * 4);
        const components: string[] = [];
        for (let i = 0; i < componentCount; i++) {
          components.push(randomPathString(next));
        }
        const parsed = outcome(() => {
          const path = ResourcePath.fromString(...components);
          expect(path.length).to.equal(path.toArray().length);
          return path.toArray();
        });
        expect(parsed, JSON.stringify(components)).to.equal(
          outcome(() => upstreamFromString(...components))
        );
      }
    });
  }

  it('keeps the split array of a lone component with no empty segment', () => {
    const split = String.prototype.split;
    const splitResults: string[][] = [];
    String.prototype.split = function (
      this: string,
      ...args: unknown[]
    ): string[] {
      const result: string[] = Reflect.apply(split, this, args);
      splitResults.push(result);
      return result;
    } as typeof split;
    let path: ResourcePath;
    try {
      path = ResourcePath.fromString('rooms/Eros/messages/m1');
    } finally {
      String.prototype.split = split;
    }

    expect(splitResults).to.have.length(1);
    // A write to the split array shows through only if the path holds it.
    splitResults[0][0] = 'changed';
    expect(path.get(0)).to.equal('changed');
  });
});
