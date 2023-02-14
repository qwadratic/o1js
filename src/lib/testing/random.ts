import {
  customTypes,
  Layout,
  TypeMap,
  Json,
  AccountUpdate,
  ZkappCommand,
} from '../../provable/gen/transaction-bigint.js';
import * as Bigint from '../../provable/transaction-leaves-bigint.js';
import { genericLayoutFold } from '../../provable/from-layout.js';
import { jsLayout } from '../../provable/gen/js-layout.js';
import { GenericProvable, primitiveTypeMap } from '../../provable/generic.js';
import * as CurveBigint from '../../provable/curve-bigint.js';
import * as SignatureBigint from '../../mina-signer/src/signature.js';
import { randomBytes } from '../../js_crypto/random.js';
import { alphabet } from '../../provable/base58.js';
import { bytesToBigInt } from '../../js_crypto/bigint-helpers.js';
import { Memo } from '../../mina-signer/src/memo.js';
import { emptyPermissions } from '../../mina-signer/src/sign-zkapp-command.js';

export { Random, sample, withHardCoded };

type Random<T> = {
  create(): () => T;
  invalid?: Random<T>;
};
function Random_<T>(
  next: () => T,
  toInvalid?: (valid: Random<T>) => Random<T>
): Random<T> {
  let rng: Random<T> = { create: () => next };
  if (toInvalid !== undefined) rng.invalid = toInvalid(rng);
  return rng;
}

function sample<T>(rng: Random<T>, size: number) {
  let next = rng.create();
  return Array.from({ length: size }, next);
}

const boolean = Random_(() => drawOneOf8() < 4);

const Bool = map(boolean, Bigint.Bool);
const UInt32 = biguintWithInvalid(32);
const UInt64 = biguintWithInvalid(64);

const Field = fieldWithInvalid(Bigint.Field);
const Scalar = fieldWithInvalid(CurveBigint.Scalar);

const Sign = map(boolean, (b) => Bigint.Sign(b ? 1 : -1));
const PrivateKey = Random_(CurveBigint.PrivateKey.random);
const PublicKey = map(PrivateKey, CurveBigint.PrivateKey.toPublicKey);
const keypair = map(PrivateKey, (privatekey) => ({
  privatekey,
  publicKey: CurveBigint.PrivateKey.toPublicKey(privatekey),
}));

const TokenId = oneOf(Bigint.TokenId.emptyValue(), Field);
const StateHash = Field;
const AuthorizationKind = reject(
  record<Bigint.AuthorizationKind>({
    isProved: Bool,
    isSigned: Bool,
  }),
  (t) => !!t.isProved && !!t.isSigned
);
const AuthRequired = map(
  oneOf<Json.AuthRequired[]>(
    'None',
    'Proof',
    'Signature',
    'Either',
    'Impossible'
  ),
  Bigint.AuthRequired.fromJSON
);
// TODO non ascii strings in zkapp uri and token symbol fail
const TokenSymbol = map(ascii(nat(6)), Bigint.TokenSymbol.fromJSON);
const Events = map(
  array(array(Field, int(1, 5)), nat(2)),
  Bigint.Events.fromList
);
const SequenceEvents = map(
  array(array(Field, int(1, 5)), nat(2)),
  Bigint.SequenceEvents.fromList
);
const SequenceState = oneOf(Bigint.SequenceState.emptyValue(), Field);
const ZkappUri = map(ascii(nat(50)), Bigint.ZkappUri.fromJSON);

const PrimitiveMap = primitiveTypeMap<bigint>();
type Types = typeof TypeMap & typeof customTypes & typeof PrimitiveMap;
type Provable<T> = GenericProvable<T, bigint>;
type Generators = {
  [K in keyof Types]: Types[K] extends Provable<infer U> ? Random<U> : never;
};
const Generators: Generators = {
  Field,
  Bool,
  UInt32,
  UInt64,
  Sign,
  PublicKey,
  TokenId,
  StateHash,
  AuthorizationKind,
  AuthRequired,
  TokenSymbol,
  Events,
  SequenceEvents,
  SequenceState,
  ZkappUri,
  null: constant(null),
  string: base58(nat(50)), // TODO replace various strings, like signature, with parsed types
  number: nat(3),
};
let typeToGenerator = new Map<Provable<any>, Random<any>>(
  [TypeMap, PrimitiveMap, customTypes]
    .map(Object.entries)
    .flat()
    .map(([key, value]) => [value, Generators[key as keyof Generators]])
);

