// Payme Merchant API (JSON-RPC 2.0), merchant side: CheckPerformTransaction,
// CreateTransaction, PerformTransaction, CancelTransaction, CheckTransaction,
// GetStatement. Amounts are in tiyin; the account field is "order_id".
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { db } from '@tasnivo/db';
import type { PaymeConfig } from './config.js';
import { cancelOrder, markPaid, orderPayable } from './orders.js';

const TIMEOUT_MS = 12 * 60 * 60 * 1000;

type Message = { ru: string; uz: string; en: string };
const msg = (ru: string, uz: string, en: string): Message => ({ ru, uz, en });

const ERRORS = {
  auth: { code: -32504, message: msg('Недостаточно привилегий', 'Ruxsat yoʻq', 'Insufficient privilege') },
  parse: { code: -32700, message: msg('Ошибка разбора JSON', 'JSON xato', 'Parse error') },
  request: { code: -32600, message: msg('Неверный запрос', 'Notoʻgʻri soʻrov', 'Invalid request') },
  method: { code: -32601, message: msg('Метод не найден', 'Metod topilmadi', 'Method not found') },
  amount: { code: -31001, message: msg('Неверная сумма', 'Notoʻgʻri summa', 'Invalid amount') },
  transaction: { code: -31003, message: msg('Транзакция не найдена', 'Tranzaksiya topilmadi', 'Transaction not found') },
  cannotCancel: { code: -31007, message: msg('Заказ выполнен, отмена невозможна', 'Buyurtma bajarilgan, bekor qilib boʻlmaydi', 'Order completed, cannot cancel') },
  cannotPerform: { code: -31008, message: msg('Операция невозможна', 'Amalni bajarib boʻlmaydi', 'Operation not allowed') },
  order: { code: -31050, message: msg('Заказ не найден', 'Buyurtma topilmadi', 'Order not found'), data: 'order_id' },
  orderState: { code: -31051, message: msg('Заказ недоступен для оплаты', 'Buyurtmani toʻlab boʻlmaydi', 'Order cannot be paid'), data: 'order_id' },
} as const;

type RpcError = { code: number; message: Message; data?: string };
class PaymeError extends Error {
  constructor(readonly rpc: RpcError) {
    super(rpc.message.en);
  }
}

export function paymeCheckoutUrl(config: PaymeConfig, orderId: string, amountSom: number, returnUrl: string | null): string {
  const params = [`m=${config.merchantId}`, `ac.order_id=${orderId}`, `a=${amountSom * 100}`];
  if (returnUrl) params.push(`c=${returnUrl}`);
  const host = config.test ? 'https://checkout.test.paycom.uz' : 'https://checkout.paycom.uz';
  return `${host}/${Buffer.from(params.join(';')).toString('base64')}`;
}

