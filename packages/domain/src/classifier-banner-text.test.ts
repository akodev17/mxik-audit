import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { appDict } from '@tasnivo/i18n/i18n-app';

describe('classifier banner text', () => {
  it('names the age and the date in Uzbek and Russian', () => {
    const uz = appDict('uz').wsX.classifierBanner;
    const ru = appDict('ru').wsX.classifierBanner;
    assert.match(uz.stale(61, '20.08.2026'), /20\.08\.2026.*61 kun/);
    assert.match(ru.stale(61, '20.08.2026'), /20\.08\.2026.*61 день/);
    assert.match(ru.stale(8, '14.10.2026'), /8 дней/);
    assert.match(ru.stale(23, '30.09.2026'), /23 дня/);
    assert.match(uz.failed('21.10.2026'), /21\.10\.2026/);
    assert.match(ru.failed('21.10.2026'), /21\.10\.2026/);
  });
});
