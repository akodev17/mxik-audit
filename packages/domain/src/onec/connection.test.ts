// Which 1C hosts the server may call and the fetch pinned to the checked address (F20: DNS
// rebinding, missing reserved ranges), with a stubbed resolver and a local server. No database.
import assert from 'node:assert/strict';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { DEFAULT_OBJECT_MAP, hostAllowed, hostFetcher, privateAddress, productDocument } from './connection.js';
import { PRODUCTS } from './fixtures/demo-data.js';
import { pinnedFetch, RESPONSE_CAP, type Resolve } from './host-guard.js';

const PROD = { NODE_ENV: 'production' };

/** A resolver that answers `answers` in turn (the last one again after that) and counts its calls. */
function resolver(...answers: string[][]): Resolve & { calls: number } {
  const fn = Object.assign((_host: string) => {
    const now = answers[Math.min(fn.calls, answers.length - 1)] ?? [];
    fn.calls++;
    return Promise.resolve(now.map((address) => ({ address, family: address.includes(':') ? 6 : 4 })));
  }, { calls: 0 });
  return fn;
}

describe('privateAddress', () => {
  it('refuses loopback, private, shared, link-local, benchmark, documentation, multicast and reserved addresses', () => {
    for (const ip of [
      '127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '100.64.0.1', '169.254.169.254', '0.0.0.0',
      '192.0.0.8', '198.18.0.1', '198.19.255.254', '224.0.0.1', '239.255.255.250', '240.0.0.1', '255.255.255.255', '192.0.2.1', '203.0.113.9',
      '::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'ff02::1', '2001:db8::1', '64:ff9b::a00:1',
      '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:10.0.0.1', '::ffff:c612:1', 'not-an-ip',
    ]) assert.equal(privateAddress(ip), true, ip);
  });

  it('allows public addresses next to those ranges', () => {
    for (const ip of ['8.8.8.8', '93.184.216.34', '198.17.255.255', '198.20.0.1', '192.0.1.1', '172.32.0.1', '223.255.255.255', '2a00:1450:4001::1', '::ffff:8.8.8.8']) {
      assert.equal(privateAddress(ip), false, ip);
    }
  });
});

describe('hostFetcher', () => {
  it('development and tests use the given fetch without resolving', async () => {
    const resolve = resolver(['127.0.0.1']);
    assert.equal(await hostFetcher('http://localhost:8080/base', { NODE_ENV: 'test' }, resolve, fetch), fetch);
    assert.equal(resolve.calls, 0);
  });

  it('in production refuses a name with any private answer, no answer or a failed lookup, and a private literal', async () => {
    assert.equal(await hostFetcher('http://onec.example.uz', PROD, resolver(['10.0.0.5'])), null);
    assert.equal(await hostFetcher('http://onec.example.uz', PROD, resolver(['93.184.216.34', '127.0.0.1'])), null);
    assert.equal(await hostFetcher('http://onec.example.uz', PROD, resolver([])), null);
    assert.equal(await hostFetcher('http://onec.example.uz', PROD, () => Promise.reject(new Error('ENOTFOUND'))), null);
    assert.equal(await hostFetcher('http://198.18.0.10/base', PROD, resolver()), null);
    assert.equal(await hostFetcher('http://[::ffff:127.0.0.1]/base', PROD, resolver()), null);
    assert.equal(await hostAllowed('http://onec.example.uz', PROD, resolver(['224.0.0.251'])), false);
  });

  it('in production resolves a public name once and answers a fetch pinned to it', async () => {
    const resolve = resolver(['93.184.216.34'], ['127.0.0.1']);
    const pinned = await hostFetcher('https://onec.example.uz/base', PROD, resolve);
    assert.equal(typeof pinned, 'function');
    assert.notEqual(pinned, fetch);
    assert.equal(resolve.calls, 1, 'the name is resolved for the check only');
    assert.equal(await hostAllowed('https://onec.example.uz/base', PROD, resolver(['93.184.216.34'])), true);
  });
});

