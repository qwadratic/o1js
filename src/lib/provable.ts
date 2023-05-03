/**
 * {@link Provable} is
 * - a namespace with tools for writing provable code
 * - the main interface for types that can be used in provable code
 */
import { bytesToBigInt } from '../bindings/crypto/bigint-helpers.js';
import { Field, Bool } from './core.js';
import { Gate, JsonGate, Provable as Provable_, Snarky } from '../snarky.js';
import type { FlexibleProvable, ProvableExtended } from './circuit_value.js';
import { Context } from './global-context.js';
import {
  inCheckedComputation,
  inProver,
  snarkContext,
} from './proof_system.js';
import {
  HashInput,
  InferJson,
  InferProvable,
  InferredProvable,
} from '../bindings/lib/provable-snarky.js';

// external API
export { Provable };

// internal API
export { memoizationContext, memoizeWitness, getBlindingValue, gatesFromJson };

// TODO move type declaration here
/**
 * `Provable<T>` is the general circuit type interface. It describes how a type `T` is made up of field elements and auxiliary (non-field element) data.
 *
 * You will find this as the required input type in a few places in snarkyjs. One convenient way to create a `Provable<T>` is using `Struct`.
 */
type Provable<T> = Provable_<T>;

const Provable = {
  /**
   * Create a new witness. A witness, or variable, is a value that is provided as input
   * by the prover. This provides a flexible way to introduce values from outside into the circuit.
   * However, note that nothing about how the value was created is part of the proof - `Provable.witness`
   * behaves exactly like user input. So, make sure that after receiving the witness you make any assertions
   * that you want to associate with it.
   * @example
   * Example for re-implementing `Field.inv` with the help of `witness`:
   * ```ts
   * let invX = Provable.witness(Field, () => {
   *   // compute the inverse of `x` outside the circuit, however you like!
   *   return Field.inv(x));
   * }
   * // prove that `invX` is really the inverse of `x`:
   * invX.mul(x).assertEquals(1);
   * ```
   */
  witness<T, S extends FlexibleProvable<T> = FlexibleProvable<T>>(
    type: S,
    compute: () => T
  ): T {
    let ctx = snarkContext.get();

    // outside provable code, we just call the callback and return its cloned result
    if (!inCheckedComputation() || ctx.inWitnessBlock) {
      return clone(type, compute());
    }
    let proverValue: T | undefined = undefined;
    let fields: Field[];

    let id = snarkContext.enter({ ...ctx, inWitnessBlock: true });
    try {
      fields = Snarky.exists(type.sizeInFields(), () => {
        proverValue = compute();
        let fields = type.toFields(proverValue);

        // TODO currently not needed, because fields are converted in OCaml, but will be
        // fields = fields.map((x) => x.toConstant());

        // TODO: enable this check
        // currently it throws for Scalar.. which seems to be flexible about what length is returned by toFields
        // if (fields.length !== type.sizeInFields()) {
        //   throw Error(
        //     `Invalid witness. Expected ${type.sizeInFields()} field elements, got ${
        //       fields.length
        //     }.`
        //   );
        // }
        return fields;
      });
    } finally {
      snarkContext.leave(id);
    }

    // rebuild the value from its fields (which are now variables) and aux data
    let aux = type.toAuxiliary(proverValue);
    let value = (type as Provable<T>).fromFields(fields, aux);

    // add type-specific constraints
    type.check(value);

    return value;
  },

  /**
   * Generalization of `Circuit.if` for choosing between more than two different cases.
   * It takes a "mask", which is an array of `Bool`s that contains only one `true` element, a type/constructor, and an array of values of that type.
   * The result is that value which corresponds to the true element of the mask.
   * @example
   * ```ts
   * let x = Circuit.switch([Bool(false), Bool(true)], Field, [Field(1), Field(2)]);
   * x.assertEquals(2);
   * ```
   */
  switch<T, A extends FlexibleProvable<T>>(
    mask: Bool[],
    type: A,
    values: T[]
  ): T {
    // picks the value at the index where mask is true
    let nValues = values.length;
    if (mask.length !== nValues)
      throw Error(
        `Circuit.switch: \`values\` and \`mask\` have different lengths (${values.length} vs. ${mask.length}), which is not allowed.`
      );
    let checkMask = () => {
      let nTrue = mask.filter((b) => b.toBoolean()).length;
      if (nTrue > 1) {
        throw Error(
          `Circuit.switch: \`mask\` must have 0 or 1 true element, found ${nTrue}.`
        );
      }
    };
    if (mask.every((b) => b.toField().isConstant())) checkMask();
    else Provable.asProver(checkMask);
    let size = type.sizeInFields();
    let fields = Array(size).fill(Field(0));
    for (let i = 0; i < nValues; i++) {
      let valueFields = type.toFields(values[i]);
      let maskField = mask[i].toField();
      for (let j = 0; j < size; j++) {
        let maybeField = valueFields[j].mul(maskField);
        fields[j] = fields[j].add(maybeField);
      }
    }
    let aux = auxiliary(type as Provable<T>, () => {
      let i = mask.findIndex((b) => b.toBoolean());
      if (i === -1) return type.toAuxiliary();
      return type.toAuxiliary(values[i]);
    });
    return type.fromFields(fields, aux) as T;
  },

  assertEqual,
  equal,

  /**
   * Creates a {@link Provable} for a generic array.
   * @example
   * ```ts
   * const ProvableArray = Circuit.array(Field, 5);
   * ```
   */
  array: provableArray,

  /**
   * Interface to log elements within a circuit. Similar to `console.log()`.
   * @example
   * ```ts
   * const element = Field(42);
   * Circuit.log(element);
   * ```
   */
  log(...args: any) {
    Provable.asProver(() => {
      let prettyArgs = [];
      for (let arg of args) {
        if (arg?.toPretty !== undefined) prettyArgs.push(arg.toPretty());
        else {
          try {
            prettyArgs.push(JSON.parse(JSON.stringify(arg)));
          } catch {
            prettyArgs.push(arg);
          }
        }
      }
      console.log(...prettyArgs);
    });
  },

  /**
   * Runs code as a prover.
   * @example
   * ```ts
   * Provable.asProver(() => {
   *   // Your prover code here
   * });
   * ```
   */
  asProver(f: () => void) {
    if (inCheckedComputation()) {
      Snarky.asProver(f);
    } else {
      f();
    }
  },

  /**
   * Runs provable code quickly, without creating a proof, but still checking whether constraints are satisfied.
   * @example
   * ```ts
   * Provable.runAndCheck(() => {
   *   // Your code to check here
   * });
   * ```
   */
  runAndCheck(f: () => void) {
    let [, result] = snarkContext.runWith({ inCheckedComputation: true }, () =>
      Snarky.runAndCheck(f)
    );
    return result;
  },

  /**
   * Runs provable code quickly, without creating a proof, and not checking whether constraints are satisfied.
   * @example
   * ```ts
   * Provable.runUnchecked(() => {
   *   // Your code to run here
   * });
   * ```
   */
  runUnchecked(f: () => void) {
    let [, result] = snarkContext.runWith({ inCheckedComputation: true }, () =>
      Snarky.runUnchecked(f)
    );
    return result;
  },

  /**
   * Returns information about the constraints created by the callback function.
   * @example
   * ```ts
   * const result = Provable.constraintSystem(circuit);
   * console.log(result);
   * ```
   */
  constraintSystem<T>(f: () => T) {
    let [, result] = snarkContext.runWith(
      { inAnalyze: true, inCheckedComputation: true },
      () => {
        let result: T;
        let { rows, digest, json } = Snarky.constraintSystem(() => {
          result = f();
        });
        let { gates, publicInputSize } = gatesFromJson(json);
        return { rows, digest, result: result! as T, gates, publicInputSize };
      }
    );
    return result;
  },

  /**
   * Checks if the circuit is in prover mode.
   * @example
   * ```ts
   * if (Circuit.inProver()) {
   *   // Prover-specific code
   * }
   * ```
   */
  inProver,
  /**
   * Checks if the circuit is in checked computation mode.
   * @example
   * ```ts
   * if (Circuit.inCheckedComputation()) {
   *   // Checked computation-specific code
   * }
   * ```
   */
  inCheckedComputation,
};