/** Basic auth "Paycom:<key>", compared in constant time. */
export function paymeAuthorized(header: string | null, config: PaymeConfig): boolean {
  const match = /^Basic\s+(.+)$/i.exec(header ?? '');
  if (!match?.[1]) return false;
  const given = Buffer.from(Buffer.from(match[1], 'base64').toString('utf8'));
  const expected = Buffer.from(`Paycom:${config.key}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

const Account = z.object({ order_id: z.string().min(1) });
const Amount = z.number().int().positive();

async function payableOrder(account: unknown, amount: unknown) {
  const acc = Account.safeParse(account);
  if (!acc.success) throw new PaymeError(ERRORS.order);
  const order = await db.order.findUnique({ where: { id: acc.data.order_id } });
  if (!order) throw new PaymeError(ERRORS.order);
  const tiyin = Amount.safeParse(amount);
  if (!tiyin.success || tiyin.data !== order.amount * 100) throw new PaymeError(ERRORS.amount);
  if (order.status !== 'created') throw new PaymeError(ERRORS.orderState);
  // A catalogue another order paid for, or a tier change the rule refuses: refused before money is held.
  if (!(await orderPayable(order))) throw new PaymeError(ERRORS.orderState);
  return order;
}

async function transactionById(id: unknown) {
  const externalId = z.string().min(1).safeParse(id);
  if (!externalId.success) throw new PaymeError(ERRORS.transaction);
  const tx = await db.paymentTransaction.findUnique({ where: { provider_externalId: { provider: 'payme', externalId: externalId.data } } });
  if (!tx) throw new PaymeError(ERRORS.transaction);
  return tx;
}

const num = (n: bigint | null): number => (n === null ? 0 : Number(n));

/** An open transaction older than Payme's 12 hours: cancelled (reason 4, timeout) with its order. */
async function cancelStale(txId: number, orderId: string): Promise<never> {
  await db.$transaction(async (t) => {
    const moved = await t.paymentTransaction.updateMany({ where: { id: txId, state: 1 }, data: { state: -1, cancelTime: BigInt(Date.now()), reason: 4 } });
    if (moved.count === 1) await cancelOrder(orderId, t);
  });
  throw new PaymeError(ERRORS.cannotPerform);
}

type Params = Record<string, unknown>;
/** `test`: the call came through Payme's sandbox (PAYME_TEST_MODE). */
type Context = { test: boolean };

const METHODS: Record<string, (p: Params, ctx: Context) => Promise<unknown>> = {
  async CheckPerformTransaction(p) {
    await payableOrder(p['account'], p['amount']);
    return { allow: true };
  },

  async CreateTransaction(p) {
    const id = z.string().min(1).safeParse(p['id']);
    if (!id.success) throw new PaymeError(ERRORS.request);
    const key = { provider_externalId: { provider: 'payme', externalId: id.data } };
    const existing = await db.paymentTransaction.findUnique({ where: key });
    if (existing) {
      if (existing.state !== 1) throw new PaymeError(ERRORS.cannotPerform);
      if (Date.now() - num(existing.createTime) > TIMEOUT_MS) return cancelStale(existing.id, existing.orderId);
      return { create_time: num(existing.createTime), transaction: String(existing.id), state: 1 };
    }
    const order = await payableOrder(p['account'], p['amount']);
    const time = z.number().int().safeParse(p['time']);
    const tx = await db.$transaction(async (t) => {
      // One open transaction per order, counted and created under a per-order lock: a second one would be a double charge.
      await t.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('payme_order'), hashtext(${order.id}))`;
      const same = await t.paymentTransaction.findUnique({ where: key });
      if (same) return same;
      const open = await t.paymentTransaction.count({ where: { orderId: order.id, provider: 'payme', state: 1 } });
      if (open > 0) throw new PaymeError(ERRORS.orderState);
      return t.paymentTransaction.create({
        data: {
          orderId: order.id, provider: 'payme', externalId: id.data, amountTiyin: BigInt(order.amount) * 100n,
          state: 1, providerTime: time.success ? BigInt(time.data) : null, createTime: BigInt(Date.now()),
        },
      });
    });
    if (tx.state !== 1) throw new PaymeError(ERRORS.cannotPerform);
    return { create_time: num(tx.createTime), transaction: String(tx.id), state: 1 };
  },

  async PerformTransaction(p, ctx) {
    const tx = await transactionById(p['id']);
    if (tx.state === 2) return { transaction: String(tx.id), perform_time: num(tx.performTime), state: 2 };
    if (tx.state !== 1) throw new PaymeError(ERRORS.cannotPerform);
    if (Date.now() - num(tx.createTime) > TIMEOUT_MS) return cancelStale(tx.id, tx.orderId);
    const performTime = BigInt(Date.now());
    const outcome = await markPaid(tx.orderId, 'payme', {
      testMode: ctx.test,
      // The transaction's own state moves with the order, or neither does (a concurrent Cancel won).
      within: async (t) => {
        const moved = await t.paymentTransaction.updateMany({ where: { id: tx.id, state: 1 }, data: { state: 2, performTime } });
        if (moved.count !== 1) throw new PaymeError(ERRORS.cannotPerform);
      },
    });
    if (outcome === 'paid') return { transaction: String(tx.id), perform_time: Number(performTime), state: 2 };
    // A concurrent Perform of this transaction got there first: answer what it recorded.
    const current = await db.paymentTransaction.findUnique({ where: { id: tx.id } });
    if (current?.state === 2) return { transaction: String(current.id), perform_time: num(current.performTime), state: 2 };
    throw new PaymeError(ERRORS.cannotPerform);
  },

  async CancelTransaction(p) {
    const tx = await transactionById(p['id']);
    if (tx.state < 0) return { transaction: String(tx.id), cancel_time: num(tx.cancelTime), state: tx.state };
    // The corrected file is delivered at payment, so a performed order is not reversed here.
    if (tx.state === 2) throw new PaymeError(ERRORS.cannotCancel);
    const reason = z.number().int().safeParse(p['reason']);
    await db.$transaction(async (t) => {
      const moved = await t.paymentTransaction.updateMany({
        where: { id: tx.id, state: 1 },
        data: { state: -1, cancelTime: BigInt(Date.now()), reason: reason.success ? reason.data : null },
      });
      if (moved.count === 1) await cancelOrder(tx.orderId, t);
    });
    const done = await db.paymentTransaction.findUniqueOrThrow({ where: { id: tx.id } });
    if (done.state === 2) throw new PaymeError(ERRORS.cannotCancel);
    return { transaction: String(done.id), cancel_time: num(done.cancelTime), state: done.state };
  },

  async CheckTransaction(p) {
    const tx = await transactionById(p['id']);
    return {
      create_time: num(tx.createTime), perform_time: num(tx.performTime), cancel_time: num(tx.cancelTime),
      transaction: String(tx.id), state: tx.state, reason: tx.reason,
    };
  },

  async GetStatement(p) {
    const from = z.number().int().safeParse(p['from']);
    const to = z.number().int().safeParse(p['to']);
    if (!from.success || !to.success) throw new PaymeError(ERRORS.request);
    const rows = await db.paymentTransaction.findMany({
      where: { provider: 'payme', providerTime: { gte: BigInt(from.data), lte: BigInt(to.data) } },
      orderBy: { providerTime: 'asc' },
    });
    return {
      transactions: rows.map((tx) => ({
        id: tx.externalId, time: num(tx.providerTime), amount: Number(tx.amountTiyin), account: { order_id: tx.orderId },
        create_time: num(tx.createTime), perform_time: num(tx.performTime), cancel_time: num(tx.cancelTime),
        transaction: String(tx.id), state: tx.state, reason: tx.reason,
      })),
    };
  },
};