describe('the pinned fetch', () => {
  let server: Server;
  let port = 0;
  const seen: { method: string; url: string; headers: IncomingHttpHeaders; body: string }[] = [];

  before(async () => {
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (c: Buffer) => { body += c.toString('utf8'); });
      req.on('end', () => {
        seen.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body });
        if (req.url?.startsWith('/slow')) return;
        if (req.url?.startsWith('/big/')) {
          // A $metadata of the given size whose EntityContainer comes last, as 1C writes it.
          const size = Number(req.url.slice(5));
          res.writeHead(200, { 'content-type': 'application/xml' }).end(`${' '.repeat(size - 32)}<EntitySet Name="Document_X"/>`.padEnd(size, ' '));
          return;
        }
        if (req.method === 'POST') {
          res.writeHead(201, { 'content-type': 'application/json' }).end('{"Ref_Key":"guid-1"}');
          return;
        }
        res.writeHead(200, { 'content-type': 'application/xml' }).end('<EntitySet Name="Catalog_Номенклатура"/>');
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
  });
  after(() => {
    server.closeAllConnections();
    server.close();
  });

  it('connects to the checked address, never the name: a rebinding answer after the check is not used', async () => {
    // Allowed private hosts (a self-hosted install), so the local server is a valid target; the name exists nowhere.
    const resolve = resolver(['127.0.0.1'], ['203.0.113.1']);
    const pinned = await hostFetcher(`http://onec.rebind.test:${port}`, { ...PROD, ONEC_ALLOW_PRIVATE_HOSTS: '1' }, resolve);
    assert.ok(pinned);
    const res = await pinned(`http://onec.rebind.test:${port}/odata/standard.odata/$metadata`, { headers: { authorization: 'Basic eDp5', accept: 'application/xml' }, redirect: 'manual' });
    assert.equal(res.status, 200);
    assert.equal(await res.text(), '<EntitySet Name="Catalog_Номенклатура"/>');
    const posted = await pinned(`http://onec.rebind.test:${port}/odata/standard.odata/Catalog?$format=json`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"Description":"Guruch"}' });
    assert.equal(posted.status, 201);
    assert.equal(await posted.text(), '{"Ref_Key":"guid-1"}');
    assert.equal(resolve.calls, 1, 'resolved once, for the check');
    assert.equal(seen[0]?.headers.host, `onec.rebind.test:${port}`, 'the Host header stays the configured name');
    assert.equal(seen[0]?.headers.authorization, 'Basic eDp5');
    assert.deepEqual([seen[1]?.method, seen[1]?.body], ['POST', '{"Description":"Guruch"}']);
  });

  it('fails like fetch: a refused connection carries its code, a timeout stays a timeout', async () => {
    const closed = pinnedFetch('127.0.0.1', 4);
    await assert.rejects(closed('http://onec.rebind.test:1/'), (e: unknown) => e instanceof TypeError && (e.cause as { code?: string }).code === 'ECONNREFUSED');
    await assert.rejects(pinnedFetch('127.0.0.1', 4)(`http://onec.rebind.test:${port}/slow`, { signal: AbortSignal.timeout(100) }),
      (e: unknown) => e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError'));
  });

  it('a body past the cap is refused, never cut: a 12 MB $metadata arrives whole', async () => {
    // Review 30 Oct: the 8 MB cap cut real $metadata (10+ MB) before its EntityContainer and answered 200, so discovery
    // found no entity sets at all. The cap is above the 20 MB odata.ts reads, and a body past it is an error.
    const pinned = pinnedFetch('127.0.0.1', 4);
    const whole = await (await pinned(`http://onec.rebind.test:${port}/big/${12 * 1024 * 1024}`)).text();
    assert.equal(whole.length, 12 * 1024 * 1024);
    assert.ok(whole.includes('<EntitySet Name="Document_X"/>'));
    await assert.rejects(pinned(`http://onec.rebind.test:${port}/big/${RESPONSE_CAP + 1024}`), (e: unknown) => e instanceof TypeError && /larger than/.test(String((e.cause as Error).message)));
  });
});

// Every spelling of a private address the URL parser or a DNS answer can produce (Phase C F3, merged with S6).

