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
 * Randomized check that `documentId() in` and `not-in` filters answer exactly
 * as a plain scan with `DocumentKey.isEqual`, including numeric ids that
 * compare by value and malformed numeric ids that make comparisons throw.
 */

import { expect } from 'chai';

import {
  KeyFieldInFilter,
  KeyFieldNotInFilter
} from '../../../src/core/filter';
import { DocumentKey } from '../../../src/model/document_key';
import { FieldPath } from '../../../src/model/path';
import { doc } from '../../util/helpers';

const segments = [
  'a',
  'b',
  'rooms',
  'msgs',
  'd000123',
  'd000124',
  'é',
  '😀',
  '�',
  '__id5__',
  '__id05__',
  '__id-5__',
  '__id__',
  '__id1-2__',
  '__idx',
  '__proto__',
  '\uD83D'
];

function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

function outcome(run: () => boolean): string {
  try {
    return String(run());
  } catch (error) {
    return `throws ${(error as Error).message}`;
  }
}

describe('Key in filters (randomized)', () => {
  for (let seed = 1; seed <= 400; seed++) {
    it(`matches a plain isEqual scan (seed ${seed})`, () => {
      const next = random(seed);
      const pick = (): string => segments[Math.floor(next() * segments.length)];
      const allowNumeric = next() < 0.5;
      const segment = (): string => {
        let s = pick();
        while (!allowNumeric && s.startsWith('__id') && s.endsWith('__')) {
          s = pick();
        }
        return s;
      };
      const path = (): string => {
        const depth = 2 * (1 + Math.floor(next() * 3));
        return Array.from({ length: depth }, segment).join('/');
      };
      const listed = Array.from({ length: Math.floor(next() * 9) }, path);
      const names = listed.map(
        p => `projects/p/databases/(default)/documents/${p}`
      );
      if (next() < 0.1) {
        // An empty path: only crafted data can produce it.
        names.push('projects/p/databases/(default)/documents');
      }
      const value = {
        arrayValue: {
          values: names.map(name => ({ referenceValue: name }))
        }
      };
      const keys = names.map(name => DocumentKey.fromName(name));
      const inFilter = new KeyFieldInFilter(FieldPath.keyField(), value);
      const notInFilter = new KeyFieldNotInFilter(FieldPath.keyField(), value);

      for (let probe = 0; probe < 20; probe++) {
        const candidate =
          listed.length > 0 && next() < 0.4
            ? listed[Math.floor(next() * listed.length)]
            : path();
        const document = doc(candidate, 1, {});
        expect(outcome(() => inFilter.matches(document))).to.equal(
          outcome(() => keys.some(key => key.isEqual(document.key)))
        );
        expect(outcome(() => notInFilter.matches(document))).to.equal(
          outcome(() => !keys.some(key => key.isEqual(document.key)))
        );
      }
    });
  }
});
