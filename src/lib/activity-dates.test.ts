import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { dayInputValue, parseDayInput } from './activity-dates.js';

describe('activity date filter input', () => {
  it('reads dd.mm.yyyy, the format shown everywhere else', () => {
    assert.equal(parseDayInput('19.10.2026'), '2026-10-19');
    assert.equal(parseDayInput(' 1.2.2026 '), '2026-02-01');
    assert.equal(parseDayInput('19/10/2026'), '2026-10-19');
    assert.equal(parseDayInput('19102026'), '2026-10-19');
  });

  it('still reads yyyy-mm-dd from older links', () => {
    assert.equal(parseDayInput('2026-10-01'), '2026-10-01');
  });

  it('tells an empty field from an unreadable one', () => {
    assert.equal(parseDayInput(''), '');
    assert.equal(parseDayInput(undefined), '');
    assert.equal(parseDayInput('31.02.2026'), null);
    assert.equal(parseDayInput('2026-13-40'), null);
    assert.equal(parseDayInput('10/19/2026'), null);
    assert.equal(parseDayInput('kecha'), null);
  });

  it('formats a day back for the field', () => {
    assert.equal(dayInputValue('2026-10-01'), '01.10.2026');
    assert.equal(dayInputValue(''), '');
  });
});
