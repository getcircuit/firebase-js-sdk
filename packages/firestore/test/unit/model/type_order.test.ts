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
 * `typeOrder` classifies a value by reading its keys. These tests check that it
 * gives the release's result for every value, including malformed ones, and
 * that data() and the cache's size estimate give the release's results.
 */

import { DocumentData } from '@firebase/firestore-types';
import { expect } from 'chai';

import { GeoPoint, Timestamp } from '../../../src';
import { ExpUserDataWriter } from '../../../src/api/user_data_writer';
import { vector } from '../../../src/lite-api/field_value_impl';
import { ServerTimestampBehavior } from '../../../src/lite-api/user_data_writer';
import {
  normalizeByteString,
  normalizeNumber,
  normalizeTimestamp
} from '../../../src/model/normalize';
import {
  getLocalWriteTime,
  getPreviousValue,
  isServerTimestamp,
  serverTimestamp
} from '../../../src/model/server_timestamps';
import { TypeOrder } from '../../../src/model/type_order';
import {
  estimateByteSize,
  isMaxValue,
  isVectorValue,
  MAX_VALUE,
  MIN_VALUE,
  typeOrder
} from '../../../src/model/values';
import {
  ApiClientObjectMap,
  ArrayValue as ProtoArrayValue,
  Timestamp as ProtoTimestamp,
  Value as ProtoValue
} from '../../../src/protos/firestore_proto_api';
import { fail } from '../../../src/util/assert';
import {
  getLogLevel,
  LogLevelString,
  setLogLevel
} from '../../../src/util/log';
import { forEach } from '../../../src/util/obj';
import { firestore } from '../../util/api_helpers';
import { blob, ref, wrap } from '../../util/helpers';

/**
 * The firebase@12.19.0 `typeOrder`, copied as the reference: the first
 * `value_type` member present decides, and a value with none throws.
 */
function releaseTypeOrder(value: ProtoValue): TypeOrder {
  if ('nullValue' in value) {
    return TypeOrder.NullValue;
  } else if ('booleanValue' in value) {
    return TypeOrder.BooleanValue;
  } else if ('integerValue' in value || 'doubleValue' in value) {
    return TypeOrder.NumberValue;
  } else if ('timestampValue' in value) {
    return TypeOrder.TimestampValue;
  } else if ('stringValue' in value) {
    return TypeOrder.StringValue;
  } else if ('bytesValue' in value) {
    return TypeOrder.BlobValue;
  } else if ('referenceValue' in value) {
    return TypeOrder.RefValue;
  } else if ('geoPointValue' in value) {
    return TypeOrder.GeoPointValue;
  } else if ('arrayValue' in value) {
    return TypeOrder.ArrayValue;
  } else if ('mapValue' in value) {
    if (isServerTimestamp(value)) {
      return TypeOrder.ServerTimestampValue;
    } else if (isMaxValue(value)) {
      return TypeOrder.MaxValue;
    } else if (isVectorValue(value)) {
      return TypeOrder.VectorValue;
    }
    return TypeOrder.ObjectValue;
  } else {
    return fail(0x6e87, 'Invalid value type', { value });
  }
}

/**
 * The firebase@12.19.0 `estimateByteSize`, copied as the reference on top of
 * `releaseTypeOrder` and the `forEach` helper.
 */
function releaseEstimateByteSize(value: ProtoValue): number {
  switch (releaseTypeOrder(value)) {
    case TypeOrder.NullValue:
      return 4;
    case TypeOrder.BooleanValue:
      return 4;
    case TypeOrder.NumberValue:
      return 8;
    case TypeOrder.TimestampValue:
      return 16;
    case TypeOrder.ServerTimestampValue:
      const previousValue = getPreviousValue(value);
      return previousValue ? 16 + releaseEstimateByteSize(previousValue) : 16;
    case TypeOrder.StringValue:
      return value.stringValue!.length * 2;
    case TypeOrder.BlobValue:
      return normalizeByteString(value.bytesValue!).approximateByteSize();
    case TypeOrder.RefValue:
      return value.referenceValue!.length;
    case TypeOrder.GeoPointValue:
      return 16;
    case TypeOrder.ArrayValue:
      return (value.arrayValue!.values || []).reduce(
        (previousSize, element) =>
          previousSize + releaseEstimateByteSize(element),
        0
      );
    case TypeOrder.VectorValue:
    case TypeOrder.ObjectValue:
      let size = 0;
      forEach(value.mapValue!.fields, (key, field) => {
        size += key.length + releaseEstimateByteSize(field);
      });
      return size;
    default:
      throw fail(0x34ae, 'Invalid value type', { value });
  }
}

