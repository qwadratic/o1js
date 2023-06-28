import { test, Random } from './testing/property.js';
import { UInt8 } from './int.js';

// Test constructor
test(Random.uint8, Random.json.uint8, (x, y, assert) => {
  let z = new UInt8(x);
  assert(z instanceof UInt8);
  assert(z.toBigInt() === x);
  assert(z.toString() === x.toString());
  assert(z.isConstant());

  assert((z = new UInt8(x)) instanceof UInt8 && z.toBigInt() === x);
  assert((z = new UInt8(z)) instanceof UInt8 && z.toBigInt() === x);
  assert((z = new UInt8(z.value)) instanceof UInt8 && z.toBigInt() === x);

  z = new UInt8(y);
  assert(z instanceof UInt8);
  assert(z.toString() === y);
  assert(z.toJSON() === y);
});