type ToFieldable = { toFields(): Field[] };

// general provable methods

/**
 * Asserts that two values are equal.
 * @example
 * ```ts
 * class MyStruct extends Struct({ a: Field, b: Bool }) {};
 * const a: MyStruct = { a: Field(0), b: Bool(false) };
 * const b: MyStruct = { a: Field(1), b: Bool(true) };
 * Circuit.assertEqual(MyStruct, a, b);
 * ```
 */
function assertEqual<T>(type: FlexibleProvable<T>, x: T, y: T): void;
function assertEqual<T extends ToFieldable>(x: T, y: T): void;
function assertEqual(typeOrX: any, xOrY: any, yOrUndefined?: any) {
  if (yOrUndefined === undefined) {
    return assertEqualInstance(typeOrX, xOrY);
  } else {
    return assertEqualStruct(typeOrX, xOrY, yOrUndefined);
  }
}
function assertEqualInstance<T extends ToFieldable>(x: T, y: T) {
  let xs = x.toFields();
  let ys = y.toFields();
  let n = checkLength('Provable.assertEqual', xs, ys);
  for (let i = 0; i < n; i++) {
    xs[i].assertEquals(ys[i]);
  }
}
function assertEqualStruct<T>(type: Provable<T>, x: T, y: T) {
  let xs = type.toFields(x);
  let ys = type.toFields(y);
  for (let i = 0; i < xs.length; i++) {
    xs[i].assertEquals(ys[i]);
  }
}

