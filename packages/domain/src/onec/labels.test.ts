// Every machine code the 1C layer can show a person has words in both languages: the generic issue
// codes (accounting.ONEC_ISSUE_CODES), the reasons a record is left out or refused, the domain's
// refusals and the formats.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { accounting } from '@tasnivo/contracts';
import * as shared from '@tasnivo/i18n/i18n-parts/accounting';
import * as onec from '@tasnivo/i18n/i18n-parts/onec';

const REASONS = ['unresolved', 'not_approved', 'skipped', 'invalid', 'duplicate_row', 'duplicate_export', 'onec_refused', 'auth_failed', 'timeout', 'unreachable'];
const REFUSALS = [
  'not_found', 'nothing_to_export', 'format_unsupported', 'format_unknown', 'format_not_file', 'format_not_transfer', 'meta_invalid', 'has_errors',
  'invalid_correction', 'already_exported', 'invalid', 'no_connection', 'http_transfer_unsupported', 'host_refused', 'bad_url', 'url_required',
  'unreadable', 'no_name_column', 'empty', 'client', 'expired', 'generic',
];

describe('1C labels (uz and ru)', () => {
  for (const [locale, a, o] of [['uz', shared.uz, onec.uz], ['ru', shared.ru, onec.ru]] as const) {
    it(`${locale}: issue codes, reasons, refusals, formats, checks`, () => {
      for (const code of accounting.ONEC_ISSUE_CODES) assert.ok(a.accountingX.issues[code], `issues.${code}`);
      for (const r of REASONS) assert.ok(a.accountingX.reasons[r], `reasons.${r}`);
      for (const e of REFUSALS) assert.ok(o.onecX.errors[e], `errors.${e}`);
      for (const f of accounting.ONEC_FORMATS) assert.ok(o.onecX.formats[f], `formats.${f}`);
      for (const c of ['balance', 'turnover', 'totals', 'duplicates', 'review', 'records']) assert.ok(o.onecX.detail.check[c], `check.${c}`);
      for (const k of accounting.ONEC_CONNECTION_KINDS) assert.ok(o.onecX.settings.kinds[k], `kinds.${k}`);
    });
  }
});
