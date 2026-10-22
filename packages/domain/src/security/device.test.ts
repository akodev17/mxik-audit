import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { deviceLabel } from './device.js';

describe('device label for the sessions list', () => {
  it('names the browser with its major version, then the system', () => {
    assert.equal(deviceLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'), 'Chrome 141, Windows');
    assert.equal(deviceLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0'), 'Edge 141, Windows');
    assert.equal(deviceLabel('Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:132.0) Gecko/20100101 Firefox/132.0'), 'Firefox 132, macOS');
    assert.equal(deviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'), 'Safari 18, iOS');
  });

  it('falls back to what it can read, or nothing', () => {
    assert.equal(deviceLabel('curl/8.0'), null);
    assert.equal(deviceLabel('Something (Linux)'), 'Linux');
    assert.equal(deviceLabel(null), null);
  });
});
