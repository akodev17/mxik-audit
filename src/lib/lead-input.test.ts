import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { LEAD_LIMITS, parseContact } from './lead-guard.js';
import { leadFilenameOk, parseLeadText } from './lead-input.js';

const form = (fields: Record<string, string>): FormData => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};

describe('lead form bounds', () => {
  it('keeps company and note up to their limits, trimmed', () => {
    const company = 'c'.repeat(LEAD_LIMITS.company);
    const note = 'n'.repeat(LEAD_LIMITS.note);
    assert.deepEqual(parseLeadText(form({ company: `  ${company}  `, note })), { company, note });
  });

  it('treats missing or blank text as not given', () => {
    assert.deepEqual(parseLeadText(form({})), { company: null, note: null });
    assert.deepEqual(parseLeadText(form({ company: '   ', note: '\n' })), { company: null, note: null });
  });

  it('refuses a company or note one character over the limit', () => {
    assert.equal(parseLeadText(form({ company: 'c'.repeat(LEAD_LIMITS.company + 1) })), null);
    assert.equal(parseLeadText(form({ note: 'n'.repeat(LEAD_LIMITS.note + 1) })), null);
  });

  it('bounds the file name', () => {
    const at = (n: number): string => `${'f'.repeat(n - 5)}.xlsx`;
    assert.equal(leadFilenameOk(at(LEAD_LIMITS.filename)), true);
    assert.equal(leadFilenameOk(at(LEAD_LIMITS.filename + 1)), false);
    assert.equal(leadFilenameOk(''), false);
  });

  it('refuses a contact longer than the form field allows', () => {
    assert.equal(parseContact(`@${'a'.repeat(LEAD_LIMITS.contact)}`).ok, false);
  });
});
