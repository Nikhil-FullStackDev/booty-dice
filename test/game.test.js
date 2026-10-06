const test = require('node:test');
const assert = require('node:assert');
const Booty = require('../public/game.js');
const { botMove } = require('../bot.js');

const mk = (n = 3) => {
  const s = Booty.create(Array.from({ length: n }, (_, i) => ({ name: 'P' + i })), { rng: () => 0 });
  s.turn = 0; return s;
};
// Force a roll outcome, then stop.
function play(s, faces) {
  Booty.act(s, s.turn, { type: 'roll' });
  s.dice = faces.split('');
  return Booty.act(s, s.turn, { type: 'stop' });
}

test('setup', () => {
  const s = mk(4);
  assert.strictEqual(s.treasure, 80);
  assert.strictEqual(s.chest, 30);
  assert.ok(s.players.every(p => p.lives === 10 && p.gold === 5));
});

test('doubloon and X marks the spot', () => {
  const s = mk(); play(s, 'DDXSSS');
  assert.strictEqual(s.players[0].gold, 5 + 4 - 2);
  assert.strictEqual(s.players[0].shields, 3);
  assert.strictEqual(s.chest, 27);
});

test('walk the plank costs a life; shields do not help', () => {
  const s = mk(); s.players[0].shields = 2; play(s, 'WSDDDD');
  assert.strictEqual(s.players[0].lives, 9);
});

test('mutiny: 3 planks = 1 life to others, none to you; 4 planks = 2', () => {
  let s = mk(); play(s, 'WWWDDD');
  assert.deepStrictEqual(s.players.map(p => p.lives), [10, 9, 9]);
  s = mk(); play(s, 'WWWWDD');
  assert.deepStrictEqual(s.players.map(p => p.lives), [10, 8, 8]);
});

test('shipwreck: 4 X (example 2) gives 4 each, plus shield and plank', () => {
  const s = mk(); play(s, 'WSXXXX');
  assert.deepStrictEqual(s.players.map(p => p.gold), [5, 1, 1]);
  assert.strictEqual(s.treasure + s.players.reduce((n, p) => n + p.gold, 0), 100);
  assert.strictEqual(s.players[0].lives, 9);
  assert.strictEqual(s.players[0].shields, 1);
});

test('blackbeard curse: all faces', () => {
  const s = mk(); play(s, 'XJCWSD');
  assert.deepStrictEqual(s.players.map(p => p.lives), [10, 8, 8]);
  assert.deepStrictEqual(s.players.map(p => p.gold), [5, 0, 0]);
});

test('cutlass breaks shield first, then takes a life; target phase when choice exists', () => {
  const s = mk(); s.players[1].shields = 1;
  play(s, 'CSDDDD'.replace('S', 'D'));
  assert.strictEqual(s.phase, 'target');
  assert.ok(Booty.act(s, 1, { type: 'target', target: 1 }).error);
  assert.ok(Booty.act(s, 0, { type: 'target', target: 0 }).error);
  Booty.act(s, 0, { type: 'target', target: 1 });
  assert.strictEqual(s.players[1].shields, 0);
  assert.strictEqual(s.players[1].lives, 10);
  assert.strictEqual(s.phase, 'result');
});

test('cutlass with a single opponent auto-resolves; captains plunder', () => {
  const s = mk(2); s.players[1].lives = 1; s.players[1].gold = 7;
  play(s, 'CDDDDD');
  assert.strictEqual(s.players[1].alive, false);
  assert.strictEqual(s.players[0].gold, 22);
  assert.strictEqual(s.winner, 0);
  assert.strictEqual(s.phase, 'over');
});

test('jolly roger steals 2, split or together', () => {
  const s = mk(); s.players[2].gold = 0;
  play(s, 'JDDDDD');
  assert.deepStrictEqual([s.players[0].gold, s.players[1].gold], [17, 3]);
});

test('turn passes after result; dead players skipped; first to 25 wins', () => {
  const s = mk(); s.players[1].alive = false;
  play(s, 'DDDDDD');
  Booty.tick(s, Date.now() + 99999);
  assert.strictEqual(s.turn, 2);
  s.players[2].gold = 24; s.treasure = 50; play(s, 'DDDDDD');
  assert.strictEqual(s.winner, 2);
});

test('walking the plank to death returns doubloons; last pirate standing wins', () => {
  const s = mk(2); s.players[0].lives = 1; s.players[0].gold = 3; const t = s.treasure;
  play(s, 'WDDDDD');
  assert.strictEqual(s.players[0].alive, false);
  assert.strictEqual(s.winner, 1);
  assert.strictEqual(s.treasure, t + 3);
});

test('three rolls max, auto-resolves on the third', () => {
  const s = mk();
  Booty.act(s, 0, { type: 'roll' });
  Booty.act(s, 0, { type: 'roll', hold: [0, 1] });
  Booty.act(s, 0, { type: 'roll', hold: [0] });
  assert.notStrictEqual(s.phase, 'roll');
  assert.ok(Booty.act(s, 0, { type: 'roll' }).error);
});

test('holding keeps dice; cannot stop before rolling; wrong player rejected', () => {
  const s = Booty.create([{ name: 'a' }, { name: 'b' }], { rng: Math.random }); s.turn = 0;
  assert.ok(Booty.act(s, 0, { type: 'stop' }).error);
  assert.ok(Booty.act(s, 1, { type: 'roll' }).error);
  Booty.act(s, 0, { type: 'roll' });
  const before = s.dice.slice();
  Booty.act(s, 0, { type: 'roll', hold: [0, 1, 2] });
  assert.deepStrictEqual(s.dice.slice(0, 3), before.slice(0, 3));
});

test('bots always finish full games with conserved doubloons', () => {
  for (let g = 0; g < 200; g++) {
    const s = Booty.create(Array.from({ length: 2 + (g % 5) }, (_, i) => ({ name: 'b' + i, bot: true })), { resultMs: 0 });
    for (let i = 0; i < 4000 && s.phase !== 'over'; i++) {
      if (s.phase === 'result') { Booty.tick(s, Date.now() + 1); continue; }
      const id = Booty.waitingOn(s)[0];
      const r = Booty.act(s, id, botMove(s, id));
      assert.ok(!r.error, r.error);
      const gold = s.treasure + s.players.reduce((n, p) => n + p.gold, 0);
      assert.strictEqual(gold, 100);
      assert.strictEqual(s.chest + s.players.reduce((n, p) => n + p.shields, 0), 30);
    }
    assert.strictEqual(s.phase, 'over', 'game ended');
  }
});
