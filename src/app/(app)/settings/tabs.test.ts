import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { chooseTab, SETTINGS_TABS, tabHref, visibleTabs } from './tabs';

describe('settings tabs', () => {
  it('admins see every tab', () => {
    assert.deepEqual(visibleTabs('admin', false), [...SETTINGS_TABS]);
  });

  it('accountants and viewers see their account, security and the plan only', () => {
    assert.deepEqual(visibleTabs('accountant', false), ['account', 'security', 'plan']);
    assert.deepEqual(visibleTabs('viewer', false), ['account', 'security', 'plan']);
  });

  it('a demo shows account and plan, even to its admin', () => {
    assert.deepEqual(visibleTabs('admin', true), ['account', 'plan']);
  });

  it('opens the tab in the URL when it is visible', () => {
    assert.deepEqual(chooseTab({ tab: 'data' }, visibleTabs('admin', false)), { tab: 'data', refused: null });
  });

  it('a tab the role may not open falls back to the first and is named', () => {
    assert.deepEqual(chooseTab({ tab: 'integrations' }, visibleTabs('viewer', false)), { tab: 'account', refused: 'integrations' });
    assert.deepEqual(chooseTab({ tab: 'data' }, visibleTabs('accountant', false)), { tab: 'account', refused: 'data' });
  });

  it('unknown or missing tabs open the first tab without a notice', () => {
    assert.deepEqual(chooseTab({ tab: 'billing' }, visibleTabs('admin', false)), { tab: 'account', refused: null });
    assert.deepEqual(chooseTab({}, visibleTabs('viewer', false)), { tab: 'account', refused: null });
    assert.deepEqual(chooseTab({ tab: ['plan', 'data'] }, visibleTabs('admin', false)), { tab: 'account', refused: null });
  });

  it('the Telegram sign-in callback (?tg=) lands on security', () => {
    assert.deepEqual(chooseTab({ tg: 'bound' }, visibleTabs('viewer', false)), { tab: 'security', refused: null });
  });

  it('team is no longer a settings tab', () => {
    assert.ok(!(SETTINGS_TABS as readonly string[]).includes('team'));
    assert.deepEqual(chooseTab({ tab: 'team' }, visibleTabs('admin', false)), { tab: 'account', refused: null });
  });

  it('account is the bare /settings URL', () => {
    assert.equal(tabHref('account'), '/settings');
    assert.equal(tabHref('plan'), '/settings?tab=plan');
  });
});