/**
 * The firebase@12.19.0 `AbstractUserDataWriter.convertValue` and
 * `convertObjectMap`, copied as the reference on top of `releaseTypeOrder`
 * and the `forEach` helper. Bytes and references convert as in the full SDK.
 */
class ReleaseUserDataWriter extends ExpUserDataWriter {
  convertValue(
    value: ProtoValue,
    serverTimestampBehavior: ServerTimestampBehavior = 'none'
  ): unknown {
    switch (releaseTypeOrder(value)) {
      case TypeOrder.NullValue:
        return null;
      case TypeOrder.BooleanValue:
        return value.booleanValue!;
      case TypeOrder.NumberValue:
        return normalizeNumber(value.integerValue || value.doubleValue);
      case TypeOrder.TimestampValue:
        return this.releaseTimestamp(value.timestampValue!);
      case TypeOrder.ServerTimestampValue:
        return this.releaseServerTimestamp(value, serverTimestampBehavior);
      case TypeOrder.StringValue:
        return value.stringValue!;
      case TypeOrder.BlobValue:
        return this.convertBytes(normalizeByteString(value.bytesValue!));
      case TypeOrder.RefValue:
        return this.convertReference(value.referenceValue!);
      case TypeOrder.GeoPointValue:
        return new GeoPoint(
          normalizeNumber(value.geoPointValue!.latitude),
          normalizeNumber(value.geoPointValue!.longitude)
        );
      case TypeOrder.ArrayValue:
        return this.releaseArray(value.arrayValue!, serverTimestampBehavior);
      case TypeOrder.ObjectValue:
        return this.convertObjectMap(
          value.mapValue!.fields,
          serverTimestampBehavior
        );
      case TypeOrder.VectorValue:
        return this.convertVectorValue(value.mapValue!);
      default:
        throw fail(0xf2a2, 'Invalid value type', {
          value
        });
    }
  }

  convertObjectMap(
    fields: ApiClientObjectMap<ProtoValue> | undefined,
    serverTimestampBehavior: ServerTimestampBehavior = 'none'
  ): DocumentData {
    const result: DocumentData = {};
    forEach(fields, (key, value) => {
      result[key] = this.convertValue(value, serverTimestampBehavior);
    });
    return result;
  }

  private releaseArray(
    arrayValue: ProtoArrayValue,
    serverTimestampBehavior: ServerTimestampBehavior
  ): unknown[] {
    return (arrayValue.values || []).map(value =>
      this.convertValue(value, serverTimestampBehavior)
    );
  }

  private releaseServerTimestamp(
    value: ProtoValue,
    serverTimestampBehavior: ServerTimestampBehavior
  ): unknown {
    switch (serverTimestampBehavior) {
      case 'previous':
        const previousValue = getPreviousValue(value);
        if (previousValue == null) {
          return null;
        }
        return this.convertValue(previousValue, serverTimestampBehavior);
      case 'estimate':
        return this.releaseTimestamp(getLocalWriteTime(value));
      default:
        return null;
    }
  }

  private releaseTimestamp(value: ProtoTimestamp): Timestamp {
    const normalizedValue = normalizeTimestamp(value);
    return new Timestamp(normalizedValue.seconds, normalizedValue.nanos);
  }
}

/** What a call did: the value it returned, or the error it threw. */
type Outcome =
  { returned: unknown } | { threw: { name: string; message: string } };

/**
 * Runs `fn` and records what it did.
 *
 * Logging is off while it runs: the SDK logs every failed assertion, and the
 * malformed values here fail them on purpose.
 */
function outcome(fn: () => unknown): Outcome {
  const logLevel = getLogLevel();
  setLogLevel('silent');
  try {
    return { returned: fn() };
  } catch (e) {
    const error = e as Error;
    return { threw: { name: error.name, message: error.message } };
  } finally {
    setLogLevel(logLevel as unknown as LogLevelString);
  }
}

/**
 * Returns the key order of every plain object inside `data`, which deep
 * equality ignores.
 */
