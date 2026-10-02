import test from 'node:test';
import assert from 'node:assert/strict';
import { createRandom, validateSeed } from '../src/random.mjs';

test('LCG unsigned output matches fixed independently calculated vectors', () => {
  const vectors = [
    [0, [1013904223, 1196435762, 3519870697, 2868466484, 1649599747, 2670642822]],
    [1, [1015568748, 1586005467, 2165703038, 3027450565, 217083232, 1587069247]],
    [0xffff_ffff, [1012239698, 806866057, 579071060, 2709482403, 3082116262, 3754216397]],
  ];
  for (const [seed, expected] of vectors) {
    const random = createRandom(seed);
    assert.deepEqual(expected.map(() => random.nextUint32()), expected);
  }
});

test('random streams are repeatable and isolated from other instances', () => {
  const first = createRandom(42);
  const second = createRandom(42);
  const other = createRandom(43);
  assert.ok(Object.isFrozen(first));
  for (let index = 0; index < 100; index += 1) {
    other.nextUint32();
    assert.equal(first.nextUint32(), second.nextUint32());
  }
  assert.notEqual(createRandom(42).nextUint32(), createRandom(43).nextUint32());
});

test('seed validation rejects implicit conversion, fractions and overflow', () => {
  for (const seed of [undefined, null, '1', true, -1, 1.5, 2 ** 32, NaN, Infinity, {}, 1n]) {
    assert.throws(() => createRandom(seed), /Seed/);
  }
  assert.equal(Object.is(validateSeed(-0), 0), true);
});

test('integer sampling uses inclusive high-bit buckets and the entire uint32 range', () => {
  const random = createRandom(1);
  assert.deepEqual([random.integer(2, 6), random.integer(2, 6), random.integer(2, 6)], [3, 3, 4]);
  assert.equal(createRandom(1).integer(0, 0xffff_ffff), 1015568748);
  const singleton = createRandom(1);
  assert.equal(singleton.integer(7, 7), 7);
  assert.equal(singleton.nextUint32(), 1586005467, 'singleton consumes a word');
});

test('integer sampling rejects the uneven tail and advances deterministically', () => {
  const random = createRandom(1);
  assert.deepEqual([
    random.integer(0, 0x8000_0000),
    random.integer(0, 0x8000_0000),
    random.integer(0, 0x8000_0000),
  ], [1015568748, 1586005467, 217083232]);
  assert.equal(random.nextUint32(), 1587069247);
});

test('invalid random ranges fail without consuming state', () => {
  const random = createRandom(1);
  for (const [min, max] of [[-1, 3], [3, 2], [0, 2 ** 32], [0.5, 1], [0, Infinity], ['0', 1], [0, null]]) {
    assert.throws(() => random.integer(min, max), /bounds/);
  }
  assert.equal(random.nextUint32(), 1015568748);
});

test('LCG matches a BigInt reference across overflow and seed boundaries', () => {
  for (const seed of [0, 1, 0x7fff_ffff, 0x8000_0000, 0xffff_ffff]) {
    const random = createRandom(seed);
    let state = BigInt(seed);
    for (let index = 0; index < 1_000; index += 1) {
      state = (1664525n * state + 1013904223n) % (2n ** 32n);
      assert.equal(random.nextUint32(), Number(state));
    }
  }
});