const Rpc = z.object({ id: z.union([z.number(), z.string()]).nullish(), method: z.string(), params: z.record(z.unknown()).default({}) });

/** One JSON-RPC call; authorization is checked by the caller first. */
export async function handlePayme(body: unknown, ctx: Context = { test: false }): Promise<Record<string, unknown>> {
  const rpc = Rpc.safeParse(body);
  if (!rpc.success) return { jsonrpc: '2.0', id: null, error: ERRORS.request };
  const id = rpc.data.id ?? null;
  const method = METHODS[rpc.data.method];
  if (!method) return { jsonrpc: '2.0', id, error: ERRORS.method };
  try {
    return { jsonrpc: '2.0', id, result: await method(rpc.data.params, ctx) };
  } catch (error) {
    if (error instanceof PaymeError) return { jsonrpc: '2.0', id, error: error.rpc };
    throw error;
  }
}

export const PAYME_ERRORS = ERRORS;

/**
 * POST /api/payments/payme once Payme is configured: `body` is the parsed JSON, or null when the
 * request did not parse. Payme expects HTTP 200 with a JSON-RPC error, never a 401.
 */
export async function answerPayme(body: { json: unknown } | null, authorization: string | null, config: PaymeConfig): Promise<Record<string, unknown>> {
  if (!body) return { jsonrpc: '2.0', id: null, error: ERRORS.parse };
  const json = body.json;
  const id = typeof json === 'object' && json !== null ? (json as { id?: unknown }).id ?? null : null;
  if (!paymeAuthorized(authorization, config)) return { jsonrpc: '2.0', id, error: ERRORS.auth };
  return handlePayme(json, { test: config.test });
}
