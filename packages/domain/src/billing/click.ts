// Click SHOP API, merchant side: Prepare (action 0) and Complete (action 1).
// Click posts form fields and signs them with MD5 over the merchant secret;
// every request is verified, and every answer is idempotent for retries.
import { createHash } from 'node:crypto';
import { db } from '@tasnivo/db';
import { safeEqualText } from '../security/safe-equal.js';
import type { ClickConfig } from './config.js';
import { cancelOrder, markPaid, orderPayable } from './orders.js';

export const CLICK_ERRORS = {
  ok: { error: 0, error_note: 'Success' },
  sign: { error: -1, error_note: 'SIGN CHECK FAILED!' },
  amount: { error: -2, error_note: 'Incorrect parameter amount' },
  action: { error: -3, error_note: 'Action not found' },
  paid: { error: -4, error_note: 'Already paid' },
  order: { error: -5, error_note: 'User does not exist' },
  transaction: { error: -6, error_note: 'Transaction does not exist' },
  update: { error: -7, error_note: 'Failed to update user' },
  request: { error: -8, error_note: 'Error in request from click' },
  cancelled: { error: -9, error_note: 'Transaction cancelled' },
} as const;

type Fields = Record<string, string>;

/** md5(click_trans_id + service_id + secret + merchant_trans_id [+ merchant_prepare_id] + amount + action + sign_time). */
export function clickSign(f: Fields, secret: string): string {
  const prepareId = f['action'] === '1' ? (f['merchant_prepare_id'] ?? '') : '';
  const raw = `${f['click_trans_id'] ?? ''}${f['service_id'] ?? ''}${secret}${f['merchant_trans_id'] ?? ''}${prepareId}${f['amount'] ?? ''}${f['action'] ?? ''}${f['sign_time'] ?? ''}`;
  return createHash('md5').update(raw).digest('hex');
}

export function clickCheckoutUrl(config: ClickConfig, orderId: string, amount: number, returnUrl: string | null): string {
  const q = new URLSearchParams({
    service_id: config.serviceId,
    merchant_id: config.merchantId,
    amount: String(amount),
    transaction_param: orderId,
  });
  if (returnUrl) q.set('return_url', returnUrl);
  return `https://my.click.uz/services/pay?${q.toString()}`;
}

type Reply = Record<string, string | number>;

/** merchant_prepare_id as the integer id we answered at Prepare; null when it is not one. */
function prepareId(value: string | undefined): number | null {
  if (!value || !/^\d{1,10}$/.test(value)) return null;
  const id = Number(value);
  return id >= 1 && id <= 2_147_483_647 ? id : null;
}

export async function handleClick(f: Fields, config: ClickConfig): Promise<Reply> {
  const base = { click_trans_id: f['click_trans_id'] ?? '', merchant_trans_id: f['merchant_trans_id'] ?? '' };
  const required = ['click_trans_id', 'service_id', 'merchant_trans_id', 'amount', 'action', 'sign_time', 'sign_string'];
  if (required.some((k) => !f[k])) return { ...base, ...CLICK_ERRORS.request };
  if (f['service_id'] !== config.serviceId) return { ...base, ...CLICK_ERRORS.request };
  if (!safeEqualText(clickSign(f, config.secretKey), f['sign_string']?.toLowerCase() ?? '')) return { ...base, ...CLICK_ERRORS.sign };
  if (f['action'] !== '0' && f['action'] !== '1') return { ...base, ...CLICK_ERRORS.action };

  const order = await db.order.findUnique({ where: { id: f['merchant_trans_id'] ?? '' } });
  if (!order) return { ...base, ...CLICK_ERRORS.order };
  if (Number(f['amount']) !== order.amount) return { ...base, ...CLICK_ERRORS.amount };
  const externalId = f['click_trans_id'] ?? '';
  const now = BigInt(Date.now());

  if (f['action'] === '0') {
    if (order.status === 'paid') return { ...base, ...CLICK_ERRORS.paid };
    if (order.status === 'cancelled') return { ...base, ...CLICK_ERRORS.cancelled };
    // Refused before Click takes the money: a catalogue already paid, or a tier change the rule forbids.
    if (!(await orderPayable(order))) {
      await cancelOrder(order.id);
      return { ...base, ...CLICK_ERRORS.cancelled };
    }
    const tx = await db.paymentTransaction.upsert({
      where: { provider_externalId: { provider: 'click', externalId } },
      create: { orderId: order.id, provider: 'click', externalId, amountTiyin: BigInt(order.amount) * 100n, state: 1, createTime: now },
      update: {},
    });
    if (tx.orderId !== order.id) return { ...base, ...CLICK_ERRORS.request };
    // A retried Prepare for a transaction already cancelled or completed is not opened again.
    if (tx.state === -1) return { ...base, ...CLICK_ERRORS.cancelled };
    if (tx.state === 2) return { ...base, ...CLICK_ERRORS.paid };
    return { ...base, merchant_prepare_id: tx.id, ...CLICK_ERRORS.ok };
  }

  // A missing or malformed merchant_prepare_id is Click's request error, never an exception.
  const id = prepareId(f['merchant_prepare_id']);
  if (id === null) return { ...base, ...CLICK_ERRORS.request };
  const tx = await db.paymentTransaction.findFirst({ where: { id, provider: 'click', externalId, orderId: order.id } });
  if (!tx) return { ...base, ...CLICK_ERRORS.transaction };
  if (tx.state === 2) return { ...base, merchant_confirm_id: tx.id, ...CLICK_ERRORS.paid };
  if (tx.state === -1) return { ...base, ...CLICK_ERRORS.cancelled };
  // Click reports its own failure in "error"; the payment did not happen.
  if (Number(f['error'] ?? '0') < 0) {
    await db.$transaction(async (t) => {
      await t.paymentTransaction.updateMany({ where: { id: tx.id, state: 1 }, data: { state: -1, cancelTime: now } });
      await cancelOrder(order.id, t);
    });
    return { ...base, ...CLICK_ERRORS.cancelled };
  }
  if (order.status === 'cancelled') return { ...base, ...CLICK_ERRORS.cancelled };
  // Paid meanwhile through another transaction: never take the money twice.
  if (order.status === 'paid') return { ...base, ...CLICK_ERRORS.paid };
  const outcome = await markPaid(order.id, 'click', {
    within: async (t) => {
      await t.paymentTransaction.update({ where: { id: tx.id }, data: { state: 2, performTime: now } });
    },
  });
  if (outcome === 'paid') return { ...base, merchant_confirm_id: tx.id, ...CLICK_ERRORS.ok };
  if (outcome === 'not_payable') {
    // Lost a race with another confirmation of this order: answer by what the order is now.
    const current = await db.order.findUnique({ where: { id: order.id }, select: { status: true } });
    return { ...base, ...(current?.status === 'paid' ? CLICK_ERRORS.paid : current?.status === 'cancelled' ? CLICK_ERRORS.cancelled : CLICK_ERRORS.update) };
  }
  // The tier rule or a catalogue paid by another order refuses it: Click reverses the payment.
  await db.$transaction(async (t) => {
    await t.paymentTransaction.updateMany({ where: { id: tx.id, state: 1 }, data: { state: -1, cancelTime: now } });
    await cancelOrder(order.id, t);
  });
  return { ...base, ...CLICK_ERRORS.cancelled };
}