// transaction stuff
const RandomAccountUpdate = map(
  randomFromLayout<AccountUpdate>(jsLayout.AccountUpdate as any),
  (a) => {
    // TODO we set vk to null since we currently can't generate a valid random one
    a.body.update.verificationKey = {
      isSome: 0n,
      value: { data: '', hash: 0n },
    };
    // TODO remove empty permissions hack
    if (!a.body.update.permissions.isSome) {
      a.body.update.permissions.value = emptyPermissions();
    }
    return a;
  }
);
const RandomFeePayer = randomFromLayout<ZkappCommand['feePayer']>(
  jsLayout.ZkappCommand.entries.feePayer as any
);
// TODO: fails for non ascii strings
const RandomMemo = map(ascii(nat(32)), (s) =>
  Memo.toBase58(Memo.fromString(s))
);
const Signature = record({ r: Field, s: Scalar });

// invalid json inputs can contain invalid stringified numbers, but also non-numeric strings
const toString = <T>(rng: Random<T>) => map(rng, String);
const nonInteger = map(UInt32, fraction(3), (x, frac) => Number(x) + frac);
const nonNumericString = reject(
  string(nat(20)),
  (str: any) => !isNaN(str) && !isNaN(parseFloat(str))
);
const InvalidUint64Json = toString(
  oneOf(UInt64.invalid, nonInteger, nonNumericString)
);
const InvalidUint32Json = toString(
  oneOf(UInt32.invalid, nonInteger, nonNumericString)
);

// some json versions of those types
const json = {
  uint64: { ...toString(UInt64), invalid: InvalidUint64Json },
  uint32: { ...toString(UInt32), invalid: InvalidUint32Json },
  publicKey: map(PublicKey, CurveBigint.PublicKey.toBase58),
  privateKey: map(PrivateKey, CurveBigint.PrivateKey.toBase58),
  keypair: map(keypair, ({ privatekey, publicKey }) => ({
    privateKey: CurveBigint.PrivateKey.toBase58(privatekey),
    publicKey: CurveBigint.PublicKey.toBase58(publicKey),
  })),
  signature: map(Signature, SignatureBigint.Signature.toBase58),
  accountUpdate: map(RandomAccountUpdate, AccountUpdate.toJSON),
};

const Random = Object.assign(Random_, {
  constant,
  int,
  nat,
  fraction,
  boolean,
  bytes,
  string,
  ascii,
  base58,
  array: Object.assign(arrayWithInvalid, { ofSize: arrayOfSize }),
  record: recordWithInvalid,
  map,
  step,
  oneOf,
  withHardCoded,
  dependent,
  dice: Object.assign(dice, {
    ofSize: diceOfSize(),
  }),
  field: Field,
  bool: Bool,
  uint32: UInt32,
  uint64: UInt64,
  privateKey: PrivateKey,
  publicKey: PublicKey,
  scalar: Scalar,
  signature: Signature,
  accountUpdate: RandomAccountUpdate,
  feePayer: RandomFeePayer,
  memo: RandomMemo,
  json,
});

function randomFromLayout<T>(typeData: Layout): Random<T> {
  return {
    create() {
      let typeToNext = new Map<Provable<any>, () => any>();
      for (let [key, random] of typeToGenerator) {
        typeToNext.set(key, random.create());
      }
      return () => nextFromLayout(typeData, typeToNext);
    },
  };
}

function nextFromLayout<T>(
  typeData: Layout,
  typeToNext: Map<Provable<any>, () => any>
): T {
  return genericLayoutFold<undefined, any, TypeMap, Json.TypeMap>(
    TypeMap,
    customTypes,
    {
      map(type, _, name) {
        let next = typeToNext.get(type);
        if (next === undefined)
          throw Error(`could not find generator for type ${name}`);
        return next();
      },
      reduceArray(array) {
        return array;
      },
      reduceObject(_, object) {
        return object;
      },
      reduceFlaggedOption({ isSome, value }, typeData) {
        let isSomeBoolean = TypeMap.Bool.toJSON(isSome);
        if (!isSomeBoolean) return empty(typeData);
        if (typeData.optionType === 'closedInterval') {
          let innerInner = typeData.inner.entries.lower;
          let innerType = TypeMap[innerInner.type as 'UInt32' | 'UInt64'];
          let { lower, upper } = value;
          if (
            BigInt(innerType.toJSON(lower)) > BigInt(innerType.toJSON(upper))
          ) {
            value.upper = lower;
            value.lower = upper;
          }
        }
        return { isSome, value };
      },
      reduceOrUndefined(value) {
        let isSome = this.map(TypeMap.Bool);
        let isSomeBoolean = TypeMap.Bool.toJSON(isSome);
        return isSomeBoolean ? value : undefined;
      },
    },
    typeData,
    undefined
  );
}

