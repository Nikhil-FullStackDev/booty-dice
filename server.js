// Zero-dependency server: static files + online rooms (REST + Server-Sent Events).
// Tuned for Render's free tier: no build step, tiny memory footprint, static files
// held in memory pre-gzipped with ETags, long-cached images, idle rooms reaped.
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const Booty = require('./public/game.js');
const { botMove } = require('./bot.js');

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || (process.env.RENDER ? '0.0.0.0' : '::');
const PUBLIC = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };
const MIN_PLAYERS = 2, MAX_PLAYERS = 6, MAX_ROOMS = 200, MAX_STREAMS_PER_SEAT = 3;
const NAMES = ['Anne', 'Barnaby', 'Calico', 'Davy', 'Edward', 'Flint'];

// ---------- static files (loaded once) ----------
const files = new Map();
(function load(dir) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, f.name);
    if (f.isDirectory()) { load(full); continue; }
    const type = MIME[path.extname(f.name)];
    if (!type) continue;
    const body = fs.readFileSync(full);
    const text = !type.startsWith('image/');
    files.set('/' + path.relative(PUBLIC, full).split(path.sep).join('/'), {
      type, body, gz: text ? zlib.gzipSync(body, { level: 9 }) : null,
      etag: '"' + crypto.createHash('sha1').update(body).digest('base64url').slice(0, 16) + '"',
      cache: /\.(png|jpg)$/.test(f.name) ? 'public, max-age=2592000, immutable' : 'no-cache',
    });
  }
})(PUBLIC);

function serveStatic(req, res, pathname) {
  const f = files.get(pathname === '/' ? '/index.html' : pathname);
  if (!f) { res.writeHead(404); return res.end('Not found'); }
  const headers = { 'Content-Type': f.type, 'Cache-Control': f.cache, ETag: f.etag, 'X-Content-Type-Options': 'nosniff', Vary: 'Accept-Encoding' };
  if (req.headers['if-none-match'] === f.etag) { res.writeHead(304, headers); return res.end(); }
  if (f.gz && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
    res.writeHead(200, { ...headers, 'Content-Encoding': 'gzip' });
    return res.end(f.gz);
  }
  res.writeHead(200, headers);
  res.end(f.body);
}

// ---------- rooms ----------
const rooms = new Map();

