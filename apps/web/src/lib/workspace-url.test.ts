import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as domainSource from '@tasnivo/domain/decision-source';
import * as domainView from '@tasnivo/domain/view-params';
import * as domainFilter from '@tasnivo/domain/workspace-filter';
import { appDict } from '@tasnivo/i18n/i18n-app';
import {
  apiFilter, DECISION_FILTERS, DECISION_SOURCES, decisionSourceLabel, FINDING_TYPES, filterKey, filterQuery, FLAG_FILTERS, isAutomatic,
  OPTIONAL_COLUMNS, readDecisionSource, readFilter, readHidden, viewQuery, type FilterParams, type ViewParams,
} from './workspace-url.js';

// URL values worth trying for each filter field: valid ones, junk, empty and missing.
const VALUES: Record<keyof FilterParams, (string | null | undefined)[]> = {
  type: [undefined, null, '', 'MARKING', 'MISMATCH', 'RESTRICTED', 'mismatch', 'x'],
  q: [undefined, '', '  sut  ', 'a'.repeat(140), 'Молоко 1 л'],
  pending: [undefined, '0', '1'],
  dec: [undefined, '', 'pending', 'all', 'accepted', 'rejected', 'carried', 'auto', 'nope'],
  flag: [undefined, 'any', 'ask_client', 'resolved', 'none', 'x'],
  comments: [undefined, '1', '0'],
  sort: [undefined, 'row', 'risk', 'x'],
  source: [undefined, '', 'manual', 'bulk_sure', 'carry_over', 'x'],
};

/** A spread of combinations: every value of each field against a rotating background of the others. */
function samples(): FilterParams[] {
  const keys = Object.keys(VALUES) as (keyof FilterParams)[];
  const out: FilterParams[] = [{}];
  for (let shift = 0; shift < 9; shift++) {
    for (const key of keys) {
      for (const value of VALUES[key]) {
        const p: FilterParams = {};
        keys.forEach((k, i) => { const list = VALUES[k]; p[k] = list[(i + shift) % list.length]; });
        p[key] = value;
        out.push(p);
      }
    }
  }
  return out;
}

describe('workspace URL helpers (web copies of the domain)', () => {
  it('share the domain\'s lists', () => {
    assert.deepEqual([...FINDING_TYPES], [...domainFilter.FINDING_TYPES]);
    assert.deepEqual([...DECISION_FILTERS], [...domainFilter.DECISION_FILTERS]);
    assert.deepEqual([...FLAG_FILTERS], [...domainFilter.FLAG_FILTERS]);
    assert.deepEqual([...OPTIONAL_COLUMNS], [...domainView.OPTIONAL_COLUMNS]);
    assert.deepEqual([...DECISION_SOURCES], [...domainSource.DECISION_SOURCES]);
  });

  it('read, write and key a filter exactly as the domain does', () => {
    for (const p of samples()) {
      const f = readFilter(p);
      assert.deepEqual(f, domainFilter.readFilter(p), JSON.stringify(p));
      assert.deepEqual(filterQuery(f), domainFilter.filterQuery(domainFilter.readFilter(p)));
      assert.equal(filterKey(f), domainFilter.filterKey(domainFilter.readFilter(p)));
    }
  });

  it('send the API a filter it reads back unchanged', () => {
    for (const p of samples()) {
      const f = readFilter(p);
      assert.deepEqual(domainFilter.readFilter(apiFilter(f)), f, JSON.stringify(p));
    }
  });

  it('read hidden columns and write view links as the domain does', () => {
    for (const raw of [undefined, null, '', 'status', 'match,status,bogus', 'current,suggested,match,status']) {
      assert.deepEqual(readHidden(raw), domainView.readHidden(raw));
    }
    const views: ViewParams[] = [
      { type: null, q: '', pending: true, comments: false, sort: 'risk', density: 'comfortable', grouped: false },
      { type: 'MISMATCH', q: 'sut', pending: false, comments: true, sort: 'row', density: 'compact', grouped: true, decision: 'auto', flag: 'resolved', hidden: ['status', 'match'], source: 'bulk' },
      { type: 'MARKING', q: '', pending: true, comments: false, sort: 'risk', density: 'comfortable', grouped: false, decision: 'pending', flag: 'any', hidden: [] },
    ];
    for (const v of views) assert.equal(viewQuery(v), domainView.viewQuery(v));
  });

  it('read decision sources as the domain does', () => {
    for (const v of [undefined, null, 1, '', 'manual', 'dictionary_auto', 'carry_over', 'bogus']) {
      const mine = readDecisionSource(v);
      assert.equal(mine, domainSource.readDecisionSource(v));
      assert.equal(isAutomatic(mine), domainSource.isAutomatic(mine));
      if (mine) assert.equal(decisionSourceLabel(mine, appDict('ru')), domainSource.decisionSourceLabel(mine, appDict('ru')));
    }
  });
});
