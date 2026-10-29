// The 1C host guard: a private address is private in every spelling the URL parser or a DNS answer
// can produce, so the API cannot be used as a proxy into its own network (Phase C F3).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { hostAllowed, privateAddress } from './connection.js';

const PRIVATE = [
  // dotted, shorthand, octal, hex and decimal IPv4
  '127.0.0.1', '127.1', '0177.0.0.1', '0x7f000001', '0x7f.0.0.1', '2130706433', '0.0.0.0', '10.0.0.5', '172.16.0.1', '172.31.255.255',
  '192.168.1.1', '169.254.169.254', '100.64.0.1', '100.127.255.255',
  // IPv6 itself
  '::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'FE80::1%eth0', '[::1]',
  // IPv4 carried in IPv6: mapped (dotted and the hex form new URL() writes), compatible, NAT64
  '::ffff:127.0.0.1', '::ffff:7f00:1', '[::ffff:7f00:1]', '0:0:0:0:0:ffff:7f00:1', '::ffff:169.254.169.254', '::ffff:a9fe:a9fe',
  '::ffff:10.0.0.5', '::ffff:a00:5', '::ffff:172.16.0.1', '::ffff:ac10:1', '::ffff:192.168.1.1', '::ffff:c0a8:101', '::ffff:100.64.0.1', '::ffff:6440:1',
  '::ffff:0.0.0.0', '::127.0.0.1', '::7f00:1', '64:ff9b::7f00:1', '64:ff9b::127.0.0.1',
];
const PUBLIC = [
  '8.8.8.8', '1.1.1.1', '172.32.0.1', '172.15.0.1', '100.128.0.1', '100.63.255.255', '192.169.0.1', '11.0.0.1',
  '2001:4860:4860::8888', '2a00:1450:4001::1', '[2001:db8::1]',
  '::ffff:8.8.8.8', '::ffff:808:808', '64:ff9b::808:808',
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