const PRIVATE = [
  // dotted, shorthand, octal, hex and decimal IPv4
  '127.0.0.1', '127.1', '0177.0.0.1', '0x7f000001', '0x7f.0.0.1', '2130706433', '0.0.0.0', '10.0.0.5', '172.16.0.1', '172.31.255.255',
  '192.168.1.1', '169.254.169.254', '100.64.0.1', '100.127.255.255',
  // IPv6 itself
  '::1', '::', '[2001:db8::1]', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'FE80::1%eth0', '[::1]',
  // IPv4 carried in IPv6: mapped (dotted and the hex form new URL() writes), compatible, NAT64
  '::ffff:127.0.0.1', '::ffff:7f00:1', '[::ffff:7f00:1]', '0:0:0:0:0:ffff:7f00:1', '::ffff:169.254.169.254', '::ffff:a9fe:a9fe',
  '::ffff:10.0.0.5', '::ffff:a00:5', '::ffff:172.16.0.1', '::ffff:ac10:1', '::ffff:192.168.1.1', '::ffff:c0a8:101', '::ffff:100.64.0.1', '::ffff:6440:1',
  '::ffff:0.0.0.0', '::127.0.0.1', '::7f00:1', '64:ff9b::7f00:1', '64:ff9b::127.0.0.1',
];
const PUBLIC = [
  '8.8.8.8', '1.1.1.1', '172.32.0.1', '172.15.0.1', '100.128.0.1', '100.63.255.255', '192.169.0.1', '11.0.0.1',
  '2001:4860:4860::8888', '2a00:1450:4001::1',
  '::ffff:8.8.8.8', '::ffff:808:808',
];
const NOT_ADDRESSES = ['', 'localhost', 'example.com', '1.2.3.4.5', '256.1.1.1', '08.1.1.1', '0x', '::ffff:1.2.3', 'gggg::1', '1:2:3:4:5:6:7:8:9', '1::2::3', '127.0.0.1 '.repeat(2)];

describe('1C host guard: privateAddress', () => {
  it('knows a private address in every spelling', () => {
    for (const ip of PRIVATE) assert.equal(privateAddress(ip), true, ip);
  });

  it('lets a public address through, in IPv4 and IPv6 and carried in IPv6', () => {
    for (const ip of PUBLIC) assert.equal(privateAddress(ip), false, ip);
  });

  it('treats what is not an address as private', () => {
    for (const s of NOT_ADDRESSES) assert.equal(privateAddress(s), true, JSON.stringify(s));
  });
});

describe('1C host guard: hostAllowed', () => {
  const production = { NODE_ENV: 'production' };

  it('in production refuses the loopback and internal literals in the forms new URL() produces (Phase C F3)', async () => {
    const refused = [
      'http://127.0.0.1/', 'http://127.1/', 'http://0x7f000001/', 'http://0177.0.0.1/', 'http://2130706433/',
      'http://[::1]/', 'http://[::ffff:127.0.0.1]/', 'http://[::ffff:7f00:1]/', 'http://[::ffff:169.254.169.254]/', 'http://[::ffff:a9fe:a9fe]/',
      'http://[::ffff:10.0.0.5]/', 'http://[::ffff:192.168.1.1]:8080/base', 'http://[64:ff9b::7f00:1]/', 'http://[fe80::1]/', 'http://[fd00::1]/',
      'http://10.0.0.5/', 'http://169.254.169.254/latest/meta-data/', 'http://100.64.0.1/',
    ];
    for (const url of refused) assert.equal(await hostAllowed(url, production), false, url);
  });

  it('in production allows a public literal', async () => {
    for (const url of ['http://8.8.8.8:8080/base', 'https://[2001:4860:4860::8888]/base', 'http://[::ffff:8.8.8.8]/']) assert.equal(await hostAllowed(url, production), true, url);
  });

  it('a self-hosted install may opt in, and development allows everything', async () => {
    assert.equal(await hostAllowed('http://[::ffff:7f00:1]/', { NODE_ENV: 'production', ONEC_ALLOW_PRIVATE_HOSTS: '1' }), true);
    assert.equal(await hostAllowed('http://127.0.0.1/', {}), true);
    assert.equal(await hostAllowed('http://[::ffff:7f00:1]/', { NODE_ENV: 'development' }), true);
  });
});

describe('product document for OData', () => {
  it('a code the object map sends nowhere is noted on the record, not dropped silently (onec §8.2)', () => {
    // Review 30 Oct: the default map has no ИКПУ, package or barcode attribute, and the product went without them unsaid.
    const [withCodes, , withoutCodes] = PRODUCTS;
    assert.deepEqual(productDocument(DEFAULT_OBJECT_MAP, withCodes!).notes, ['mxik_not_sent', 'packageCode_not_sent', 'barcode_not_sent']);
    assert.deepEqual(productDocument(DEFAULT_OBJECT_MAP, withoutCodes!).notes, []);
    const map = structuredClone(DEFAULT_OBJECT_MAP);
    map.product.fields = { ...map.product.fields, mxik: 'КодИКПУ' };
    const mapped = productDocument(map, withCodes!);
    assert.equal(mapped.body['КодИКПУ'], '01701001001000000');
    assert.deepEqual(mapped.notes, ['packageCode_not_sent', 'barcode_not_sent']);
  });
});
