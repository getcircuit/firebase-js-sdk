/**
 * @license
 * Copyright 2017 Google LLC
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

import {
  MapValue as ProtoMapValue,
  Value as ProtoValue
} from '../protos/firestore_proto_api';
import { debugAssert } from '../util/assert';
import { forEach } from '../util/obj';

import { FieldMask } from './field_mask';
import { FieldPath } from './path';
import { isServerTimestamp } from './server_timestamps';
import { deepClone, isMapValue, valueEquals } from './values';

export interface JsonObject<T> {
  [name: string]: T;
}
/**
 * An ObjectValue represents a MapValue in the Firestore Proto and offers the
 * ability to add and remove fields (via the ObjectValueBuilder).
 */
export class ObjectValue {
  // Spoke patch (field-copies): spoke-patch/upstream/issues/field-copies.md.
  // `mutableCopy()` lets two ObjectValues share one proto. Both are then marked
  // shared, and each copies the proto before its first write, so a write never
  // shows through the other.

  /** The fields this ObjectValue reads and writes, possibly shared. */
  private proto: { mapValue: ProtoMapValue };

  /**
   * Whether another ObjectValue may hold `proto` too.
   *
   * `mutableCopy()` sets it on both sides, and only `ensureWritable()` clears
   * it, after this side copies the proto. Nothing counts the holders, so a side
   * whose partner already copied away still copies once on its next write. That
   * extra copy costs time but never lets a write leak.
   */
  private sharesProto = false;

  constructor(value: { mapValue: ProtoMapValue }) {
    debugAssert(
      !isServerTimestamp(value),
      'ServerTimestamps should be converted to ServerTimestampValue'
    );
    // The new ObjectValue takes over the proto it receives: `set()`, `setAll()`
    // and `delete()` write into it in place.
    this.proto = value;
  }

  /**
   * The document's fields as a proto map value, for reading only.
   *
   * The proto, and every value `field()` returns from it, may be shared with
   * other ObjectValues, so changing it in place would change them too. Change
   * fields through `set()`, `setAll()` or `delete()`, or use `clone()` for a
   * proto of your own.
   */
  get value(): { mapValue: ProtoMapValue } {
    // Returns the proto itself: copying it here would cost what sharing saves.
    return this.proto;
  }

  static empty(): ObjectValue {
    return new ObjectValue({ mapValue: {} });
  }

  /**
   * Returns the value at the given path or null.
   *
   * @param path - the path to search
   * @returns The value at the path or null if the path is not set.
   */
  field(path: FieldPath): ProtoValue | null {
    if (path.isEmpty()) {
      return this.value;
    } else {
      let currentLevel: ProtoValue = this.value;
      for (let i = 0; i < path.length - 1; ++i) {
        currentLevel = (currentLevel.mapValue!.fields || {})[path.get(i)];
        if (!isMapValue(currentLevel)) {
          return null;
        }
      }
      currentLevel = (currentLevel.mapValue!.fields! || {})[path.lastSegment()];
      return currentLevel || null;
    }
  }

  /**
   * Sets the field to the provided value.
   *
   * @param path - The field path to set.
   * @param value - The value to set.
   */
  set(path: FieldPath, value: ProtoValue): void {
    debugAssert(
      !path.isEmpty(),
      'Cannot set field for empty path on ObjectValue'
    );
    const fieldsMap = this.getFieldsMap(path.popLast());
    fieldsMap[path.lastSegment()] = deepClone(value);
  }

  /**
   * Sets the provided fields to the provided values.
   *
   * @param data - A map of fields to values (or null for deletes).
   */
  setAll(data: Map<FieldPath, ProtoValue | null>): void {
    let parent = FieldPath.emptyPath();

    let upserts: { [key: string]: ProtoValue } = {};
    let deletes: string[] = [];

    data.forEach((value, path) => {
      if (!parent.isImmediateParentOf(path)) {
        // Insert the accumulated changes at this parent location
        const fieldsMap = this.getFieldsMap(parent);
        this.applyChanges(fieldsMap, upserts, deletes);
        upserts = {};
        deletes = [];
        parent = path.popLast();
      }

      if (value) {
        upserts[path.lastSegment()] = deepClone(value);
      } else {
        deletes.push(path.lastSegment());
      }
    });

    const fieldsMap = this.getFieldsMap(parent);
    this.applyChanges(fieldsMap, upserts, deletes);
  }

