// The contracts copy value lists and zod schemas so the browser never imports @prisma/client
// or @tasnivo/domain. These tests fail when a copy and its source drift apart.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { CatalogStatus, ClientActivity, Decision, FindingType, Severity, UserRole } from '@prisma/client';
import type { MatchStage } from '@tasnivo/core/match/types';
import { BANDS } from '@tasnivo/core/match/score';
import { CATEGORIES } from '@tasnivo/domain/activity';
import { LOGO_MAX_BYTES } from '@tasnivo/domain/account-settings';
import { DIMENSIONS } from '@tasnivo/domain/accuracy';
import { CheckItemSchema } from '@tasnivo/domain/api/check';
import * as domainContract from '@tasnivo/domain/api/contract';
import { FEATURES as DOMAIN_FEATURES, TIERS as DOMAIN_TIERS } from '@tasnivo/domain/billing/plans';
import { MAX_UPLOAD_BYTES } from '@tasnivo/domain/catalog-import';
import { CLIENT_FILTERS as DOMAIN_CLIENT_FILTERS, CLIENT_SORTS as DOMAIN_CLIENT_SORTS, STALE_DAYS as DOMAIN_STALE_DAYS } from '@tasnivo/domain/client-stats';
import { COLUMN_FIELDS as DOMAIN_COLUMN_FIELDS, ColumnMapSchema } from '@tasnivo/domain/column-map';
import { DECISION_SOURCES as DOMAIN_DECISION_SOURCES } from '@tasnivo/domain/decision-source';
import { DEMO_LIMITS as DOMAIN_DEMO_LIMITS } from '@tasnivo/domain/demo-access-fields';
import { DICT_FILTERS as DOMAIN_DICT_FILTERS } from '@tasnivo/domain/dictionary-review';
import { DOC_KINDS as DOMAIN_DOC_KINDS, DocMapSchema } from '@tasnivo/domain/docs';
import { HONEYPOT_FIELD as DOMAIN_HONEYPOT, LEAD_LIMITS as DOMAIN_LEAD_LIMITS } from '@tasnivo/domain/lead-guard';
import { LEAD_MAX_BYTES } from '@tasnivo/domain/lead-submit';
import { NOTICE_GROUPS as DOMAIN_NOTICE_GROUPS } from '@tasnivo/domain/notifications';
import { PurchaseMapSchema } from '@tasnivo/domain/purchases';
import { NOTE_MAX } from '@tasnivo/domain/review-assignments';
import { RETENTION_CHOICES as DOMAIN_RETENTION } from '@tasnivo/domain/security/account';
import { UPLOAD_EXTENSIONS } from '@tasnivo/domain/upload-file-types';
import { OPTIONAL_COLUMNS as DOMAIN_OPTIONAL_COLUMNS, ViewParams as DomainViewParams } from '@tasnivo/domain/view-params';
import type { CodeState } from '@tasnivo/domain/workspace-rows';
import { DECISION_FILTERS as DOMAIN_DECISION_FILTERS, FilterInput as DomainFilterInput, FINDING_TYPES as WS_FINDING_TYPES, FLAG_FILTERS as DOMAIN_FLAG_FILTERS } from '@tasnivo/domain/workspace-filter';
import { WRONG_REASONS as DOMAIN_WRONG_REASONS } from '@tasnivo/domain/wrong-reasons';
import { LOCALES as DOMAIN_LOCALES } from '@tasnivo/i18n/i18n';
import type { ZodTypeAny } from 'zod';
import {
  CATALOG_STATUSES, CLIENT_ACTIVITIES, CODE_STATES, ColumnMap, COLUMN_FIELDS, DECISION_FILTERS, DECISION_SOURCES, DECISIONS, DOC_KINDS, DocMap,
  FilterInput, FINDING_TYPES, FLAG_FILTERS, LIMITS, LOCALES, MATCH_STAGES, OPTIONAL_COLUMNS, PLAN_FEATURE_KEYS, PLAN_TIERS, PurchaseMap, RETENTION_CHOICES, ROLES, SEVERITIES,
  THEMES, ViewParams, WRONG_REASONS,
} from './common';
import { ACTIVITY_CATEGORIES } from './modules/account';
import { ACCURACY_DIMENSIONS } from './modules/admin';
import { CLIENT_FILTERS, CLIENT_SORTS, STALE_DAYS } from './modules/clients';
import { DEMO_LIMITS, HONEYPOT_FIELD, LEAD_LIMITS } from './modules/demo';
import { DICT_FILTERS } from './modules/dictionary';
import { NOTICE_GROUPS } from './modules/notifications';
import * as contract from './modules/public-api';
import { SURE_BAND_MIN } from './modules/workspace';
import { SchemaConverter } from './openapi';
import { endpoints } from './registry';

