const $app = document.getElementById('app');
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const $ = id => document.getElementById(id);
const IMG = { D: 'doubloon', X: 'x-marks-the-spot', J: 'jolly-roger', C: 'cutlass', W: 'walk-the-plank', S: 'shield' };
const FACE_NAME = { D: 'Doubloon', X: 'X Marks the Spot', J: 'Jolly Roger', C: 'Cutlass', W: 'Walk the Plank', S: 'Shield' };

let session = JSON.parse(localStorage.getItem('booty-session') || 'null'); // {code, token}
let snap = null, es = null, lastErr = '', keep = new Set(), lastRolls = -1, lastTurn = -1, rolledFresh = false, showRef = false;

async function post(path, body) {
  const r = await fetch('/api/' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Error');
  return j;
}
const withRoom = b => ({ code: session.code, token: session.token, ...b });
let toastTimer;
function toast(m) { const t = $('toast'); t.textContent = m; t.classList.remove('hidden'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.add('hidden'), 2500); }
const send = (path, b) => post(path, withRoom(b)).catch(e => toast(e.message));
const move = m => send('move', { move: m });

function connect() {
  if (es) es.close();
  es = new EventSource(`/api/events?code=${session.code}&token=${session.token}`);
  es.onmessage = e => { snap = JSON.parse(e.data); render(); };
  es.onerror = () => { if (es.readyState === EventSource.CLOSED) { leave(); lastErr = 'Room closed (the server may have restarted).'; render(); } };
}
function leave() { if (es) es.close(); es = null; snap = null; session = null; localStorage.removeItem('booty-session'); }
function setSession(r) { session = { code: r.code, token: r.token }; localStorage.setItem('booty-session', JSON.stringify(session)); connect(); }

// ---------- pieces ----------
const dieImg = f => `<img src="img/dice-face-${IMG[f]}.png" alt="${FACE_NAME[f]}" draggable="false">`;
const die = (f, cls = '', attrs = '') => `<div class="die ${f ? '' : 'blank'} ${cls}" ${f ? `title="${FACE_NAME[f]}"` : ''} ${attrs}>${f ? dieImg(f) : ''}</div>`;

const ACTION = {
  cut: { face: 'C', name: 'Cutlass attack', you: 'Tap a pirate to attack: they lose a Shield, or a Life if they have none.' },
  steal: { face: 'J', name: 'Jolly Roger', you: 'Tap a pirate to steal 1 Doubloon from.' },
};
const icons = fs => `<span class="ics">${[...fs].map(f => `<img src="img/dice-face-${IMG[f]}.png" alt="${FACE_NAME[f]}" draggable="false">`).join('')}</span>`;
const CARD = [
  ['D', 'Doubloon', 'Take 2 Doubloons from the Buried Treasure.'],
  ['X', 'X Marks the Spot', 'Give 2 of yer Doubloons to the Buried Treasure.'],
  ['J', 'Jolly Roger', 'Steal 2 Doubloons from other pirates.'],
  ['C', 'Cutlass', 'Attack a pirate!'],
  ['W', 'Walk the Plank', 'Lose 1 of yer Lives to Davey Jones’ Locker.'],
  ['S', 'Shield', 'Take a Shield from the War Chest.'],
  ['WWW', 'Mutiny', 'Blimey! All other pirates lose a Life to Davey Jones’s Locker. For each additional Walk The Plank rolled, pirates lose an additional Life.'],
  ['XXX', 'Shipwreck', 'Avast! All other pirates give 3 Doubloons to the Buried Treasure. For each additional X Marks the Spot, pirates give an additional Doubloon.'],
  ['XJWDCS', 'Blackbeard’s Curse', 'Argghhh! All other pirates lose 2 Lives to Davey Jones’s Locker and give 5 Doubloons to The Buried Treasure.'],
];
const refHtml = () => `<div class="rollcard">${CARD.map(([f, n, t]) => `<div class="rc ${f.length > 1 ? 'combo' : ''}">${icons(f)}<p><b>${n}:</b> ${t}</p></div>`).join('')}</div>
  <p class="plunder"><b>CAPTAIN’S PLUNDER:</b> eliminate a pirate on your turn (Cutlass, Mutiny or Blackbeard’s Curse) and take ALL their Doubloons!</p>`;

const rules = () => `<div class="rules"><h3>HOW TO PLAY</h3>
  <p>Everyone starts with <b>10 Lives</b> and <b>5 Doubloons</b>. Be the first to hold <b>25 Doubloons</b>, or be the last pirate alive.</p>
  <p>On your turn roll 6 dice up to <b>3 times</b>. After each roll, keep the dice you like and re-roll the rest. Then resolve the dice.</p>
  <h3 class="sub">THE DICE</h3>${refHtml()}</div>`;

// ---------- screens ----------
function home() {
  $app.innerHTML = `<div class="lobbywrap"><div class="center">
    <div class="logo">${die('D')}${die('J')}${die('C')}</div>
    <h1>BOOTY DICE</h1><div class="tag">Roll for the gold or die trying! · 2–6 pirates</div>
    <input id="name" placeholder="Your name" maxlength="14" value="${esc(localStorage.getItem('booty-name') || '')}">
    <button class="primary" id="create">Create room</button>
    <div class="row"><input id="code" placeholder="Room code" maxlength="4" style="text-transform:uppercase"><button id="join">Join</button></div>
    <div class="err">${esc(lastErr)}</div>
    </div>${rules()}</div>`;
  const nm = () => { const v = $('name').value.trim(); localStorage.setItem('booty-name', v); return v; };
  const go = p => async () => { try { setSession(await p()); lastErr = ''; } catch (e) { lastErr = e.message; home(); } };
  $('create').onclick = go(() => post('create', { name: nm() }));
  $('join').onclick = go(() => post('join', { name: nm(), code: $('code').value }));
  $('code').onkeydown = e => { if (e.key === 'Enter') $('join').click(); };
}

const voiceBtn = s => (s.voice ? `<a href="${esc(s.voice)}" target="_blank" rel="noopener noreferrer"><button style="width:100%">🎙 Join voice chat</button></a>` : '');

function lobby() {
  const s = snap, n = s.lobby.length;
  $app.innerHTML = `<div class="lobbywrap"><div class="center"><div class="dim" style="text-align:center">Room code — share with friends</div>
    <div class="code">${s.code}</div>
    <ul class="plist">${s.lobby.map((p, i) => `<li style="--c:${p.color}"><span class="dot"></span><span class="nm">${esc(p.name)}${i === s.you ? ' (you)' : ''}${i === 0 ? ' ★' : ''}</span>
      <span class="dim">${p.connected ? '' : 'offline'}</span>${s.host && i > 0 ? `<button data-kick="${i}">Remove</button>` : ''}</li>`).join('')}</ul>
    ${voiceBtn(s)}
    ${s.host ? `<div class="row"><input id="voice" placeholder="Voice chat link (Discord / Meet…)" value="${esc(s.voice)}"><button id="setvoice" style="flex:none">Set</button></div>
      <div class="row"><button id="bot" ${n >= 6 ? 'disabled' : ''}>+ Add bot</button>
      <button class="primary" id="start" ${n < 2 ? 'disabled' : ''}>Start game</button></div>
      ${n < 2 ? '<div class="dim" style="text-align:center">Need at least 2 pirates — add a bot to fill a seat.</div>' : ''}`
      : '<div class="dim" style="text-align:center">Waiting for the host to start…</div>'}
    <div class="row"><button id="leave">Leave</button></div></div>${rules()}</div>`;
  $('leave').onclick = () => { leave(); render(); };
  if (s.host) {
    $('setvoice').onclick = () => send('settings', { voice: $('voice').value });
    $('bot').onclick = () => send('addbot', {});
    $('start').onclick = () => send('start', {});
    document.querySelectorAll('[data-kick]').forEach(b => b.onclick = () => send('kick', { index: +b.dataset.kick }));
  }
}

function matHtml(p, g, s) {
  const active = g.turn === p.id && g.phase !== 'over';
  const canTarget = g.target && g.waiting.includes(s.you) && g.target.valid.includes(p.id);
  const online = s.lobby[p.id] ? s.lobby[p.id].connected : true;
  const stat = (cls, img, v, low) => `<div class="stat ${cls} ${low ? 'low' : ''}"><img src="img/${img}.png" alt="">${v}</div>`;
  return `<div class="mat ${active ? 'active' : ''} ${canTarget ? 'target' : ''} ${p.alive ? '' : 'out'}" style="--c:${p.color}" ${canTarget ? `data-target="${p.id}"` : ''}>
    ${s.host && !p.bot && p.id !== 0 && !online && p.alive ? `<button class="tobot" data-tobot="${p.id}" title="Let a bot play for them">→ bot</button>` : ''}
    <div class="mat-head"><span class="pname">${esc(p.name)}${p.id === s.you ? ' (you)' : ''}${online ? '' : ' ⚠'}</span>${p.alive ? '' : '<span class="dim">☠ OUT</span>'}</div>
    <div class="stats">${stat('life', 'life-token-portrait', p.lives, p.lives <= 3)}${stat('', 'shield-token', p.shields)}${stat('', 'doubloon-token', p.gold)}</div>
    <div class="goal" title="${p.gold}/25 doubloons"><i style="width:${Math.min(100, p.gold * 4)}%"></i></div></div>`;
}

function tableHtml(g, s) {
  const P = i => g.players[i], nm = i => (i === s.you ? 'You' : esc(P(i).name));
  const myTurn = g.waiting.includes(s.you);
  let head = '', cls = '';
  if (g.phase === 'roll') head = myTurn ? (g.rolls ? 'Tap the dice you want to re-roll — or stop' : 'Your turn — roll the dice!') : `${nm(g.turn)} ${g.rolls ? 'is deciding' : 'is rolling'}…`;
  else if (g.phase === 'target') {
    head = myTurn ? 'Choose your target' : `${nm(g.turn)} is choosing a target…`;
  } else if (g.phase === 'result') head = `${nm(g.turn)} ${g.turn === s.you ? 'resolve' : 'resolves'} the dice`;
  else if (g.phase === 'over') { head = `🏆 ${nm(g.winner)} win${g.winner === s.you ? '' : 's'}!`; cls = 'good'; }

  const shown = g.phase === 'roll';
  const T = g.target && ACTION[g.target.kind];
  const banner = T ? `<div class="action">${die(T.face)}<div><b>${T.name}</b><br>${myTurn ? T.you : esc(P(g.turn).name) + ' is choosing…'}${g.target.left > 1 ? ` <span class="dim">(${g.target.left} left)</span>` : ''}</div></div>` : '';
  const canKeep = myTurn && g.phase === 'roll' && g.rolls > 0 && g.rolls < 3;
  const dice = g.dice.map((f, i) => {
    const cls = canKeep ? (keep.has(i) ? 'reroll' : '') : (g.held[i] ? 'kept' : '');
    const roll = rolledFresh && f && !g.held[i] ? 'roll' : '';
    return die(f, `${cls} ${canKeep ? 'pick' : ''} ${roll}`, canKeep ? `data-keep="${i}"` : '');
  }).join('');
  const pips = `<div class="rollpips">${[0, 1, 2].map(i => `<span class="pip ${i < g.rolls ? 'on' : ''}"></span>`).join('')} ${g.rolls}/3 rolls</div>`;

  let actions = '';
  if (myTurn && g.phase === 'roll') {
    actions = g.rolls === 0 ? '<button class="primary" id="roll">🎲 Roll dice</button>'
      : `<button class="primary" id="roll" ${keep.size ? '' : 'disabled'}>${keep.size ? `Re-roll ${keep.size} ${keep.size === 1 ? 'die' : 'dice'}` : 'Select dice to re-roll'}</button><button id="stop">Stop &amp; resolve</button>`;
  }
  const lines = (g.phase === 'result' || g.phase === 'over' ? (g.result ? g.result.lines : []) : g.turnLog).concat();
  const timer = g.phase === 'result' ? `<div class="timer"><i style="animation-duration:${g.untilIn}ms"></i></div>` : '';
  return `<div class="table"><div class="head ${cls}">${head}</div>
    ${g.phase === 'roll' && !g.rolls ? '' : pips}
    ${banner}${shown ? `<div class="dicerow">${dice}</div>` : ''}${actions ? `<div class="actions">${actions}</div>` : ''}
    ${timer}<ul class="log">${(lines.length ? lines : g.log.slice(-2)).map(l => `<li>${esc(l)}</li>`).join('')}</ul></div>`;
}

function game() {
  const s = snap, g = s.game, n = g.players.length;
  if (g.turn !== lastTurn || g.rolls !== lastRolls) keep = new Set();
  rolledFresh = g.rolls !== lastRolls && g.rolls > 0; lastRolls = g.rolls; lastTurn = g.turn;
  const opps = Array.from({ length: n - 1 }, (_, k) => g.players[(s.you + 1 + k) % n]);
  const over = g.phase === 'over';
  $app.innerHTML = `<div class="game">
    <div class="bar"><span class="title">BOOTY DICE</span><span class="meta">Room ${s.code} · Turn ${g.turns}</span>
      ${s.voice ? `<a href="${esc(s.voice)}" target="_blank" rel="noopener noreferrer"><button>🎙 Voice</button></a>` : ''}
      <button id="ref">Dice guide</button><button id="leave">Leave</button></div>
    <div class="pools"><span><img src="img/doubloon-token.png" alt="">Buried Treasure: ${g.treasure}</span><span><img src="img/shield-token.png" alt="">War Chest: ${g.chest}</span></div>
    <div class="opps">${opps.map(p => matHtml(p, g, s)).join('')}</div>
    ${tableHtml(g, s)}
    <div class="me">${matHtml(g.players[s.you], g, s)}</div>
    ${over ? (s.host ? '<div class="actions"><button class="primary" id="again">Play again</button><button id="tolobby">Back to lobby</button></div>' : '<div class="dim" style="text-align:center">Waiting for the host to start a new game…</div>') : ''}
    ${showRef ? `<div class="rules drawer">${refHtml()}</div>` : ''}</div>`;

  $('leave').onclick = () => { if (confirm('Leave this game?')) { leave(); render(); } };
  $('ref').onclick = () => { showRef = !showRef; game(); };
  document.querySelectorAll('[data-keep]').forEach(el => el.onclick = () => { const i = +el.dataset.keep; keep.has(i) ? keep.delete(i) : keep.add(i); rolledFresh = false; game(); });
  document.querySelectorAll('[data-target]').forEach(el => el.onclick = () => move({ type: 'target', target: +el.dataset.target }));
  document.querySelectorAll('[data-tobot]').forEach(el => el.onclick = e => { e.stopPropagation(); send('replace', { index: +el.dataset.tobot }); });
  if ($('roll')) $('roll').onclick = () => move({ type: 'roll', hold: [0, 1, 2, 3, 4, 5].filter(i => !keep.has(i)) });
  if ($('stop')) $('stop').onclick = () => move({ type: 'stop' });
  if ($('again')) $('again').onclick = () => send('restart', {});
  if ($('tolobby')) $('tolobby').onclick = () => send('lobby', {});
  document.title = g.waiting.includes(s.you) ? '● Your turn — Booty Dice' : 'Booty Dice Online';
}

function render() {
  if (!session) { document.title = 'Booty Dice Online'; return home(); }
  if (!snap) { $app.innerHTML = '<div class="boot">Connecting…</div>'; return; }
  if (snap.game) game(); else lobby();
}

if (session) connect();
render();