  /**
   * Removes the field at the specified path. If there is no field at the
   * specified path, nothing is changed.
   *
   * @param path - The field path to remove.
   */
  delete(path: FieldPath): void {
    debugAssert(
      !path.isEmpty(),
      'Cannot delete field for empty path on ObjectValue'
    );
    // Spoke patch (field-copies): spoke-patch/upstream/issues/field-copies.md.
    // The delete below changes the proto in place, so this side needs a proto
    // of its own first.
    this.ensureWritable();
    // Look the parent up only after `ensureWritable()`, which may replace the
    // proto: a parent found earlier would belong to the shared one.
    const nestedValue = this.field(path.popLast());
    if (isMapValue(nestedValue) && nestedValue.mapValue.fields) {
      delete nestedValue.mapValue.fields[path.lastSegment()];
    }
  }

  isEqual(other: ObjectValue): boolean {
    return valueEquals(this.value, other.value);
  }

  /**
   * Returns the map that contains the leaf element of `path`. If the parent
   * entry does not yet exist, or if it is not a map, a new map will be created.
   */
  private getFieldsMap(path: FieldPath): Record<string, ProtoValue> {
    // Spoke patch (field-copies): spoke-patch/upstream/issues/field-copies.md.
    // `set()` and `setAll()` write through the map returned here, so it must
    // come from a proto this side does not share.
    this.ensureWritable();
    // Read the proto only after `ensureWritable()`, which may replace it.
    let current = this.proto;

    if (!current.mapValue!.fields) {
      current.mapValue = { fields: {} };
    }

    for (let i = 0; i < path.length; ++i) {
      let next = current.mapValue!.fields![path.get(i)];
      if (!isMapValue(next) || !next.mapValue.fields) {
        next = { mapValue: { fields: {} } };
        current.mapValue!.fields![path.get(i)] = next;
      }
      current = next as { mapValue: ProtoMapValue };
    }

    return current.mapValue!.fields!;
  }

  /**
   * Modifies `fieldsMap` by adding, replacing or deleting the specified
   * entries.
   */
  private applyChanges(
    fieldsMap: Record<string, ProtoValue>,
    inserts: { [key: string]: ProtoValue },
    deletes: string[]
  ): void {
    forEach(inserts, (key, val) => (fieldsMap[key] = val));
    for (const field of deletes) {
      delete fieldsMap[field];
    }
  }

  /**
   * Returns a copy with its own deep copy of the proto.
   *
   * It always copies, shared or not, because callers may change the returned
   * proto directly.
   */
  clone(): ObjectValue {
    return new ObjectValue(
      deepClone(this.proto) as { mapValue: ProtoMapValue }
    );
  }

  // Spoke patch (field-copies): spoke-patch/upstream/issues/field-copies.md.
  /**
   * Returns a copy that shares this proto until either one writes.
   *
   * After this call, change both this ObjectValue and the copy only through
   * `set()`, `setAll()` and `delete()`. Any call to them copies the proto
   * first, even one that changes nothing, such as `setAll()` with an empty
   * map. Use `clone()` when some code will change the raw proto.
   */
  mutableCopy(): ObjectValue {
    // The copy receives the same proto object, not a copy of it.
    const copy = new ObjectValue(this.proto);
    // Mark both sides: either one may write first, and the other must keep the
    // fields it had.
    this.sharesProto = true;
    copy.sharesProto = true;
    return copy;
  }

  // Spoke patch (field-copies): spoke-patch/upstream/issues/field-copies.md.
  /**
   * Gives this ObjectValue a proto of its own before it writes to a shared one.
   *
   * The write methods call it before changing the proto: `getFieldsMap()` for
   * `set()` and `setAll()`, and `delete()` directly.
   */
  private ensureWritable(): void {
    if (this.sharesProto) {
      // Only this side moves to the new proto. Every other holder keeps the old
      // one and stays marked shared, so it copies too before it writes.
      this.proto = deepClone(this.proto) as { mapValue: ProtoMapValue };
      // This side is now the only holder of its proto, so its later writes
      // copy nothing.
      this.sharesProto = false;
    }
  }
}

/**
 * Returns a FieldMask built from all fields in a MapValue.
 */
export function extractFieldMask(value: ProtoMapValue): FieldMask {
  const fields: FieldPath[] = [];
  forEach(value!.fields, (key, value) => {
    const currentPath = new FieldPath([key]);
    if (isMapValue(value)) {
      const nestedMask = extractFieldMask(value.mapValue!);
      const nestedFields = nestedMask.fields;
      if (nestedFields.length === 0) {
        // Preserve the empty map by adding it to the FieldMask.
        fields.push(currentPath);
      } else {
        // For nested and non-empty ObjectValues, add the FieldPath of the
        // leaf nodes.
        for (const nestedPath of nestedFields) {
          fields.push(currentPath.child(nestedPath));
        }
      }
    } else {
      // For nested and non-empty ObjectValues, add the FieldPath of the leaf
      // nodes.
      fields.push(currentPath);
    }
  });
  return new FieldMask(fields);
}
