import { describe, expect, it } from 'vitest';
import { buildRequestFingerprint, sha256, stableStringify } from './utils.mjs';

describe('stable request fingerprints', () => {
  it('preserves recursively nested own __proto__ keys in canonical JSON', () => {
    const dangerous = JSON.parse(
      '{"outer":{"__proto__":{"z":1,"nested":{"__proto__":"kept"}}}}',
    );

    expect(Object.hasOwn(dangerous.outer, '__proto__')).toBe(true);
    expect(Object.hasOwn(dangerous.outer.__proto__.nested, '__proto__')).toBe(true);
    expect(stableStringify(dangerous)).toBe(
      '{"outer":{"__proto__":{"nested":{"__proto__":"kept"},"z":1}}}',
    );
  });

  it('distinguishes a nested own __proto__ body from an empty object', () => {
    const dangerous = JSON.parse('{"outer":{"__proto__":{"marker":"different"}}}');
    const empty = { outer: {} };

    expect(buildRequestFingerprint({ method: 'POST', path: '/drafts', body: dangerous }))
      .not.toBe(buildRequestFingerprint({ method: 'POST', path: '/drafts', body: empty }));
  });

  it('hashes Buffer and Uint8Array inputs as raw bytes', () => {
    const ff = Buffer.from([0xff]);
    const fe = Buffer.from([0xfe]);

    expect(sha256(ff)).not.toBe(sha256(fe));
    expect(sha256(new Uint8Array(ff))).toBe(sha256(ff));
  });
});
