// Pirate bots. They only use what anyone at the table can see: dice, doubloons, lives, shields.
const Booty = require('./public/game.js');

function botMove(s, id) {
  if (s.phase === 'target') return { type: 'target', target: pickTarget(s, id) };
  if (s.rolls === 0) return { type: 'roll' };
  const me = s.players[id], c = {};
  Booty.FACES.forEach(f => { c[f] = s.dice.filter(x => x === f).length; });
  const bb = Booty.FACES.filter(f => c[f] >= 1).length >= 4; // chasing Blackbeard's Curse
  const keep = i => {
    const f = s.dice[i];
    if (f === 'D' || f === 'J' || f === 'C') return bb ? c[f] === 1 : true;
    if (f === 'S') return me.shields < 3 || bb;
    if (f === 'W') return c.W >= 3 || (c.W === 2 && s.rolls < 3 && !bb) || (bb && c[f] === 1);
    if (f === 'X') return c.X >= 3 || (bb && c[f] === 1);
    return false;
  };
  const hold = s.dice.map((_, i) => i).filter(keep);
  if (hold.length === s.dice.length || (me.lives <= 3 && c.W > 0 && s.rolls >= 2 && !c.J)) return { type: 'stop' };
  return { type: 'roll', hold };
}

function pickTarget(s, id) {
  const kind = s.slots[0], valid = Booty.validTargets(s, kind).map(i => s.players[i]);
  const score = p => kind === 'steal'
    ? p.gold + Math.random()
    : (p.shields ? 0 : 5) + (p.lives <= 1 ? 8 : 0) + p.gold * 0.3 - p.lives * 0.2 + Math.random();
  return valid.sort((a, b) => score(b) - score(a))[0].id;
}

module.exports = { botMove };