function fieldOrder(data: unknown): unknown {
  if (Array.isArray(data)) {
    return data.map(fieldOrder);
  }
  if (
    data !== null &&
    typeof data === 'object' &&
    Object.getPrototypeOf(data) === Object.prototype
  ) {
    const object = data as Record<string, unknown>;
    return Object.keys(object).map(key => [key, fieldOrder(object[key])]);
  }
  return null;
}

/**
 * Expects `actual` to return what `expected` returns, compared deeply and with
 * the same key order, or to throw the same error.
 */
function expectReleaseOutcome(
  actual: () => unknown,
  expected: () => unknown,
  description: string
): void {
  const actualOutcome = outcome(actual);
  const expectedOutcome = outcome(expected);
  expect(actualOutcome, description).to.deep.equal(expectedOutcome);
  if ('returned' in actualOutcome && 'returned' in expectedOutcome) {
    expect(fieldOrder(actualOutcome.returned), description).to.deep.equal(
      fieldOrder(expectedOutcome.returned)
    );
  }
}

/** Expects `typeOrder` to return what the release returns, or to throw too. */
function expectReleaseTypeOrder(value: ProtoValue): void {
  expectReleaseOutcome(
    () => typeOrder(value),
    () => releaseTypeOrder(value),
    JSON.stringify(value)
  );
}

/**
 * Returns a seeded pseudo-random generator of numbers in [0, 1).
 *
 * It is a linear congruential generator, so every run replays the same values.
 * Its first values barely differ between nearby seeds, so each test draws all
 * its cases from one generator.
 */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

function pick<T>(next: () => number, items: T[]): T {
  return items[Math.floor(next() * items.length)];
}

const members = [
  'nullValue',
  'booleanValue',
  'integerValue',
  'doubleValue',
  'timestampValue',
  'stringValue',
  'bytesValue',
  'referenceValue',
  'geoPointValue',
  'arrayValue',
  'mapValue'
];

/**
 * One well-formed value of every kind, as the SDK builds them: user data,
 * protos the server sends, server timestamps, the min and max bounds and
 * vectors.
 */
function valuesOfEveryKind(): ProtoValue[] {
  const writeTime = new Timestamp(1700000000, 5000);
  return [
    MIN_VALUE,
    MAX_VALUE,
    { nullValue: 'NULL_VALUE' },
    wrap(null),
    wrap(true),
    wrap(false),
    wrap(0),
    wrap(-0),
    wrap(42),
    wrap(1.5),
    wrap(NaN),
    wrap(Infinity),
    { integerValue: '7' },
    { doubleValue: 'NaN' },
    wrap(new Timestamp(1700000000, 123)),
    { timestampValue: '2026-11-27T10:00:00.123456Z' },
    { timestampValue: { seconds: '1700000000', nanos: 1 } },
    wrap(''),
    wrap('a string'),
    wrap(blob(1, 2, 3)),
    { bytesValue: 'AQID' },
    wrap(ref('coll/doc')),
    wrap(new GeoPoint(51.5, -0.1)),
    wrap([]),
    { arrayValue: {} },
    wrap([1, 'two', { three: [null] }]),
    { arrayValue: { values: [wrap([1]), wrap(null)] } },
    wrap({}),
    { mapValue: {} },
    wrap({ a: 1, nested: { b: [true] } }),
    serverTimestamp(writeTime, null),
    serverTimestamp(writeTime, wrap('before')),
    serverTimestamp(writeTime, serverTimestamp(writeTime, wrap(1))),
    wrap(vector([1, 2, 3])),
    wrap(vector([])),
    // Maps that look like the special maps but are not.
    wrap({ '__type__': 'something else' }),
    wrap({ '__type__': '__vector__' }),
    wrap({ '__type__': '__vector__', value: 'not an array' }),
    wrap({ '__type__': '__max__', extra: 1 })
  ];
}