function empty(typeData: Layout) {
  let zero = TypeMap.Field.fromJSON('0');
  return genericLayoutFold<undefined, any, TypeMap, Json.TypeMap>(
    TypeMap,
    customTypes,
    {
      map(type) {
        if (type.emptyValue) return type.emptyValue();
        return type.fromFields(
          Array(type.sizeInFields()).fill(zero),
          type.toAuxiliary()
        );
      },
      reduceArray(array) {
        return array;
      },
      reduceObject(_, object) {
        return object;
      },
      reduceFlaggedOption({ isSome, value }, typeData) {
        if (typeData.optionType === 'closedInterval') {
          let innerInner = typeData.inner.entries.lower;
          let innerType = TypeMap[innerInner.type as 'UInt32' | 'UInt64'];
          value.lower = innerType.fromJSON(typeData.rangeMin);
          value.upper = innerType.fromJSON(typeData.rangeMax);
        }
        return { isSome, value };
      },
      reduceOrUndefined() {
        return undefined;
      },
    },
    typeData,
    undefined
  );
}

function constant<T>(t: T) {
  return Random_(() => t);
}

function bytes(size: number | Random<number>): Random<number[]> {
  return array(byte, size);
}

function uniformBytes(size: number | Random<number>): Random<number[]> {
  let size_ = typeof size === 'number' ? constant(size) : size;
  return {
    create() {
      let nextSize = size_.create();
      return () => [...randomBytes(nextSize())];
    },
  };
}
function string(size: number | Random<number>) {
  return map(uniformBytes(size), (b) => String.fromCharCode(...b));
}
function ascii(size: number | Random<number>) {
  return map(uniformBytes(size), (b) =>
    // ASCII
    String.fromCharCode(...b.map((c) => c % 128))
  );
}

function base58(size: number | Random<number>) {
  return map(array(oneOf(...alphabet), size), (a) => a.join(''));
}

function isGenerator<T>(rng: any): rng is Random<T> {
  return typeof rng === 'object' && rng && 'create' in rng;
}

function oneOf<Types extends readonly any[]>(
  ...values: { [K in keyof Types]: Types[K] | Random<Types[K]> }
): Random<Types[number]> {
  let gens = values.map((v) => (isGenerator(v) ? v : constant(v)));
  return {
    create() {
      let nexts = gens.map((rng) => rng.create());
      return () => {
        let i = drawUniformUint(values.length - 1);
        return nexts[i]();
      };
    },
  };
}
function map<T extends readonly any[], S>(
  ...args: [...rngs: { [K in keyof T]: Random<T[K]> }, to: (...values: T) => S]
): Random<S> {
  const to = args.pop()! as (...values: T) => S;
  let rngs = args as { [K in keyof T]: Random<T[K]> };
  return {
    create() {
      let nexts = rngs.map((rng) => rng.create());
      return () => to(...(nexts.map((next) => next()) as any as T));
    },
  };
}
function dependent<T extends readonly any[], Result, Free>(
  ...args: [
    ...rngs: { [K in keyof T]: Random<T[K]> },
    to: (free: Free, values: T) => Result
  ]
): Random<(arg: Free) => Result> & ((arg: Random<Free>) => Random<Result>) {
  const to = args.pop()! as (free: Free, values: T) => Result;
  let rngs = args as { [K in keyof T]: Random<T[K]> };
  let rng: Random<(arg: Free) => Result> = {
    create() {
      let nexts = rngs.map((rng) => rng.create());
      return () => (free) => to(free, nexts.map((next) => next()) as any);
    },
  };
  return Object.assign(function (free: Random<Free>): Random<Result> {
    return {
      create() {
        let freeNext = free.create();
        let nexts = rngs.map((rng) => rng.create());
        return () => to(freeNext(), nexts.map((next) => next()) as any);
      },
    };
  }, rng);
}

