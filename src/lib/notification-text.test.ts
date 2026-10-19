import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { updateBody, updateTitle } from './notification-text.js';

const counts = { archived: 2, unitChanged: 1, nameChanged: 0, newFindings: 3 };

describe('classifier update notification text', () => {
  it('dates the update in Tashkent time, the same in both languages', () => {
    // 20:30 UTC on the 19th is already the 20th in Tashkent (UTC+5).
    const late = new Date('2026-10-19T20:30:00Z');
    assert.match(updateBody(counts, 'a.xlsx', late, 'uz'), /\(20\.10\.2026\)/);
    assert.match(updateBody(counts, 'a.xlsx', late, 'ru'), /\(20\.10\.2026\)/);
  });

  it('renders the title and body wholly in the requested language', () => {
    const at = new Date('2026-10-19T08:00:00Z');
    assert.equal(updateTitle('Alfa', counts, 'ru'), 'Клиент Alfa: архивировано кодов: 2, изменилась единица измерения у кодов: 1');
    assert.doesNotMatch(updateBody(counts, 'a.xlsx', at, 'ru'), /Tasniflagich|Fayl|Mijoz/);
    assert.equal(updateBody({ ...counts, newFindings: 0 }, 'a.xlsx', at, 'uz'), 'Tasniflagich yangilandi (19.10.2026). Yangi muammo topilmadi. Fayl: a.xlsx.');
  });
});
