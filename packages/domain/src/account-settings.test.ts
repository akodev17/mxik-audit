import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { imageMime, LOGO_MAX_BYTES } from './account-settings.js';

describe('imageMime', () => {
  it('tells PNG and JPEG by their first bytes, whatever the name says', () => {
    assert.equal(imageMime(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])), 'image/png');
    assert.equal(imageMime(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), 'image/jpeg');
    assert.equal(imageMime(new Uint8Array([0x89, 0x50, 0x4e, 0x47])), null, 'a truncated PNG signature');
    assert.equal(imageMime(new TextEncoder().encode('GIF89a')), null);
    assert.equal(imageMime(new Uint8Array()), null);
  });

  it('the logo cap is 300 KB, as the settings action had it', () => {
    assert.equal(LOGO_MAX_BYTES, 300 * 1024);
  });
});