function step<T extends readonly any[], S>(
  ...args: [
    ...rngs: { [K in keyof T]: Random<T[K]> },
    step: (current: S, ...values: T) => S,
    initial: S
  ]
): Random<S> {
  let initial = args.pop()! as S;
  const step = args.pop()! as (current: S, ...values: T) => S;
  let rngs = args as { [K in keyof T]: Random<T[K]> };
  return {
    create() {
      let nexts = rngs.map((rng) => rng.create());
      let next = initial;
      let current = initial;
      return () => {
        current = next;
        next = step(current, ...(nexts.map((next) => next()) as any as T));
        return current;
      };
    },
  };
}

function array<T>(
  element: Random<T>,
  size: number | Random<number>,
  { reset = false } = {}
): Random<T[]> {
  let size_ = typeof size === 'number' ? constant(size) : size;
  return {
    create() {
      let nextSize = size_.create();
      let nextElement = element.create();
      return () => {
        let nextElement_ = reset ? element.create() : nextElement;
        return Array.from({ length: nextSize() }, nextElement_);
      };
    },
  };
}
function arrayOfSize<T>(
  element: Random<T>,
  { reset = false } = {}
): Random<(n: number) => T[]> {
  return {
    create() {
      let nextElement = element.create();
      return () => (length: number) => {
        let nextElement_ = reset ? element.create() : nextElement;
        return Array.from({ length }, nextElement_);
      };
    },
  };
}

function record<T extends {}>(gens: {
  [K in keyof T]: Random<T[K]>;
}): Random<T> {
  return {
    create() {
      let keys = Object.keys(gens);
      let nexts = keys.map((key) => gens[key as keyof T].create());
      return () =>
        Object.fromEntries(keys.map((key, i) => [key, nexts[i]()])) as T;
    },
  };
}

function tuple<T extends readonly any[]>(
  gens: {
    [i in keyof T & number]: Random<T[i]>;
  } & Random<any>[]
): Random<T> {
  return {
    create() {
      let nexts = gens.map((gen) => gen.create());
      return () => nexts.map((next) => next()) as any;
    },
  };
}

function reject<T>(rng: Random<T>, isRejected: (t: T) => boolean): Random<T> {
  return {
    create() {
      let next = rng.create();
      return () => {
        while (true) {
          let t = next();
          if (!isRejected(t)) return t;
        }
      };
    },
  };
}

function withHardCoded<T>(rng: Random<T>, ...hardCoded: T[]): Random<T> {
  return {
    create() {
      let next = rng.create();
      let i = 0;
      return () => {
        if (i < hardCoded.length) return hardCoded[i++];
        return next();
      };
    },
  };
}

/**
 * uniform distribution over range [min, max]
 * with bias towards special values 0, 1, -1, 2, min, max
 */
function int(min: number, max: number): Random<number> {
  if (max < min) throw Error('max < min');
  // set of special numbers that will appear more often in tests
  let specialSet = new Set<number>();
  if (-1 >= min && -1 <= max) specialSet.add(-1);
  if (1 >= min && 1 <= max) specialSet.add(1);
  if (2 >= min && 2 <= max) specialSet.add(2);
  specialSet.add(min);
  specialSet.add(max);
  let special = [...specialSet];
  if (0 >= min && 0 <= max) special.unshift(0, 0);
  let nSpecial = special.length;
  return {
    create: () => () => {
      // 25% of test cases are special numbers
      if (drawOneOf8() < 3) {
        let i = drawUniformUint(nSpecial);
        return special[i];
      }
      // the remaining follow a uniform distribution
      return min + drawUniformUint(max - min);
    },
  };
}

/**
 * log-uniform distribution over range [0, max]
 * with bias towards 0, 1, 2
 */
function nat(max: number): Random<number> {
  if (max < 0) throw Error('max < 0');
  if (max === 0) return constant(0);
  let bits = max.toString(2).length;
  let bitBits = bits.toString(2).length;
  // set of special numbers that will appear more often in tests
  let special = [0, 0, 1];
  if (max > 1) special.push(2);
  let nSpecial = special.length - 1;
  return {
    create: () => () => {
      // 25% of test cases are special numbers
      if (drawOneOf8() < 3) {
        let i = drawUniformUint(nSpecial);
        return special[i];
      }
      // the remaining follow a log-uniform / cut off exponential distribution:
      // we sample a bit length (within a target range) and then a number with that length
      while (true) {
        // draw bit length from [1, 2**bitBits); reject if > bit length of max
        let bitLength = 1 + drawUniformUintBits(bitBits);
        if (bitLength > bits) continue;
        // draw number from [0, 2**bitLength); reject if > max
        let n = drawUniformUintBits(bitLength);
        if (n <= max) return n;
      }
    },
  };
}

