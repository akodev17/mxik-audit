// Which 1C hosts the server may call and the fetch pinned to the checked address (F20: DNS
// rebinding, missing reserved ranges), with a stubbed resolver and a local server. No database.
import assert from 'node:assert/strict';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { hostAllowed, hostFetcher, privateAddress } from './connection.js';
import { pinnedFetch, type Resolve } from './host-guard.js';

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
});
