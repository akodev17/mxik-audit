// A fake 1C OData standard interface for the tests, behaving the way the saved real responses
// show (SOURCES.md): list envelopes with `odata.metadata` and a string `odata.count`, `$filter` /
// `$select` / `$top` / `$skip` / `$inlinecount`, 201 with the created object and a Location header,
// the XML and JSON error envelopes with 1C's internal codes, Post() answering 200 with an empty body
// or 500 when the "business logic" refuses, PATCH with If-Match / 412, a 403 for an object outside
// the composition, 401 for record-level restrictions without allowedOnly, and the mista finding: a
// row sent with its own Ref_Key leaves the tabular part empty. No real 1C base was available; this
// is the only 1C the OData client has been run against.
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

export type SetSpec = { props: string[]; parts?: Record<string, string[]> };
export type MetadataSpec = Record<string, SetSpec>;

const CATALOG = ['Ref_Key', 'DataVersion', 'DeletionMark', 'Parent_Key', 'IsFolder', 'Code', 'Description', 'Predefined', 'PredefinedDataName'];
const DOCUMENT = ['Ref_Key', 'DataVersion', 'DeletionMark', 'Number', 'Date', 'Posted'];
const BANK_DOC = [...DOCUMENT, 'НомерВходящегоДокумента', 'ДатаВходящегоДокумента', 'СуммаДокумента', 'НазначениеПлатежа', 'ВидОперации', 'Комментарий',
  // Контрагент of a bank document is composite (a counterparty, a person, …): value + type.
  'Контрагент', 'Контрагент_Type', 'ДоговорКонтрагента_Key', 'СтатьяДвиженияДенежныхСредств_Key', 'СчетОрганизации_Key'];

/**
 * The typical names of «Бухгалтерия для Узбекистана 3.0» as far as public sources show them
 * (research note onec §1.4, §5.2). CONSTRUCTED: no real $metadata of a UZ base was available.
 */
export const BP_UZ_SPEC: MetadataSpec = {
  Catalog_Контрагенты: { props: [...CATALOG, 'НаименованиеПолное', 'ИНН'] },
  Catalog_ДоговорыКонтрагентов: { props: [...CATALOG, 'Owner_Key'] },
  Catalog_СтатьиДвиженияДенежныхСредств: { props: CATALOG },
  Catalog_БанковскиеСчета: { props: [...CATALOG, 'Owner', 'Owner_Type', 'НомерСчета'] },
  Catalog_Номенклатура: { props: [...CATALOG, 'НаименованиеПолное', 'Артикул', 'ЕдиницаИзмерения_Key'] },
  Catalog_КлассификаторЕдиницИзмерения: { props: CATALOG },
  ChartOfAccounts_Хозрасчетный: { props: ['Ref_Key', 'DataVersion', 'DeletionMark', 'Code', 'Description'] },
  Document_ПоступлениеНаРасчетныйСчет: { props: BANK_DOC },
  Document_СписаниеСРасчетногоСчета: { props: BANK_DOC },
  Document_ПоступлениеТоваровУслуг: {
    props: [...DOCUMENT, 'НомерВходящегоДокумента', 'ДатаВходящегоДокумента', 'СуммаДокумента', 'Комментарий', 'Контрагент_Key', 'ДоговорКонтрагента_Key'],
    parts: {
      Товары: ['LineNumber', 'Номенклатура_Key', 'Количество', 'Цена', 'Сумма', 'СтавкаНДС', 'СуммаНДС', 'СчетУчетаНДС_Key'],
      КодыМаркировки: ['LineNumber', 'НомерСтрокиТовары', 'КодМаркировки'],
    },
  },
};

const typeOf = (p: string): string => (p.endsWith('_Key') ? 'Edm.Guid' : p === 'Date' || p.startsWith('Дата') ? 'Edm.DateTime' : /^(DeletionMark|IsFolder|Posted|Predefined)$/.test(p) ? 'Edm.Boolean' : 'Edm.String');