function fraction(fixedPrecision = 3) {
  let denom = 10 ** fixedPrecision;
  if (fixedPrecision < 1) throw Error('precision must be > 1');
  let next = () => (drawUniformUint(denom - 2) + 1) / denom;
  return { create: () => next };
}

/**
 * unbiased, uniform distribution over range [0, max-1]
 */
function dice(max: number): Random<number> {
  if (max < 1) throw Error('max as to be > 0');
  return {
    create: () => () => drawUniformUint(max - 1),
  };
}
function diceOfSize(): Random<(size: number) => number> {
  return {
    create: () => () => (max: number) => {
      if (max < 1) throw Error('max as to be > 0');
      return drawUniformUint(max - 1);
    },
  };
}

let specialBytes = [0, 0, 0, 1, 1, 2, 255, 255];
/**
 * log-uniform distribution over range [0, 255]
 * with bias towards 0, 1, 2, 255
 */
const byte: Random<number> = {
  create: () => () => {
    // 25% of test cases are special numbers
    if (drawOneOf8() < 2) return specialBytes[drawOneOf8()];
    // the remaining follow log-uniform / cut off exponential distribution:
    // we sample a bit length from [1, 8] and then a number with that length
    let bitLength = 1 + drawOneOf8();
    return drawUniformUintBits(bitLength);
  },
};
/**
 * log-uniform distribution over 2^n-bit range
 * with bias towards 0, 1, 2, max
 * outputs are bigints
 */
function biguint(bits: number): Random<bigint> {
  let max = (1n << BigInt(bits)) - 1n;
  let special = [0n, 0n, 0n, 1n, 1n, 2n, max, max];
  let bitsBits = Math.log2(bits);
  if (!Number.isInteger(bitsBits)) throw Error('bits must be a power of 2');
  return {
    create: () => () => {
      // 25% of test cases are special numbers
      if (drawOneOf8() < 2) return special[drawOneOf8()];
      // the remaining follow log-uniform / cut off exponential distribution:
      // we sample a bit length from [1, 8] and then a number with that length
      let bitLength = 1 + drawUniformUintBits(bitsBits);
      return drawUniformBigUintBits(bitLength);
    },
  };
}

/**
 * uniform positive integer in [0, max] drawn from secure randomness,
 */
function drawUniformUint(max: number) {
  if (max === 0) return 0;
  let bitLength = Math.floor(Math.log2(max)) + 1;
  while (true) {
    // values with same bit length can be too large by a factor of at most 2; those are rejected
    let n = drawUniformUintBits(bitLength);
    if (n <= max) return n;
  }
}

/**
 * uniform positive integer drawn from secure randomness,
 * given a target bit length
 */
function drawUniformUintBits(bitLength: number) {
  let byteLength = Math.ceil(bitLength / 8);
  // draw random bytes, zero the excess bits
  let bytes = randomBytes(byteLength);
  if (bitLength % 8 !== 0) {
    bytes[byteLength - 1] &= (1 << bitLength % 8) - 1;
  }
  // accumulate bytes to integer
  let n = 0;
  let bitPosition = 0;
  for (let byte of bytes) {
    n += byte << bitPosition;
    bitPosition += 8;
  }
  return n;
}

/**
 * uniform positive bigint drawn from secure randomness,
 * given a target bit length
 */
function drawUniformBigUintBits(bitLength: number) {
  let byteLength = Math.ceil(bitLength / 8);
  // draw random bytes, zero the excess bits
  let bytes = randomBytes(byteLength);
  if (bitLength % 8 !== 0) {
    bytes[byteLength - 1] &= (1 << bitLength % 8) - 1;
  }
  return bytesToBigInt(bytes);
}

/**
 * draw number between 0,..,7 using secure randomness
 */
function drawOneOf8() {
  return randomBytes(1)[0] >> 5;
}

// generators for invalid samples
// note: these only cover invalid samples with a _valid type_.
// for example, numbers that are out of range or base58 strings with invalid characters.
// what we don't cover is something like

// convention is for invalid generators sit next to valid ones
// so you can use uint64.invalid, array(uint64).invalid, etc

function withInvalid<T>(
  valid: Random<T>,
  toInvalid: (valid: Random<T>) => Random<T>
): Random<T> {
  let invalid = toInvalid(valid);
  return { ...valid, invalid };
}

/**
 * we get invalid uints by sampling from a larger range plus negative numbers, and reject if it's still valid
 */