function makeCode() {
  for (;;) {
    let c = '';
    for (let i = 0; i < 4; i++) c += 'ABCDEFGHJKLMNPQRSTUVWXYZ'[crypto.randomInt(24)];
    if (!rooms.has(c)) return c;
  }
}
const cleanName = n => String(n || '').replace(/[^\w \-']/g, '').trim().slice(0, 14) || 'Player';

function newRoom(hostName) {
  const room = { code: makeCode(), players: [], state: null, streams: new Map(), touched: Date.now(), botTimer: null, voice: '' };
  addPlayer(room, hostName, false);
  rooms.set(room.code, room);
  return room;
}
function addPlayer(room, name, bot) {
  const p = { name, bot, token: bot ? null : crypto.randomBytes(8).toString('hex') };
  room.players.push(p);
  return p;
}

function snapshot(room, idx) {
  return {
    code: room.code, you: idx, host: idx === 0, voice: room.voice,
    lobby: room.players.map((p, i) => ({ name: p.name, bot: p.bot, connected: p.bot || room.streams.has(i), color: Booty.COLORS[i] })),
    game: room.state ? Booty.view(room.state, idx) : null,
  };
}
function broadcast(room) {
  room.touched = Date.now();
  room.streams.forEach((set, idx) => {
    const data = `data: ${JSON.stringify(snapshot(room, idx))}\n\n`;
    set.forEach(res => res.write(data));
  });
  scheduleBots(room);
}

function scheduleBots(room) {
  clearTimeout(room.botTimer);
  const s = room.state;
  if (!s) return;
  const bots = Booty.waitingOn(s).filter(i => room.players[i].bot);
  if (!bots.length) return;
  const [lo, hi] = s.phase === 'target' ? [900, 1500] : [1100, 1900];
  room.botTimer = setTimeout(() => {
    if (room.state !== s) return;
    const id = bots[Math.floor(Math.random() * bots.length)];
    if (!Booty.waitingOn(s).includes(id)) return broadcast(room);
    const m = botMove(s, id);
    if (!m || Booty.act(s, id, m).error) Booty.act(s, id, fallback(s, id));
    broadcast(room);
  }, lo + Math.random() * (hi - lo));
}
// Never let a bot stall the table.
function fallback(s, id) {
  if (s.phase === 'target') return { type: 'target', target: Booty.validTargets(s, s.slots[0])[0] };
  return s.rolls ? { type: 'stop' } : { type: 'roll' };
}

// Result screens advance on a timer; one cheap interval for all rooms.
setInterval(() => {
  const now = Date.now();
  rooms.forEach(room => { if (room.state && Booty.tick(room.state, now)) broadcast(room); });
}, 500).unref();

function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise(resolve => {
    let b = '';
    req.on('data', d => { b += d; if (b.length > 4096) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch { resolve({}); } });
  });
}
const auth = (room, token) => room ? room.players.findIndex(p => p.token && p.token === token) : -1;

async function api(req, res, url) {
  if (url.pathname === '/api/events') {
    const room = rooms.get(String(url.searchParams.get('code')).toUpperCase());
    const idx = auth(room, url.searchParams.get('token'));
    if (idx < 0) return json(res, 404, { error: 'Room not found' });
    if (!room.streams.has(idx)) room.streams.set(idx, new Set());
    const set = room.streams.get(idx);
    if (set.size >= MAX_STREAMS_PER_SEAT) [...set][0].end(); // stale tabs
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write('retry: 3000\n\n');
    set.add(res);
    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => {
      clearInterval(ping);
      const cur = room.streams.get(idx);
      if (cur) { cur.delete(res); if (!cur.size) room.streams.delete(idx); }
      broadcast(room);
    });
    broadcast(room);
    return;
  }
  if (req.method !== 'POST') return json(res, 405, { error: 'POST only' });
  const b = await readBody(req);

  if (url.pathname === '/api/create') {
    if (rooms.size >= MAX_ROOMS) return json(res, 503, { error: 'Server busy, try again later' });
    const room = newRoom(cleanName(b.name));
    return json(res, 200, { code: room.code, token: room.players[0].token });
  }
  const room = rooms.get(String(b.code || '').toUpperCase());
  if (!room) return json(res, 404, { error: 'Room not found' });

  if (url.pathname === '/api/join') {
    if (room.state) return json(res, 400, { error: 'Game already started' });
    if (room.players.length >= MAX_PLAYERS) return json(res, 400, { error: 'Room full' });
    const p = addPlayer(room, cleanName(b.name), false);
    broadcast(room);
    return json(res, 200, { code: room.code, token: p.token });
  }
  const me = auth(room, b.token);
  if (me < 0) return json(res, 403, { error: 'Bad token' });

  if (url.pathname === '/api/move') {
    if (!room.state) return json(res, 400, { error: 'Not started' });
    const r = Booty.act(room.state, me, b.move || {});
    if (r.error) return json(res, 400, r);
    broadcast(room);
    return json(res, 200, r);
  }
  // host-only below
  if (me !== 0) return json(res, 403, { error: 'Host only' });
  if (url.pathname === '/api/addbot') {
    if (room.state || room.players.length >= MAX_PLAYERS) return json(res, 400, { error: 'Cannot add' });
    addPlayer(room, NAMES.filter(n => !room.players.some(p => p.name === n + ' (bot)'))[0] + ' (bot)', true);
  } else if (url.pathname === '/api/kick') {
    const i = Number(b.index);
    if (room.state || !(i > 0 && i < room.players.length)) return json(res, 400, { error: 'Cannot remove' });
    room.streams.forEach(set => set.forEach(r => r.end())); // clients reconnect with their new index
    room.players.splice(i, 1);
    room.streams.clear();
  } else if (url.pathname === '/api/start' || url.pathname === '/api/restart') {
    if (room.players.length < MIN_PLAYERS) return json(res, 400, { error: `Need ${MIN_PLAYERS}+ players` });
    clearTimeout(room.botTimer);
    room.state = Booty.create(room.players);
  } else if (url.pathname === '/api/replace') { // hand a disconnected player over to a bot
    const i = Number(b.index), p = room.players[i];
    if (!p || p.bot || i === 0) return json(res, 400, { error: 'Cannot replace' });
    p.bot = true; p.token = null; p.name += ' (bot)';
    if (room.state) room.state.players[i].bot = true, room.state.players[i].name = p.name;
  } else if (url.pathname === '/api/settings') {
    if (b.voice !== undefined) {
      const v = String(b.voice).trim().slice(0, 300);
      if (v && !/^https?:\/\/[^\s]+$/i.test(v)) return json(res, 400, { error: 'Voice link must start with http(s)://' });
      room.voice = v;
    }
  } else if (url.pathname === '/api/lobby') { // back to lobby after game
    clearTimeout(room.botTimer);
    room.state = null;
  } else return json(res, 404, { error: 'Unknown' });
  broadcast(room);
  json(res, 200, { ok: true });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/healthz') return json(res, 200, { ok: true, rooms: rooms.size });
  if (url.pathname.startsWith('/api/')) return api(req, res, url).catch(() => json(res, 500, { error: 'Server error' }));
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
  serveStatic(req, res, url.pathname);
});
server.keepAliveTimeout = 65000; // outlive Render's proxy keep-alive

// Reap idle rooms so memory stays flat.
setInterval(() => {
  const now = Date.now();
  rooms.forEach((r, c) => { if (!r.streams.size && now - r.touched > 2 * 3600e3) { clearTimeout(r.botTimer); rooms.delete(c); } });
}, 600e3).unref();

// Render sends SIGTERM on redeploy/restart: stop accepting, drop open streams, exit promptly.
process.on('SIGTERM', () => {
  server.close(() => process.exit(0));
  server.closeAllConnections?.();
  setTimeout(() => process.exit(0), 3000).unref();
});
if (require.main === module) server.listen(PORT, HOST, () => console.log(`Booty Dice on http://localhost:${PORT}`));
module.exports = server;
