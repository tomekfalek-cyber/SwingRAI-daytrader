// Test regresyjny worker.js: czy się ładuje (składnia) i czy bot na sztucznych danych Bybit faktycznie otwiera pozycje.
// Pilnuje błędów, które wcześniej zatrzymały handel:
//  - nadmiarowy nawias w runBotCycle (od 2026-11-19 plik się nie parsował),
//  - rozmiar pozycji < minimum po mnożnikach ("Za mala pozycja" dla każdego sygnału),
//  - limit dzienny transakcji nieliczący otwartych pozycji.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const WORKER = new URL('../worker.js', import.meta.url);

test('worker.js: poprawna składnia ES module', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wk-'));
  const f = join(dir, 'w.mjs');
  writeFileSync(f, readFileSync(WORKER, 'utf8'));
  execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
});

test('worker.js: handluje na sztucznych danych (24h, trend wzrostowy), limit dnia respektowany', { timeout: 120000 }, async () => {
  // --- dane 5m (deterministyczne) ---
  let s = 12345; const rnd = () => { s |= 0; s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
  const HIST = 1500, DAYS = 1, N = HIST + DAYS * 288 + 10, START = Date.UTC(2026, 10, 30) - HIST * 300000;
  const SYMS = { BTCUSDT: [95000, 0.0012], ETHUSDT: [3500, 0.0016], SOLUSDT: [180, 0.0022], XRPUSDT: [2.4, 0.002], PEPEUSDT: [0.000012, 0.0032] };
  const data = {};
  for (const [sym, [p0, v]] of Object.entries(SYMS)) {
    const b = []; let p = p0;
    for (let i = 0; i < N; i++) { const o = p; p = o * Math.exp(0.00008 + gauss() * v); b.push({ t: START + i * 300000, o, h: Math.max(o, p) * (1 + Math.abs(gauss()) * v * 0.35), l: Math.min(o, p) * (1 - Math.abs(gauss()) * v * 0.35), c: p, v: 50 + rnd() * 100 }); }
    data[sym] = b;
  }
  let IDX = HIST;
  const agg = (b, mins, limit) => { const k = mins / 5, out = []; for (let e = IDX - ((IDX + 1) % k); e >= k - 1 && out.length < limit; e -= k) { const st = e - k + 1; let h = -1e99, l = 1e99, v = 0; for (let j = st; j <= e; j++) { h = Math.max(h, b[j].h); l = Math.min(l, b[j].l); v += b[j].v; } out.push([String(b[st].t), String(b[st].o), String(h), String(l), String(b[e].c), String(v), '0']); } return out; };
  const jr = o => ({ ok: true, status: 200, json: async () => o, text: async () => JSON.stringify(o) });
  const realFetch = globalThis.fetch, realST = globalThis.setTimeout, RealDate = Date;
  globalThis.fetch = async (url) => {
    const u = new URL(String(url));
    if (u.pathname === '/v5/market/kline') { const iv = u.searchParams.get('interval'); const mins = iv === 'D' ? 1440 : iv === 'W' ? 10080 : +iv; return jr({ retCode: 0, result: { list: agg(data[u.searchParams.get('symbol')] || data.BTCUSDT, mins, +u.searchParams.get('limit') || 200) } }); }
    if (u.pathname === '/v5/market/tickers') return jr({ retCode: 0, result: { list: [{ lastPrice: String((data[u.searchParams.get('symbol')] || data.BTCUSDT)[IDX].c) }] } });
    if (u.pathname === '/v5/market/orderbook') { const p = (data[u.searchParams.get('symbol')] || data.BTCUSDT)[IDX].c; return jr({ retCode: 0, result: { b: [[String(p * 0.9999), '10']], a: [[String(p * 1.0001), '9']] } }); }
    if (String(url).includes('alternative.me')) return jr({ data: [{ value: '55', value_classification: 'Neutral' }] });
    return jr({});
  };
  globalThis.setTimeout = fn => { Promise.resolve().then(fn); return 0; };
  let NOW = 0; globalThis.Date = class extends RealDate { constructor(...a) { if (a.length) super(...a); else super(NOW); } static now() { return NOW; } };
  try {
    const store = new Map();
    const KV = { get: async k => store.has(k) ? store.get(k) : null, put: async (k, v) => { store.set(k, String(v)); }, delete: async k => { store.delete(k); } };
    store.set('config', JSON.stringify({ active: true, mode: 'paper', tp: 0.02, sl: 0.01, trail: 0.008, maxPos: 3, posSize: 12, riskPct: 1.25, paperBalance: 1000, minScore: 45, fgMin: 10, revxApiKey: '', revxPrivKey: '', tgToken: '', tgChat: '' }));
    const env = { SWINGAI_REVOLUT_KV: KV, AUTH_SECRET: 'x' };
    const mod = await import(WORKER.href);
    const seen = new Set(); let opens = 0; const logs = []; const perDay = {};
    for (let c = 0; c < DAYS * 288; c++) {
      IDX = HIST + c; NOW = data.BTCUSDT[IDX].t + 300000;
      let pr; await mod.default.scheduled({}, env, { waitUntil: p => { pr = p; } }); await pr;
      const st = JSON.parse(store.get('state'));
      for (const p of st.positions || []) { const k = p.sym + '|' + p.entryTs; if (!seen.has(k)) { seen.add(k); opens++; const d = new RealDate(NOW).toISOString().slice(0, 10); perDay[d] = (perDay[d] || 0) + 1; } }
      for (const l of st.log || []) logs.push(l.msg);
    }
    assert.ok(opens >= 3, `bot prawie nie handluje: ${opens} wejść w 24h`);
    for (const [d, n] of Object.entries(perDay)) assert.ok(n <= 8, `limit dzienny przekroczony ${d}: ${n} wejść (DT_MAX_TRADES_DAY=8)`);
    assert.equal(logs.filter(m => /Za mala pozycja/.test(m)).length, 0, 'sizing blokuje wejścia ("Za mala pozycja")');
  } finally {
    globalThis.fetch = realFetch; globalThis.setTimeout = realST; globalThis.Date = RealDate;
  }
});