function biguintWithInvalid(bits: number) {
  let valid = biguint(bits);
  let max = 1n << BigInt(bits);
  let double = biguint(2 * bits);
  let negative = map(double, (uint) => -uint - 1n);
  let tooLarge = map(valid, (uint) => uint + max);
  let invalid = oneOf(negative, tooLarge);
  return Object.assign(valid, { invalid });
}

function fieldWithInvalid(
  F: typeof Bigint.Field | typeof CurveBigint.Scalar
): Random<bigint> {
  let randomField = Random_(F.random);
  let specialField = oneOf(0n, 1n, F(-1));
  let validField = oneOf<bigint[]>(
    randomField,
    randomField,
    UInt64,
    specialField
  );
  let tooLarge = map(validField, (x) => x + Bigint.Field.modulus);
  let negative = map(validField, (x) => -x - 1n);
  let invalid = oneOf(tooLarge, negative);
  return withInvalid(validField, () => invalid);
}

/**
 * invalid arrays are sampled by generating an array with exactly one invalid input (and any number of valid inputs);
 * (note: invalid arrays have the same length distribution as valid ones, except that they are never empty)
 */
function arrayWithInvalid<T>(
  element: Random<T>,
  size: number | Random<number>,
  options?: { reset?: boolean }
): Random<T[]> {
  let valid = array(element, size, options);
  if (element.invalid === undefined) return valid;
  let invalid = map(valid, element.invalid, (arr, invalid) => {
    if (arr.length === 0) return [invalid];
    let i = drawUniformUint(arr.length - 1);
    arr[i] = invalid;
    return arr;
  });
  return { ...valid, invalid };
}
/**
 * invalid records are similar to arrays: randomly choose one of the fields that have an invalid generator,
 * and set it to its invalid value
 */
function recordWithInvalid<T extends {}>(gens: {
  [K in keyof T]: Random<T[K]>;
}): Random<T> {
  let valid = record(gens);
  let invalidFields: [string & keyof T, Random<any>][] = [];
  for (let key in gens) {
    let invalid = gens[key].invalid;
    if (invalid !== undefined) {
      invalidFields.push([key, invalid]);
    }
  }
  let nInvalid = invalidFields.length;
  if (nInvalid === 0) return valid;
  let invalid = {
    create() {
      let next = valid.create();
      let invalidNexts = invalidFields.map(
        ([key, rng]) => [key, rng.create()] as const
      );
      return () => {
        let value = next();
        let i = drawUniformUint(nInvalid - 1);
        let [key, invalidNext] = invalidNexts[i];
        value[key] = invalidNext();
        return value;
      };
    },
  };
  return { ...valid, invalid };
}
/**
 * invalid tuples are like invalid records
 */
function tupleWithInvalid<T extends readonly any[]>(
  gens: {
    [K in keyof T & number]: Random<T[K]>;
  } & Random<any>[]
): Random<T> {
  let valid = tuple<T>(gens);
  let invalidFields: [number & keyof T, Random<any>][] = [];
  gens.forEach((gen, i) => {
    let invalid = gen.invalid;
    if (invalid !== undefined) {
      invalidFields.push([i, invalid]);
    }
  });
  let nInvalid = invalidFields.length;
  if (nInvalid === 0) return valid;
  let invalid = {
    create() {
      let next = valid.create();
      let invalidNexts = invalidFields.map(
        ([key, rng]) => [key, rng.create()] as const
      );
      return () => {
        let value = next();
        let i = drawUniformUint(nInvalid - 1);
        let [key, invalidNext] = invalidNexts[i];
        value[key] = invalidNext();
        return value;
      };
    },
  };
  return { ...valid, invalid };
}
/**
 * map assuming that invalid inputs can be mapped just like valid ones
 * _one_ of the inputs is sampled as invalid
 */
function mapWithInvalid<T extends readonly any[], S>(
  ...args: [...rngs: { [K in keyof T]: Random<T[K]> }, to: (...values: T) => S]
): Random<S> {
  let valid = map(...args);
  const to = args.pop()! as (...values: T) => S;
  let rngs = args as { [K in keyof T]: Random<T[K]> } & Random<any>[];
  let invalidInput = tupleWithInvalid<T>(rngs).invalid;
  if (invalidInput === undefined) return valid;
  let invalid = {
    create() {
      let nextInput = invalidInput!.create();
      return () => to(...nextInput());
    },
  };
  return { ...valid, invalid };
}
