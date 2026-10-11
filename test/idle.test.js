// A human the table is waiting on must not stall it: after TURN_MS a bot move is played for them
// (two misses in a row put them on the short AWAY_MS clock until they move again).
process.env.TURN_MS = '400';
process.env.AWAY_MS = '250';
const test = require('node:test');
const assert = require('node:assert');
const server = require('../server.js');

test('an idle human is auto-played, the log says so, and the waiting player is sent a countdown', async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (p, b) => fetch(base + '/api/' + p, { method: 'POST', body: JSON.stringify(b) }).then(x => x.json().then(j => ({ status: x.status, ...j })));
  const ctl = new AbortController();
  let room;
  try {
    const host = await post('create', { name: 'Idle' });
    room = { code: host.code, token: host.token };
    for (let i = 0; i < 1; i++) await post('addbot', room);
    // one long-lived stream, like a real client (reconnecting constantly would keep restarting the bots' timer)
    const res = await fetch(`${base}/api/events?code=${room.code}&token=${room.token}`, { signal: ctl.signal });
    const lines = new Set(); let told = false;
    const done = new Promise(resolve => {
      const reader = res.body.getReader(), dec = new TextDecoder();
      let buf = '';
      (async () => {
        try {
          for (;;) {
            const { value, done: end } = await reader.read();
            if (end) return;
            buf += dec.decode(value);
            let i;
            while ((i = buf.indexOf('\n\n')) >= 0) {
              const m = buf.slice(0, i).match(/^data: (.*)$/m); buf = buf.slice(i + 2);
              if (!m) continue;
              const s = JSON.parse(m[1]);
              if (typeof s.idleMsLeft === 'number') told = true;
              if (s.game) s.game.log.forEach(l => lines.add(l));
              if ([...lines].some(l => /ran out of time/.test(l)) && told) return resolve(true);
            }
          }
        } catch { /* aborted */ }
      })();
      setTimeout(() => resolve(false), 15000);
    });
    assert.strictEqual((await post('start', room)).status, 200);
    assert.ok(await done, 'the host was auto-played (log line seen) and was sent a countdown');
  } finally {
    ctl.abort();
    if (room) await post('lobby', room).catch(() => {});
    server.closeAllConnections?.();
    server.close();
  }
});
