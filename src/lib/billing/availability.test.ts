import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { catalogPurchase, purchaseOf } from './availability';
import { billingConfig } from './config';
import { catalogPlan, firmPlan, firmPrice, planById } from './plans';

const providers = billingConfig({ CLICK_SERVICE_ID: 's', CLICK_MERCHANT_ID: 'm', CLICK_SECRET_KEY: 'k' });
const none = billingConfig({});

describe('billing honesty', () => {
  it('reads the firm price only from PLAN_FIRM_PRICE, never a default', () => {
    assert.equal(firmPrice({}), null);
    assert.equal(firmPrice({ PLAN_FIRM_PRICE: '' }), null);
    assert.equal(firmPrice({ PLAN_FIRM_PRICE: '990 000' }), 990_000);
    assert.equal(firmPrice({ PLAN_FIRM_PRICE: '0' }), null);
    assert.equal(firmPrice({ PLAN_FIRM_PRICE: '-5' }), null);
    assert.equal(firmPrice({ PLAN_FIRM_PRICE: '12.5' }), null);
    assert.equal(firmPrice({ PLAN_FIRM_PRICE: 'free' }), null);
  });

  it('without a price the firm plan does not exist, so it cannot be ordered', () => {
    assert.equal(firmPlan({}), null);
    assert.equal(planById('firm_monthly', {}), null);
    assert.deepEqual(planById('firm_monthly', { PLAN_FIRM_PRICE: '450000' }), { id: 'firm_monthly', price: 450_000, kind: 'subscription', maxRows: null });
  });

  it('no price → not for sale, whoever looks and whatever is configured', () => {
    assert.deepEqual(purchaseOf({ plan: firmPlan({}), config: providers, admin: true, demo: false }), { kind: 'not_for_sale' });
    assert.deepEqual(purchaseOf({ plan: firmPlan({}), config: none, admin: false, demo: false }), { kind: 'not_for_sale' });
  });

  it('a price without a payment provider says so instead of showing buttons', () => {
    assert.deepEqual(purchaseOf({ plan: firmPlan({ PLAN_FIRM_PRICE: '450000' }), config: none, admin: true, demo: false }), { kind: 'no_provider', price: 450_000 });
  });

  it('only an admin gets pay buttons', () => {
    const plan = firmPlan({ PLAN_FIRM_PRICE: '450000' });
    assert.deepEqual(purchaseOf({ plan, config: providers, admin: false, demo: false }), { kind: 'admin_only', price: 450_000 });
    assert.deepEqual(purchaseOf({ plan, config: providers, admin: true, demo: false }), { kind: 'available', price: 450_000, providers: ['click'] });
  });

  it('a demo never pays', () => {
    assert.deepEqual(purchaseOf({ plan: firmPlan({ PLAN_FIRM_PRICE: '450000' }), config: providers, admin: true, demo: true }), { kind: 'demo' });
  });

  it('a catalogue: paid, too large, or the same rules as the firm plan', () => {
    assert.deepEqual(catalogPurchase({ plan: catalogPlan(100), config: none, admin: true, demo: false, paid: true }), { kind: 'paid' });
    assert.deepEqual(catalogPurchase({ plan: catalogPlan(50_000), config: providers, admin: true, demo: false, paid: false }), { kind: 'too_large' });
    assert.equal(catalogPurchase({ plan: catalogPlan(100), config: none, admin: true, demo: false, paid: false }).kind, 'no_provider');
    assert.equal(catalogPurchase({ plan: catalogPlan(100), config: providers, admin: false, demo: false, paid: false }).kind, 'admin_only');
  });
});