// Compile-time: the copies name exactly the members of the domain's union types.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const stagesMatch: Same<MatchStage, (typeof MATCH_STAGES)[number]> = true;
const statesMatch: Same<CodeState, (typeof CODE_STATES)[number]> = true;

const json = (schema: ZodTypeAny) => new SchemaConverter().convert(schema);
const sorted = (list: readonly (string | number)[]) => [...list].sort();

describe('value lists equal their sources', () => {
  it('Prisma enums, in schema order', () => {
    assert.deepEqual(CATALOG_STATUSES, Object.values(CatalogStatus));
    assert.deepEqual(DECISIONS, Object.values(Decision));
    assert.deepEqual(SEVERITIES, Object.values(Severity));
    assert.deepEqual(FINDING_TYPES, Object.values(FindingType));
    assert.deepEqual(ROLES, Object.values(UserRole));
    assert.deepEqual(CLIENT_ACTIVITIES, Object.values(ClientActivity));
  });

  it('domain constants', () => {
    assert.ok(stagesMatch && statesMatch);
    assert.deepEqual(FINDING_TYPES, WS_FINDING_TYPES);
    assert.deepEqual(DECISION_SOURCES, DOMAIN_DECISION_SOURCES);
    assert.deepEqual(DECISION_FILTERS, DOMAIN_DECISION_FILTERS);
    assert.deepEqual(FLAG_FILTERS, DOMAIN_FLAG_FILTERS);
    assert.deepEqual(OPTIONAL_COLUMNS, DOMAIN_OPTIONAL_COLUMNS);
    assert.deepEqual(COLUMN_FIELDS, DOMAIN_COLUMN_FIELDS);
    assert.deepEqual(WRONG_REASONS, DOMAIN_WRONG_REASONS);
    assert.deepEqual(DOC_KINDS, DOMAIN_DOC_KINDS);
    assert.deepEqual(RETENTION_CHOICES, DOMAIN_RETENTION);
    assert.deepEqual(PLAN_TIERS, DOMAIN_TIERS);
    assert.deepEqual(PLAN_FEATURE_KEYS, DOMAIN_FEATURES);
    assert.deepEqual(LOCALES, DOMAIN_LOCALES);
    assert.deepEqual(CLIENT_FILTERS, DOMAIN_CLIENT_FILTERS);
    assert.deepEqual(CLIENT_SORTS, DOMAIN_CLIENT_SORTS);
    assert.deepEqual(STALE_DAYS, DOMAIN_STALE_DAYS);
    assert.deepEqual(DICT_FILTERS, DOMAIN_DICT_FILTERS);
    assert.deepEqual(NOTICE_GROUPS, DOMAIN_NOTICE_GROUPS);
    assert.deepEqual(ACTIVITY_CATEGORIES, CATEGORIES);
    assert.deepEqual(sorted(ACCURACY_DIMENSIONS), sorted(DIMENSIONS));
    assert.deepEqual(DEMO_LIMITS, DOMAIN_DEMO_LIMITS);
    assert.deepEqual(LEAD_LIMITS, DOMAIN_LEAD_LIMITS);
    assert.equal(HONEYPOT_FIELD, DOMAIN_HONEYPOT);
    assert.equal(SURE_BAND_MIN, BANDS.high);
  });

  it('upload caps and accepted extensions', () => {
    assert.equal(LIMITS.uploadBytes, MAX_UPLOAD_BYTES);
    assert.deepEqual(LIMITS.uploadExtensions, UPLOAD_EXTENSIONS);
    // The lead form's cap, enforced by POST /api/lead (lead-submit.ts).
    assert.equal(LIMITS.leadBytes, LEAD_MAX_BYTES);
    assert.equal(LIMITS.leadBytes, 5 * 1024 * 1024);
    assert.equal(LIMITS.logoBytes, LOGO_MAX_BYTES);
    // The review note limit the action allowed (NOTE_MAX * 4 characters before trimming).
    const note = endpoints.catalogs.assignReview.body.shape.note;
    assert.equal(note.safeParse('x'.repeat(NOTE_MAX * 4)).success, true);
    assert.equal(note.safeParse('x'.repeat(NOTE_MAX * 4 + 1)).success, false);
  });

  it('themes (apps/web/src/ui/theme.ts)', () => {
    assert.match(readFileSync('apps/web/src/ui/theme.ts', 'utf8'), new RegExp(`THEMES: readonly Theme\\[\\] = \\[${THEMES.map((t) => `'${t}'`).join(', ')}\\]`));
  });
});