/** A CSDL document as 1C publishes it (namespace StandardODATA, tabular parts as `<Set>_<Part>_RowType` and their own sets). */
export function metadataXml(spec: MetadataSpec): string {
  const prop = (p: string): string => `<Property Name="${p}" Type="${typeOf(p)}" Nullable="true"/>`;
  const types: string[] = [];
  const sets: string[] = [];
  for (const [name, s] of Object.entries(spec)) {
    const parts = Object.entries(s.parts ?? {});
    types.push(`<EntityType Name="${name}"><Key><PropertyRef Name="Ref_Key"/></Key>${s.props.map(prop).join('')}${parts.map(([part]) => `<Property Name="${part}" Type="Collection(StandardODATA.${name}_${part}_RowType)" Nullable="false"/>`).join('')}</EntityType>`);
    sets.push(`<EntitySet Name="${name}" EntityType="StandardODATA.${name}"/>`);
    for (const [part, props] of parts) {
      types.push(`<ComplexType Name="${name}_${part}_RowType">${props.map(prop).join('')}</ComplexType>`);
      types.push(`<EntityType Name="${name}_${part}"><Key><PropertyRef Name="Ref_Key"/><PropertyRef Name="LineNumber"/></Key>${['Ref_Key', ...props].map(prop).join('')}</EntityType>`);
      sets.push(`<EntitySet Name="${name}_${part}" EntityType="StandardODATA.${name}_${part}"/>`);
    }
  }
  return '<?xml version="1.0" encoding="UTF-8"?><edmx:Edmx xmlns:edmx="http://schemas.microsoft.com/ado/2007/06/edmx" Version="1.0">'
    + '<edmx:DataServices xmlns:m="http://schemas.microsoft.com/ado/2007/08/dataservices/metadata" m:DataServiceVersion="3.0">'
    + `<Schema xmlns="http://schemas.microsoft.com/ado/2009/11/edm" Namespace="StandardODATA">${types.join('')}`
    + `<EntityContainer Name="StandardODATA" m:IsDefaultEntityContainer="true">${sets.join('')}</EntityContainer></Schema></edmx:DataServices></edmx:Edmx>`;
}

/** A saved real response (fixtures/odata/<name>). */
export const sample = (name: string): string => readFileSync(new URL(`./${name}`, import.meta.url), 'utf8');
export const sampleJson = <T = Record<string, unknown>>(name: string): T => JSON.parse(sample(name)) as T;

export type Seen = { method: string; path: string; query: URLSearchParams; headers: IncomingMessage['headers']; body: Record<string, unknown> | null };
type Obj = Record<string, unknown>;

export type FakeOptions = {
  spec?: MetadataSpec;
  user?: string;
  password?: string;
};

const version = (n: number): string => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64BE(BigInt(n));
  return b.toString('base64');
};

/** The real XML envelope (42clouds sample) for a code and message. */
const xmlError = (code: number, message: string): string =>
  `<m:error xmlns:m="http://schemas.microsoft.com/ado/2007/08/dataservices/metadata">\n <m:code>${code}</m:code>\n <m:message>${message}</m:message>\n </m:error>`;
const jsonError = (code: number | '', message: string): string => JSON.stringify({ 'odata.error': { code: String(code), message: { lang: 'ru', value: message } } });

/** One `$filter` condition against an object: `A eq 'x'`, `guid'…'`, `datetime'…'`, `cast(guid'…', 'Catalog_X')`, true/false, numbers. */
function matches(obj: Obj, filter: string): boolean {
  const conditions = filter.replace(/^\((.*)\)$/, '$1').split(/\s+and\s+/).map((c) => c.trim().replace(/^\((.*)\)$/, '$1'));
  return conditions.every((c) => {
    const m = /^(\S+)\s+eq\s+(.+)$/.exec(c);
    if (!m) throw new Error(`unsupported filter ${c}`);
    const [, attr = '', raw = ''] = m;
    const cast = /^cast\(guid'([^']+)',\s*'([^']+)'\)$/.exec(raw);
    const type = obj[`${attr}_Type`];
    if (cast) return obj[attr] === cast[1] && typeof type === 'string' && type.endsWith(cast[2] ?? '');
    const lit = /^(?:guid|datetime)?'((?:[^']|'')*)'$/.exec(raw);
    const value: unknown = lit ? (lit[1] ?? '').replace(/''/g, "'") : raw === 'true' ? true : raw === 'false' ? false : Number(raw);
    const have = obj[attr] ?? (attr === 'IsFolder' || attr === 'DeletionMark' ? false : undefined);
    return have === value;
  });
}

