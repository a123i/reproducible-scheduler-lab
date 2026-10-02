const UINT32_RANGE = 0x1_0000_0000;
const UINT32_MAX = UINT32_RANGE - 1;

export function validateSeed(seed) {
  if (!Number.isInteger(seed) || seed < 0 || seed > UINT32_MAX) {
    throw new TypeError('Seed must be an unsigned 32-bit integer.');
  }
  return seed === 0 ? 0 : seed;
}

/** A versioned, local-state LCG for repeatable fixtures, never cryptography. */
export function createRandom(seed) {
  let state = validateSeed(seed);
  const nextUint32 = () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state;
  };

  // Equal-width buckets with rejection avoid modulo bias and use high bits.
  // Even a singleton range consumes a draw; this is part of the v1 protocol.
  const integer = (min, max) => {
    if (!Number.isInteger(min) || !Number.isInteger(max)
      || min < 0 || max > UINT32_MAX || min > max) {
      throw new TypeError('Random integer bounds must be ordered unsigned 32-bit integers.');
    }
    const width = max - min + 1;
    const bucketSize = Math.floor(UINT32_RANGE / width);
    const limit = bucketSize * width;
    let word;
    do {
      word = nextUint32();
    } while (word >= limit);
    return min + Math.floor(word / bucketSize);
  };

  return Object.freeze({ nextUint32, integer });
}