/**
 * Checks if two elements are equal.
 * @example
 * ```ts
 * class MyStruct extends Struct({ a: Field, b: Bool }) {};
 * const a: MyStruct = { a: Field(0), b: Bool(false) };
 * const b: MyStruct = { a: Field(1), b: Bool(true) };
 * const isEqual = Circuit.equal(MyStruct, a, b);
 * ```
 */
function equal<T>(type: FlexibleProvable<T>, x: T, y: T): Bool;
function equal<T extends ToFieldable>(x: T, y: T): Bool;
function equal(typeOrX: any, xOrY: any, yOrUndefined?: any) {
  if (yOrUndefined === undefined) {
    return equalInstance(typeOrX, xOrY);
  } else {
    return equalStruct(typeOrX, xOrY, yOrUndefined);
  }
}
function equalInstance<T extends ToFieldable>(x: T, y: T) {
  let xs = x.toFields();
  let ys = y.toFields();
  checkLength('Provable.equal', xs, ys);
  return xs.map((x, i) => x.equals(ys[i])).reduce(Bool.and);
}
function equalStruct<T>(type: Provable<T>, x: T, y: T) {
  let xs = type.toFields(x);
  let ys = type.toFields(y);
  return xs.map((x, i) => x.equals(ys[i])).reduce(Bool.and);
}

// helpers

function checkLength(name: string, xs: Field[], ys: Field[]) {
  let n = xs.length;
  let m = ys.length;
  if (n !== m) {
    throw Error(
      `${name}: inputs must contain the same number of field elements, got ${n} !== ${m}`
    );
  }
  return n;
}

function gatesFromJson(cs: { gates: JsonGate[]; public_input_size: number }) {
  let gates: Gate[] = cs.gates.map(({ typ, wires, coeffs: byteCoeffs }) => {
    let coeffs = [];
    for (let coefficient of byteCoeffs) {
      let arr = new Uint8Array(coefficient);
      coeffs.push(bytesToBigInt(arr).toString());
    }
    return { type: typ, wires, coeffs };
  });
  return { publicInputSize: cs.public_input_size, gates };
}

function clone<T, S extends FlexibleProvable<T>>(type: S, value: T): T {
  let fields = type.toFields(value);
  let aux = type.toAuxiliary(value);
  return (type as Provable<T>).fromFields(fields, aux);
}