export class FakeOData {
  readonly seen: Seen[] = [];
  readonly store = new Map<string, Obj[]>();
  /** Entity sets whose list answers 401 without allowedOnly=true; rows with `_restricted` are then hidden. */
  readonly rls = new Set<string>();
  /** Entity sets outside the composition although $metadata still lists them: writes answer 403. */
  readonly unpublished = new Set<string>();
  /** The next PATCHes find the object saved by someone else in between (412). */
  concurrentEdits = 0;
  /** Post() refuses with 500 and this text. */
  postRefusal: string | null = null;
  /** Writes are answered with a redirect (an http base behind an https proxy). */
  redirectWrites: string | null = null;
  /** The created object comes back without its tabular parts (what a base answers when the part is not written). */
  loseRows = false;
  /** A refusal for a POST body (400 with the JSON envelope), or null to accept. */
  refusePost: ((set: string, body: Obj) => { code: number | ''; message: string } | null) | null = null;
  metadata: string;
  private server!: Server;
  base = '';
  private versions = 0;

  constructor(private readonly options: FakeOptions = {}) {
    this.metadata = metadataXml(options.spec ?? BP_UZ_SPEC);
  }

  async start(): Promise<this> {
    this.server = createServer((req, res) => {
      let raw = '';
      req.on('data', (c: Buffer) => { raw += c.toString('utf8'); });
      req.on('end', () => {
        try {
          this.handle(req, res, raw);
        } catch (error) {
          if (!res.headersSent) res.writeHead(500).end(String(error));
        }
      });
    });
    await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', resolve));
    this.base = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}/base`;
    return this;
  }

  close(): Promise<void> {
    this.server.closeAllConnections();
    return new Promise((resolve) => this.server.close(() => resolve()));
  }

  /** Puts objects into an entity set (catalogue rows the client will look up). */
  seed(set: string, rows: Obj[]): Obj[] {
    const list = this.store.get(set) ?? [];
    const made = rows.map((r) => ({ Ref_Key: randomUUID(), DataVersion: version(++this.versions), DeletionMark: false, ...r }));
    list.push(...made);
    this.store.set(set, list);
    return made;
  }

  writes(): Seen[] {
    return this.seen.filter((s) => s.method !== 'GET');
  }

  private root(): string {
    return `${this.base}/odata/standard.odata`;
  }

  private send(res: ServerResponse, status: number, body: string | Obj | null, headers: Record<string, string> = {}): void {
    const text = body === null ? '' : typeof body === 'string' ? body : JSON.stringify(body);
    const type = typeof body === 'string' && body.startsWith('<') ? 'application/xml' : 'application/json';
    res.writeHead(status, { ...(text ? { 'content-type': `${type};charset=utf-8` } : {}), ...headers }).end(text);
  }

  private handle(req: IncomingMessage, res: ServerResponse, raw: string): void {
    const url = new URL(req.url ?? '/', 'http://fake');
    const prefix = '/base/odata/standard.odata/';
    const path = decodeURIComponent(url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length) : url.pathname);
    let body: Obj | null = null;
    try { body = raw ? JSON.parse(raw) as Obj : null; } catch { body = null; }
    this.seen.push({ method: req.method ?? '', path, query: url.searchParams, headers: req.headers, body });
    const want = `Basic ${Buffer.from(`${this.options.user ?? 'odata'}:${this.options.password ?? 's3cret'}`).toString('base64')}`;
    if (req.headers.authorization !== want) return this.send(res, 401, null);
    if (path === '$metadata') return this.send(res, 200, this.metadata);
    if (this.redirectWrites && req.method !== 'GET') return this.send(res, 301, null, { location: encodeURI(this.redirectWrites) });

    const m = /^([^(/]+)(?:\(guid'([^']+)'\))?(?:\/(\w+)\(\))?$/.exec(path);
    if (!m) return this.send(res, 400, xmlError(6, 'Неверный URL'));
    const [, set = '', ref, method] = m;
    const published = this.metadata.includes(`<EntitySet Name="${set}"`);
    if (!published) return this.send(res, 400, xmlError(8, `Тип сущности "${set}" не найден`));
    const list = this.store.get(set) ?? [];
    const find = (): Obj | undefined => list.find((o) => o['Ref_Key'] === ref);
    const element = (o: Obj): Obj => ({ 'odata.metadata': `${this.root()}/$metadata#${set}/@Element`, ...o });

