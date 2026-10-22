import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { activeOwnedClient, ownedClient } from './clients.js';
import { db } from '@tasnivo/db';
import { makeClient } from './firm-test-fixtures.js';
import { dbSkipReason, dropOrgs, makeOrg, type TestActor } from './test-fixtures.js';

const skip = await dbSkipReason();

describe('activeOwnedClient: where the Telegram bot may import (database)', { skip }, () => {
  let a: TestActor;
  let b: TestActor;

  before(async () => {
    a = await makeOrg();
    b = await makeOrg();
  });
  after(async () => {
    await dropOrgs([a.orgId, b.orgId]);
    await db.$disconnect();
  });

  it('returns the org\'s active client, never an archived or another org\'s one', async () => {
    const active = await makeClient(a.orgId, 'bot-active');
    const archived = await makeClient(a.orgId, 'bot-archived', { archived: true });
    const foreign = await makeClient(b.orgId, 'bot-foreign');
    assert.equal((await activeOwnedClient(a.orgId, active))?.id, active);
    assert.equal(await activeOwnedClient(a.orgId, archived), null);
    assert.equal(await activeOwnedClient(a.orgId, foreign), null);
    // ownedClient still finds the archived one (reads), activeOwnedClient does not (writes).
    assert.equal((await ownedClient(a.orgId, archived))?.id, archived);
  });
});