/** Returns a random value tree, mostly well formed, `depth` levels deep at most. */
function randomValue(next: () => number, depth: number): ProtoValue {
  const scalars = valuesOfEveryKind().filter(
    value => !('mapValue' in value) && !('arrayValue' in value)
  );
  const kind = depth <= 0 ? 0 : Math.floor(next() * 5);
  if (kind === 1) {
    const values: ProtoValue[] = [];
    const length = Math.floor(next() * 4);
    for (let i = 0; i < length; i++) {
      values.push(randomValue(next, depth - 1));
    }
    return { arrayValue: { values } };
  } else if (kind === 2) {
    const fields: Record<string, ProtoValue> = {};
    const size = Math.floor(next() * 5);
    for (let i = 0; i < size; i++) {
      fields['f' + Math.floor(next() * 8)] = randomValue(next, depth - 1);
    }
    return { mapValue: { fields } };
  } else if (kind === 3) {
    const writeTime = new Timestamp(1700000000 + Math.floor(next() * 100), 0);
    const previous = next() < 0.5 ? null : randomValue(next, depth - 1);
    return serverTimestamp(writeTime, previous);
  }
  return pick(next, [...scalars, wrap(vector([next(), next()]))]);
}

/**
 * Values no well-formed proto holds: no member, unknown keys, members set to
 * undefined, several members, members the value inherits, members only
 * pipelines use, and no prototype at all.
 */
function malformedValues(): ProtoValue[] {
  const values: ProtoValue[] = [
    {},
    Object.create(null),
    { valueType: 'stringValue' } as ProtoValue,
    { nullValue: undefined },
    { stringValue: undefined },
    { mapValue: undefined },
    { arrayValue: undefined },
    { valueType: 'stringValue', stringValue: 'a' } as ProtoValue,
    { stringValue: 'a', nullValue: 'NULL_VALUE' },
    { stringValue: 'a', valueType: 'nullValue' } as ProtoValue,
    { mapValue: { fields: {} }, booleanValue: true },
    { ...serverTimestamp(Timestamp.now(), null), stringValue: 'a' },
    { ...MAX_VALUE, nullValue: 'NULL_VALUE' },
    { ...wrap(vector([1])), integerValue: '1' },
    { integerValue: '1', doubleValue: 2.5 },
    { doubleValue: 2.5, integerValue: '1' },
    { fieldReferenceValue: 'a' },
    { fieldReferenceValue: 'a', stringValue: 'b' },
    { functionValue: { name: 'f' } },
    { variableReferenceValue: 'v' },
    { pipelineValue: { stages: [] } },
    { pipelineValue: { stages: [] }, arrayValue: { values: [] } }
  ];
  values.push(Object.create({ nullValue: 'NULL_VALUE' }));
  const inheritsNull = Object.create({ nullValue: 'NULL_VALUE' });
  inheritsNull.stringValue = 'a';
  values.push(inheritsNull);
  const noPrototype = Object.create(null);
  noPrototype.stringValue = 'a';
  values.push(noPrototype);
  // Functions are objects to `in`: with no member they fail the assertion,
  // and with an enumerable member they are classified by it.
  values.push((() => {}) as unknown as ProtoValue);
  values.push(Object.assign(() => {}, { stringValue: 'a' }) as ProtoValue);
  return values;
}

/**
 * Things that are not objects where a value belongs, as a malformed bundle can
 * hold.
 */
function notObjects(): ProtoValue[] {
  return [null, undefined, 'stringValue', 'x'.repeat(1000), 1, true].map(
    value => value as unknown as ProtoValue
  );
}

describe('typeOrder', () => {
  it('matches the release on a value of every kind', () => {
    for (const value of valuesOfEveryKind()) {
      expectReleaseTypeOrder(value);
    }
  });

  it('matches the release on malformed values', () => {
    for (const value of malformedValues()) {
      expectReleaseTypeOrder(value);
    }
  });

  it('throws the release error on a value that is not an object', () => {
    for (const value of notObjects()) {
      expectReleaseTypeOrder(value);
    }
  });

  it('matches the release on 2000 random sets of members in random order', () => {
    const samples = valuesOfEveryKind();
    const next = random(2026);
    for (let i = 0; i < 2000; i++) {
      const value: Record<string, unknown> = {};
      const count = Math.floor(next() * 5);
      for (let j = 0; j < count; j++) {
        const member = pick(next, [
          ...members,
          'fieldReferenceValue',
          'valueType',
          'other'
        ]);
        // Take the member's value from a sample that has it, so the special
        // maps keep their shape, or a random one otherwise.
        const donor = samples.find(
          sample => member in sample && next() < 0.5
        ) as Record<string, unknown> | undefined;
        value[member] = donor ? donor[member] : pick(next, samples);
      }
      expectReleaseTypeOrder(value as ProtoValue);
    }
  });

  it('does not see members a value hides', () => {
    // The documented boundary: a non-enumerable member, on an object or a
    // function, is not seen, so the value has no member and fails.
    const hiddenOnObject = {};
    const hiddenOnFunction = (): void => {};
    for (const target of [hiddenOnObject, hiddenOnFunction]) {
      Object.defineProperty(target, 'nullValue', { value: 'NULL_VALUE' });
      expect(
        outcome(() => typeOrder(target as ProtoValue)),
        typeof target
      ).to.have.property('threw');
    }
  });

  it('classifies a value without testing for members it lacks', () => {
    // typeOrder reads the value's keys; the release tested `member in value`
    // for each member in turn, which a Proxy sees as `has` calls.
    for (const value of valuesOfEveryKind()) {
      let memberChecks = 0;
      const watched = new Proxy(value, {
        has(target, key) {
          memberChecks++;
          return Reflect.has(target, key);
        }
      });
      expect(typeOrder(watched)).to.equal(releaseTypeOrder(value));
      expect(memberChecks, JSON.stringify(value)).to.equal(0);
    }
  });
});

