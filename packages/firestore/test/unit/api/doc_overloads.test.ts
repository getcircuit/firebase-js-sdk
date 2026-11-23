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

import { doc } from '../../../src/api/reference';
import { collectionReference } from '../../util/api_helpers';

describe('doc() overloads', () => {
  it('rejects an undefined path for a collection at compile time', () => {
    const reference = collectionReference('rooms');
    const maybeId: string | undefined = undefined;
    // @ts-expect-error a collection reference needs a string path or none at all
    expect(() => doc(reference, maybeId)).to.throw();
    expect(doc(reference).id).to.have.length(20);
  });
});