    if (req.method === 'DELETE') {
      // 1C deletes physically, without a deletion mark (1C:Fresh guide 6.3.6). The client must never get here.
      this.store.set(set, list.filter((o) => o['Ref_Key'] !== ref));
      return this.send(res, 204, null);
    }
    if (req.method === 'GET' && !ref) {
      if (this.rls.has(set) && url.searchParams.get('allowedOnly') !== 'true') return this.send(res, 401, xmlError(20, 'Ошибка прав доступа'));
      let rows = list.filter((o) => !(this.rls.has(set) && o['_restricted']));
      const filter = url.searchParams.get('$filter');
      if (filter) rows = rows.filter((o) => matches(o, filter));
      if (url.searchParams.get('$orderby') === 'Ref_Key') rows = [...rows].sort((a, b) => String(a['Ref_Key']).localeCompare(String(b['Ref_Key'])));
      const total = rows.length;
      const skip = Number(url.searchParams.get('$skip') ?? 0);
      const top = url.searchParams.has('$top') ? Number(url.searchParams.get('$top')) : rows.length;
      rows = rows.slice(skip, skip + top);
      const select = url.searchParams.get('$select')?.split(',');
      const shown = rows.map((o) => Object.fromEntries(Object.entries(o).filter(([k]) => !k.startsWith('_') && (!select || select.includes(k)))));
      return this.send(res, 200, {
        'odata.metadata': `${this.root()}/$metadata#${set}`,
        ...(url.searchParams.get('$inlinecount') === 'allpages' ? { 'odata.count': String(total) } : {}),
        value: shown,
      });
    }
    if (req.method === 'GET') {
      const o = find();
      return o ? this.send(res, 200, element(o)) : this.send(res, 404, xmlError(9, `Экземпляр сущности "${set}" не найден по переданному ключу.`));
    }
    if (req.method === 'POST' && ref && method) {
      const o = find();
      if (!o) return this.send(res, 404, xmlError(9, `Экземпляр сущности "${set}" не найден по переданному ключу.`));
      if (method !== 'Post' && method !== 'Unpost') return this.send(res, 400, xmlError(11, 'Метод не найден'));
      if (method === 'Post' && this.postRefusal) return this.send(res, 500, jsonError('', this.postRefusal));
      o['Posted'] = method === 'Post';
      return this.send(res, 200, null);
    }
    if (req.method === 'POST') {
      if (/_[^_]+$/.test(set) && [...this.metadata.matchAll(/<EntitySet Name="([^"]+)"/g)].some((x) => set.startsWith(`${x[1]}_`))) {
        return this.send(res, 400, jsonError(13, 'Создание строк табличных частей напрямую не поддерживается'));
      }
      if (this.unpublished.has(set)) return this.send(res, 403, 'Объект не включен в состав стандартного интерфейса OData');
      const refused = this.refusePost?.(set, body ?? {});
      if (refused) return this.send(res, 400, jsonError(refused.code, refused.message));
      const created: Obj = { Ref_Key: randomUUID(), DataVersion: version(++this.versions), DeletionMark: false, ...(set.startsWith('Document_') ? { Posted: false } : {}) };
      for (const [k, v] of Object.entries(body ?? {})) {
        if (k === 'Ref_Key' || k === 'DataVersion') continue;
        if (Array.isArray(v)) {
          // mista 828664: rows sent with their own Ref_Key leave the document with an empty table.
          const keyed = v.some((r) => r && typeof r === 'object' && 'Ref_Key' in (r as Obj));
          created[k] = keyed || this.loseRows ? [] : v.map((r, i) => ({ ...(r as Obj), LineNumber: typeof (r as Obj)['LineNumber'] === 'string' ? (r as Obj)['LineNumber'] : String(i + 1) }));
        } else created[k] = v;
      }
      list.push(created);
      this.store.set(set, list);
      return this.send(res, 201, element(created), { location: encodeURI(`${this.root()}/${set}(guid'${String(created['Ref_Key'])}')`) });
    }
    if (req.method === 'PATCH' && ref) {
      const o = find();
      if (!o) return this.send(res, 404, xmlError(9, `Экземпляр сущности "${set}" не найден по переданному ключу.`));
      if (this.concurrentEdits > 0) {
        // Someone saved the object between the client's read and its write.
        this.concurrentEdits--;
        o['DataVersion'] = version(++this.versions);
      }
      const ifMatch = req.headers['if-match'];
      if (ifMatch && ifMatch !== o['DataVersion']) return this.send(res, 412, xmlError(4, 'Объект изменен другим пользователем'));
      for (const [k, v] of Object.entries(body ?? {})) if (!k.includes('@') && k !== 'Ref_Key') o[k] = v; // a tabular part is replaced whole
      o['DataVersion'] = version(++this.versions);
      return this.send(res, 200, element(o));
    }
    return this.send(res, 400, xmlError(19, 'Использованный HTTP-метод запрещен в данном контексте'));
  }
}

export async function startFakeOData(options: FakeOptions = {}): Promise<FakeOData> {
  return new FakeOData(options).start();
}
