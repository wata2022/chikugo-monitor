import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';

for (const file of ['app.js', 'docs/app.js']) {
  test(`${file}: missing values stay missing while real zero remains zero`, () => {
    const element = { addEventListener() {}, classList: { toggle() {} }, setAttribute() {} };
    const context = vm.createContext({
      document: { getElementById: () => element, querySelectorAll: () => [] },
      window: { addEventListener() {} }, navigator: {},
    });
    vm.runInContext(readFileSync(new URL(file, import.meta.url), 'utf8'), context);
    for (const value of ['', '  ', null, undefined, 'NaN', 'Infinity', 'invalid']) {
      context.input = value;
      assert.equal(vm.runInContext('toNumber(input)', context), null);
    }
    for (const [value, expected] of [['0', 0], [0, 0], ['-1.25', -1.25], [' 3.5 ', 3.5]]) {
      context.input = value;
      assert.equal(vm.runInContext('toNumber(input)', context), expected);
    }
    assert.equal(vm.runInContext('formatNumber(toNumber(""), "cm")', context), '--');
    assert.equal(vm.runInContext('normalizeRows(parseCsv("datetime,tide_cm\\n2026-10-22 12:00:00,"))[0].tide', context), null);
  });
}

const source = readFileSync(new URL('cloudflare-worker/update-trigger.js', import.meta.url), 'utf8');
const { default: worker } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
test('Worker authenticates, fails closed, limits dispatches and hides upstream errors', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response(null, { status: 204 }); };
  const env = { GITHUB_TOKEN: 'test-token', UPDATE_KEY: 'test-key' };
  const request = (key = 'test-key') => new Request('https://example.test/', {
    method: 'POST', headers: { authorization: `Bearer ${key}` },
  });
  try {
    assert.equal((await worker.fetch(request('wrong'), env)).status, 401);
    assert.equal((await worker.fetch(request(), env)).status, 503);
    env.UPDATE_RATE_LIMITER = { limit: async () => ({ success: false }) };
    assert.equal((await worker.fetch(request(), env)).status, 429);
    assert.equal(calls, 0);
    env.UPDATE_RATE_LIMITER = { limit: async () => ({ success: true }) };
    assert.equal((await worker.fetch(request(), env)).status, 202);
    assert.equal(calls, 1);
    globalThis.fetch = async () => new Response('sensitive upstream detail', { status: 403 });
    const response = await worker.fetch(request(), env);
    assert.equal(response.status, 502);
    assert.doesNotMatch(await response.text(), /sensitive upstream detail/);
  } finally { globalThis.fetch = originalFetch; }
});