describe('data() and the cache size estimate', () => {
  const writer = new ExpUserDataWriter(firestore());
  const releaseWriter = new ReleaseUserDataWriter(firestore());
  const behaviors: ServerTimestampBehavior[] = ['none', 'estimate', 'previous'];

  function expectReleaseResults(value: ProtoValue): void {
    const description = JSON.stringify(value);
    for (const behavior of behaviors) {
      expectReleaseOutcome(
        () => writer.convertValue(value, behavior),
        () => releaseWriter.convertValue(value, behavior),
        description
      );
    }
    expectReleaseOutcome(
      () => estimateByteSize(value),
      () => releaseEstimateByteSize(value),
      description
    );
  }

  it('give the release results on a value of every kind', () => {
    // One by one, since the max value and the malformed vectors throw.
    for (const value of valuesOfEveryKind()) {
      expectReleaseResults(value);
    }
  });

  it('give the release results on malformed values', () => {
    for (const value of [...malformedValues(), ...notObjects()]) {
      expectReleaseResults(value);
    }
  });

  it('give the release results on a document of every kind', () => {
    const fields: Record<string, ProtoValue> = {};
    valuesOfEveryKind().forEach((value, i) => {
      fields['field' + i] = value;
    });
    // Leave out the values that throw, so the document converts.
    for (const name of Object.keys(fields)) {
      if ('threw' in outcome(() => releaseWriter.convertValue(fields[name]))) {
        delete fields[name];
      }
    }
    expect(Object.keys(fields)).to.have.length.above(30);
    expectReleaseResults({ mapValue: { fields } });
  });

  it('give the release results on 300 random documents', () => {
    const next = random(2026);
    for (let i = 0; i < 300; i++) {
      const fields: Record<string, ProtoValue> = {};
      const size = 1 + Math.floor(next() * 6);
      for (let j = 0; j < size; j++) {
        fields['f' + j] = randomValue(next, 4);
      }
      expectReleaseResults({ mapValue: { fields } });
    }
  });

  it('keep map fields in their stored order', () => {
    const value = wrap({ z: 1, a: { y: 2, b: 3 }, m: [{ q: 4, c: 5 }] });
    expect(Object.keys(writer.convertValue(value) as object)).to.deep.equal([
      'z',
      'a',
      'm'
    ]);
    expectReleaseResults(value);
  });

  it('read map fields from a fields object with no prototype', () => {
    const fields = Object.create(null);
    fields.a = wrap(1);
    fields.hasOwnProperty = wrap('a field like any other');
    const value: ProtoValue = { mapValue: { fields } };
    expect(writer.convertValue(value)).to.deep.equal({
      a: 1,
      hasOwnProperty: 'a field like any other'
    });
    expectReleaseResults(value);
    expectReleaseResults({
      mapValue: { fields: { hasOwnProperty: wrap(true) } }
    });
  });

  it('skip map fields the fields object inherits', () => {
    const fields = Object.create({ inherited: wrap('skipped') });
    fields.own = wrap('kept');
    const value: ProtoValue = { mapValue: { fields } };
    expect(writer.convertValue(value)).to.deep.equal({ own: 'kept' });
    expect(estimateByteSize(value)).to.equal('own'.length + 'kept'.length * 2);
    expectReleaseResults(value);
  });
});