describe('zod schemas equal the domain ones', () => {
  it('column, purchase and doc maps, workspace filter, saved view, API check item', () => {
    assert.deepEqual(json(ColumnMap), json(ColumnMapSchema));
    assert.deepEqual(json(PurchaseMap), json(PurchaseMapSchema));
    assert.deepEqual(json(DocMap), json(DocMapSchema));
    assert.deepEqual(json(FilterInput), json(DomainFilterInput));
    assert.deepEqual(json(ViewParams), json(DomainViewParams));
    assert.deepEqual(new SchemaConverter().object(contract.CheckItem), new SchemaConverter().object(CheckItemSchema.extend({ mxik: CheckItemSchema.shape.mxik.describe('The code the product has now, if any.') })));
  });

  it('and parse the same way', () => {
    const map = { name: 0, barcode: -1, mxik: 2, unit: -1, price: -1 };
    assert.deepEqual(ColumnMap.parse(map), ColumnMapSchema.parse(map));
    assert.equal(ColumnMap.safeParse({ ...map, name: -1 }).success, ColumnMapSchema.safeParse({ ...map, name: -1 }).success);
    const item = { name: '  Sut 1L  ', barcode: null };
    assert.deepEqual(contract.CheckItem.parse(item), CheckItemSchema.parse(item));
  });
});

describe('public API constants equal packages/domain/src/api/contract.ts', () => {
  it('errors, headers, idempotency, paging, field texts', () => {
    assert.deepEqual(contract.ERROR_STATUS, domainContract.ERROR_STATUS);
    assert.deepEqual(contract.ERROR_CODES, domainContract.ERROR_CODES);
    assert.deepEqual(contract.HEADERS, domainContract.HEADERS);
    assert.deepEqual(contract.IDEMPOTENCY, domainContract.IDEMPOTENCY);
    assert.deepEqual(contract.PAGE, domainContract.PAGE);
    assert.deepEqual(contract.FINDING_FIELDS, domainContract.FINDING_FIELDS);
  });

  it('operations: method, path, success status, idempotency, paging and error codes', () => {
    for (const id of domainContract.OPERATION_IDS) {
      const op = domainContract.OPERATIONS[id];
      const e = endpoints.publicApi[id];
      assert.equal(e.operationId, id);
      assert.equal(e.method.toLowerCase(), op.method, id);
      assert.equal(e.path, op.path, id);
      assert.equal(e.publicApi.success, op.success, id);
      assert.equal(e.publicApi.idempotent, op.idempotent, id);
      assert.equal(e.publicApi.paginated, op.paginated, id);
      assert.deepEqual(e.publicApi.errors, op.errors, id);
    }
  });

  it('pageLimit clamps the same way', () => {
    for (const raw of [null, '', 'abc', '0', '1', '7.9', '50', '101', '5000', '-3']) {
      assert.equal(contract.pageLimit(raw, contract.PAGE.catalogs), domainContract.pageLimit(raw, domainContract.PAGE.catalogs), String(raw));
    }
  });
});