function auxiliary<T>(type: FlexibleProvable<T>, compute: () => any[]) {
  let aux;
  if (inCheckedComputation()) Provable.asProver(() => (aux = compute()));
  else aux = compute();
  return aux ?? type.toAuxiliary();
}

let memoizationContext = Context.create<{
  memoized: { fields: Field[]; aux: any[] }[];
  currentIndex: number;
  blindingValue: Field;
}>();

/**
 * Like Circuit.witness, but memoizes the witness during transaction construction
 * for reuse by the prover. This is needed to witness non-deterministic values.
 */
function memoizeWitness<T>(type: FlexibleProvable<T>, compute: () => T) {
  return Provable.witness<T>(type as Provable<T>, () => {
    if (!memoizationContext.has()) return compute();
    let context = memoizationContext.get();
    let { memoized, currentIndex } = context;
    let currentValue = memoized[currentIndex];
    if (currentValue === undefined) {
      let value = compute();
      let fields = type.toFields(value).map((x) => x.toConstant());
      let aux = type.toAuxiliary(value);
      currentValue = { fields, aux };
      memoized[currentIndex] = currentValue;
    }
    context.currentIndex += 1;
    return (type as Provable<T>).fromFields(
      currentValue.fields,
      currentValue.aux
    );
  });
}

function getBlindingValue() {
  if (!memoizationContext.has()) return Field.random();
  let context = memoizationContext.get();
  if (context.blindingValue === undefined) {
    context.blindingValue = Field.random();
  }
  return context.blindingValue;
}

// provable array

function provableArray<A extends FlexibleProvable<any>>(
  elementType: A,
  length: number
): InferredProvable<A[]> {
  type T = InferProvable<A>;
  type TJson = InferJson<A>;
  let type = elementType as ProvableExtended<T>;
  return {
    /**
     * Returns the size of this structure in {@link Field} elements.
     * @returns size of this structure
     */
    sizeInFields() {
      let elementLength = type.sizeInFields();
      return elementLength * length;
    },
    /**
     * Serializes this structure into {@link Field} elements.
     * @returns an array of {@link Field} elements
     */
    toFields(array: T[]) {
      return array.map((e) => type.toFields(e)).flat();
    },
    /**
     * Serializes this structure's auxiliary data.
     * @returns auxiliary data
     */
    toAuxiliary(array?) {
      let array_ = array ?? Array<undefined>(length).fill(undefined);
      return array_?.map((e) => type.toAuxiliary(e));
    },

    /**
     * Deserializes an array of {@link Field} elements into this structure.
     */
    fromFields(fields: Field[], aux?: any[]) {
      let array = [];
      let size = type.sizeInFields();
      let n = length;
      for (let i = 0, offset = 0; i < n; i++, offset += size) {
        array[i] = type.fromFields(
          fields.slice(offset, offset + size),
          aux?.[i]
        );
      }
      return array;
    },
    check(array: T[]) {
      for (let i = 0; i < length; i++) {
        (type as any).check(array[i]);
      }
    },
    /**
     * Encodes this structure into a JSON-like object.
     */
    toJSON(array) {
      if (!('toJSON' in type)) {
        throw Error('circuitArray.toJSON: element type has no toJSON method');
      }
      return array.map((v) => type.toJSON(v));
    },

    /**
     * Decodes a JSON-like object into this structure.
     */
    fromJSON(json) {
      if (!('fromJSON' in type)) {
        throw Error(
          'circuitArray.fromJSON: element type has no fromJSON method'
        );
      }
      return json.map((a) => type.fromJSON(a));
    },
    toInput(array) {
      if (!('toInput' in type)) {
        throw Error('circuitArray.toInput: element type has no toInput method');
      }
      return array.reduce(
        (curr, value) => HashInput.append(curr, type.toInput(value)),
        HashInput.empty
      );
    },
  } satisfies ProvableExtended<T[], TJson[]> as any;
}
