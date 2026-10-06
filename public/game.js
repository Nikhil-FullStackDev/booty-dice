// Booty Dice rules engine — shared by server (authoritative) and browser (constants).
(function (root) {
  const COLORS = ['#d64545', '#3d7be0', '#3aa66b', '#a46be0', '#e88a2e', '#22a6a3'];
  const FACES = ['D', 'X', 'J', 'C', 'W', 'S']; // doubloon, X marks, jolly roger, cutlass, walk the plank, shield
  const START_GOLD = 5, START_LIVES = 10, TOTAL_GOLD = 100, TOTAL_SHIELDS = 30, WIN_GOLD = 25, RESULT_MS = 3800, DICE = 6;

  const say = (s, m) => { s.log.push(m); s.turnLog.push(m); if (s.log.length > 60) s.log.shift(); };
  const alive = s => s.players.filter(p => p.alive);
  const others = (s, id) => s.players.filter(p => p.alive && p.id !== id);
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

  function create(players, opts = {}) {
    const rng = opts.rng || Math.random;
    const s = {
      players: players.map((p, i) => ({ id: i, name: p.name, bot: !!p.bot, color: COLORS[i % COLORS.length], lives: START_LIVES, shields: 0, gold: START_GOLD, alive: true })),
      treasure: TOTAL_GOLD - START_GOLD * players.length, chest: TOTAL_SHIELDS,
      turn: Math.floor(rng() * players.length), phase: 'roll', dice: Array(DICE).fill(null), rolls: 0, held: Array(DICE).fill(false),
      slots: [], after: null, turns: 1, until: 0, winner: -1, log: [], turnLog: [], result: null, rng, resultMs: opts.resultMs ?? RESULT_MS,
    };
    say(s, `${s.players[s.turn].name} sets sail first.`);
    return s;
  }

  function waitingOn(s) { return s.phase === 'roll' || s.phase === 'target' ? [s.turn] : []; }

  function loseLife(s, v, by, n = 1) {
    for (let i = 0; i < n && v.alive; i++) {
      v.lives--;
      if (v.lives <= 0) kill(s, v, by);
    }
  }
  // Captain's Plunder: the pirate who eliminates someone on their own turn takes all their doubloons.
  function kill(s, v, by) {
    v.alive = false; v.lives = 0;
    const killer = by >= 0 && by === s.turn && s.players[by].alive ? s.players[by] : null;
    if (killer && v.gold) { killer.gold += v.gold; say(s, `${killer.name} plunders ${plural(v.gold, 'doubloon')} from ${v.name}!`); }
    else s.treasure += v.gold;
    v.gold = 0; s.chest += v.shields; v.shields = 0;
    say(s, `☠ ${v.name} is out of the game!`);
  }
  function give(s, p, n) { const d = Math.min(n, p.gold); p.gold -= d; s.treasure += d; return d; }

  function validTargets(s, kind) {
    return others(s, s.turn).filter(p => kind === 'steal' ? p.gold > 0 : true).map(p => p.id);
  }
  function applySlot(s, kind, t) {
    const me = s.players[s.turn], v = s.players[t];
    if (kind === 'steal') { v.gold--; me.gold++; say(s, `${me.name} steals 1 doubloon from ${v.name}.`); }
    else if (v.shields > 0) { v.shields--; s.chest++; say(s, `${me.name} slashes ${v.name} — a Shield breaks!`); }
    else { say(s, `${me.name} cuts ${v.name} — lose a Life!`); loseLife(s, v, me.id); }
  }

  function roll(s, hold) {
    if (s.rolls === 0) hold = [];
    s.held = Array.from({ length: DICE }, (_, i) => s.rolls > 0 && hold.includes(i));
    for (let i = 0; i < DICE; i++) if (!s.held[i]) s.dice[i] = FACES[Math.floor(s.rng() * 6)];
    s.rolls++;
  }

  function resolve(s) {
    const me = s.players[s.turn], d = s.dice;
    const c = {}; FACES.forEach(f => { c[f] = d.filter(x => x === f).length; });
    const bb = FACES.every(f => c[f] === 1), mutiny = !bb && c.W >= 3, wreck = !bb && c.X >= 3;
    s.slots = []; s.after = { bb, mutiny, wreck, W: c.W, X: c.X, S: c.S };
    s.phase = 'resolve';
    if (bb) say(s, `${me.name} rolls BLACKBEARD'S CURSE!`);
    else {
      if (mutiny) say(s, `${me.name} calls MUTINY!`);
      if (wreck) say(s, `${me.name} causes a SHIPWRECK!`);
      if (c.D) { const t = Math.min(2 * c.D, s.treasure); me.gold += t; s.treasure -= t; say(s, `${me.name} takes ${plural(t, 'doubloon')} from the Buried Treasure.`); }
      if (c.X && !wreck) { const g = give(s, me, 2 * c.X); say(s, `${me.name} buries ${plural(g, 'doubloon')} at X marks the spot.`); }
      for (let i = 0; i < c.J * 2; i++) s.slots.push('steal');
      for (let i = 0; i < c.C; i++) s.slots.push('cut');
    }
    advance(s);
  }

  // Run queued attacks; pause only when the roller has a real choice to make.
  function advance(s) {
    while (s.slots.length) {
      const kind = s.slots[0], t = validTargets(s, kind);
      if (!t.length) { s.slots.shift(); continue; }
      if (t.length > 1) { s.phase = 'target'; return; }
      s.slots.shift(); applySlot(s, kind, t[0]);
    }
    finish(s);
  }

  function finish(s) {
    const me = s.players[s.turn], a = s.after, rest = others(s, me.id);
    if (a.bb) {
      rest.forEach(p => { loseLife(s, p, me.id, 2); give(s, p, 5); });
      say(s, `All other pirates lose 2 Lives and pay 5 doubloons!`);
    } else {
      if (a.W && !a.mutiny) { loseLife(s, me, -1, a.W); say(s, `${me.name} walks the plank${a.W > 1 ? ` ×${a.W}` : ''} and loses ${plural(a.W, 'Life')}.`); }
      if (a.S) { const t = Math.min(a.S, s.chest); me.shields += t; s.chest -= t; if (t) say(s, `${me.name} takes ${plural(t, 'Shield')}.`); }
      if (a.mutiny) { const n = a.W - 2; rest.forEach(p => loseLife(s, p, me.id, n)); say(s, `Mutiny! All other pirates lose ${plural(n, 'Life')}.`); }
      if (a.wreck) { rest.forEach(p => give(s, p, a.X)); say(s, `Shipwreck! All other pirates give ${plural(a.X, 'doubloon')}.`); }
    }
    s.after = null;
    const live = alive(s);
    if (me.alive && me.gold >= WIN_GOLD) s.winner = me.id;
    else if (live.length <= 1) s.winner = live.length ? live[0].id : me.id;
    s.result = { by: s.turn, lines: s.turnLog.slice() };
    if (s.winner >= 0) { s.phase = 'over'; say(s, `🏆 ${s.players[s.winner].name} wins!`); }
    else { s.phase = 'result'; s.until = Date.now() + s.resultMs; }
  }

  function act(s, id, m, now = Date.now()) {
    const p = s.players[id], t = m && m.type;
    if (!p || !p.alive) return { error: 'You are out of the game' };
    if (!waitingOn(s).includes(id)) return { error: 'Not your turn' };
    if (s.phase === 'roll') {
      if (t === 'roll') {
        if (s.rolls >= 3) return { error: 'No rolls left' };
        const hold = Array.isArray(m.hold) ? m.hold.map(Number).filter(i => i >= 0 && i < DICE) : [];
        if (s.rolls === 0) s.turnLog = [];
        roll(s, hold);
        if (s.rolls === 3) resolve(s);
        return { ok: true };
      }
      if (t === 'stop') {
        if (s.rolls < 1) return { error: 'Roll at least once' };
        resolve(s); return { ok: true };
      }
    } else if (s.phase === 'target' && t === 'target') {
      const kind = s.slots[0];
      if (!validTargets(s, kind).includes(Number(m.target))) return { error: kind === 'steal' ? 'Pick a pirate with doubloons' : 'Pick another pirate' };
      s.slots.shift(); applySlot(s, kind, Number(m.target)); advance(s);
      return { ok: true };
    }
    return { error: 'Invalid move' };
  }

  // Advance result screens. Returns true if state changed.
  function tick(s, now = Date.now()) {
    if (s.phase !== 'result' || now < s.until) return false;
    let n = s.turn;
    do { n = (n + 1) % s.players.length; } while (!s.players[n].alive);
    s.turn = n; s.turns++; s.phase = 'roll'; s.rolls = 0; s.held = Array(DICE).fill(false); s.dice = Array(DICE).fill(null); s.turnLog = [];
    return true;
  }

  function view(s, idx) {
    const kind = s.phase === 'target' ? s.slots[0] : null;
    return {
      players: s.players, treasure: s.treasure, chest: s.chest, turn: s.turn, phase: s.phase, dice: s.dice, held: s.held, rolls: s.rolls,
      target: kind ? { kind, valid: validTargets(s, kind), left: s.slots.length } : null,
      result: s.result, winner: s.winner, log: s.log.slice(-8), turnLog: s.turnLog, turns: s.turns,
      waiting: waitingOn(s), untilIn: s.phase === 'result' ? Math.max(0, s.until - Date.now()) : 0,
    };
  }

  const api = { COLORS, FACES, WIN_GOLD, START_LIVES, create, act, tick, view, waitingOn, validTargets };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Booty = api;
})(typeof self !== 'undefined' ? self : globalThis);
