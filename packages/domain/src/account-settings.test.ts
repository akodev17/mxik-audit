import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MINUTES_PER_DECISION as CONTRACT_BOUNDS } from '@tasnivo/contracts/modules/account';
import { accountSettings, imageMime, LOGO_MAX_BYTES, MINUTES_PER_DECISION, setMinutesPerDecision } from './account-settings.js';
import { dbSkipReason, dropOrgs, makeOrg } from './test-fixtures.js';

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

const skip = await dbSkipReason();

describe('minutes per decision (database)', { skip }, () => {
  it('keeps whole minutes from 1 to 60 and refuses anything else without writing', async () => {
    assert.deepEqual(MINUTES_PER_DECISION, CONTRACT_BOUNDS, 'the contract checks the same bounds');
    const org = await makeOrg();
    try {
      const read = async () => (await accountSettings(org.orgId)).minutesPerDecision;
      assert.equal(await read(), 3, 'the default');
      for (const bad of [0, 61, 2.5, -1, '5', null, Number.NaN]) assert.equal(await setMinutesPerDecision(org, bad), false, String(bad));
      assert.equal(await read(), 3);
      assert.equal(await setMinutesPerDecision(org, 1), true);
      assert.equal(await setMinutesPerDecision(org, 60), true);
      assert.equal(await read(), 60);
    } finally {
      await dropOrgs([org.orgId]);
    }
  });
});
