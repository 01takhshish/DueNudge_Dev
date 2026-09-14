import { describe, expect, it } from 'vitest';
import { hashPassword, randomToken, sha256, verifyPassword } from '../../src/lib/crypto.js';

describe('crypto', () => {
  it('hashes and verifies passwords; rejects wrong ones and malformed hashes', async () => {
    const h = await hashPassword('correct horse battery');
    expect(h.startsWith('scrypt$')).toBe(true);
    expect(await verifyPassword('correct horse battery', h)).toBe(true);
    expect(await verifyPassword('wrong', h)).toBe(false);
    expect(await verifyPassword('x', 'garbage')).toBe(false);
  });
  it('produces unique url-safe tokens and stable hashes', () => {
    const a = randomToken();
    expect(a).not.toBe(randomToken());
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(sha256('a')).toBe(sha256('a'));
  });
});
