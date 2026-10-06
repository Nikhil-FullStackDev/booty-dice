const test = require('node:test');
const assert = require('node:assert');
const server = require('../server.js');

test('static caching, gzip, and room API flow', async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const r = await fetch(base + '/app.js');
    assert.strictEqual(r.status, 200);
    const r2 = await fetch(base + '/app.js', { headers: { 'If-None-Match': r.headers.get('etag') } });
    assert.strictEqual(r2.status, 304);
    assert.match((await fetch(base + '/img/dice-face-cutlass.png')).headers.get('cache-control'), /max-age/);
    assert.strictEqual((await fetch(base + '/%2e%2e/server.js')).status, 404);
    assert.strictEqual((await fetch(base + '/healthz')).status, 200);

    const post = (p, b) => fetch(base + '/api/' + p, { method: 'POST', body: JSON.stringify(b) })
      .then(x => x.json().then(j => ({ status: x.status, ...j })));
    const host = await post('create', { name: 'Host' });
    const room = { code: host.code, token: host.token };
    assert.strictEqual((await post('start', room)).status, 400); // need 2 players
    const guest = await post('join', { name: 'G', code: host.code });
    assert.strictEqual(guest.status, 200);
    assert.strictEqual((await post('start', { code: host.code, token: guest.token })).status, 403);
    assert.strictEqual((await post('start', room)).status, 200);
    assert.strictEqual((await post('join', { name: 'late', code: host.code })).status, 400);
    assert.strictEqual((await post('move', { ...room, move: { type: 'bogus' } })).status, 400);
  } finally {
    server.closeAllConnections?.();
    server.close();
  }
});
