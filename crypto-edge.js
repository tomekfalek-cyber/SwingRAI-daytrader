/**
 * SwingRAI Crypto Edge Pack — reguły jakości wejścia (nie gwarancja zysku).
 * Cel: mniej losowych shortów, longi na odbiciu z potwierdzeniem, R:R po opłatach.
 */
(function (global) {
  'use strict';
  if (global.__CRYPTO_EDGE__) return;
  global.__CRYPTO_EDGE__ = true;

  var FEE = 0.0009; // Revolut X taker ok.

  function roundTripCostPct() {
    // wejście + wyjście taker
    return FEE * 2 + 0.0002; // lekki poślizg
  }

  /** Czy setup ma sens po kosztach: cel TP vs SL w % */
  function netRROk(tpPct, slPct) {
    var rt = roundTripCostPct() * 100; // w punktach %
    var tp = +tpPct, sl = +slPct;
    if (!(sl > 0) || !(tp > 0)) return { ok: false, why: 'brak TP/SL' };
    var net = (tp - rt) / (sl + rt);
    if (net < 1.2) return { ok: false, why: 'net R:R ' + net.toFixed(2) + ' < 1.2 po opłatach' };
    return { ok: true, netRR: net };
  }

  /** Momentum  krótkie: ostatnie n domknięć */
  function momUp(closes, n) {
    if (!closes || closes.length < n + 1) return false;
    var a = closes[closes.length - 1 - n], b = closes[closes.length - 1];
    return b > a * 1.002;
  }
  function momDown(closes, n) {
    if (!closes || closes.length < n + 1) return false;
    var a = closes[closes.length - 1 - n], b = closes[closes.length - 1];
    return b < a * 0.998;
  }

  /**
   * Gate przed OPEN long/short.
   * sig: { side|buy|score|finalProb|volR|vol4R|rsi, tp, sl }
   * ctx: { closes1h, closes15m, regime }
   */
  function entryGate(sig, ctx) {
    ctx = ctx || {};
    var side = sig.side || (sig.buy ? 'LONG' : (sig.short || sig.shortSignal ? 'SHORT' : ''));
    if (sig.buy && !side) side = 'LONG';
    if ((sig.shortSignal || sig.short) && side !== 'LONG') side = 'SHORT';
    if (side !== 'LONG' && side !== 'SHORT') return { ok: false, why: 'brak strony' };

    var score = sig.score != null ? +sig.score : (sig.finalProb != null ? +sig.finalProb * 100 : 0);
    var fp = sig.finalProb != null ? +sig.finalProb : score / 100;
    var volR = sig.volR != null ? +sig.volR : 1;
    var vol4 = sig.vol4R != null ? +sig.vol4R : volR;

    // Martwy wolumen — nie daytrade
    if (volR < 0.45 && vol4 < 0.45) return { ok: false, why: 'wolumen martwy (volR)' };

    // Score floor
    if (side === 'LONG' && score < 42 && fp < 0.42) return { ok: false, why: 'score long za niski' };
    if (side === 'SHORT' && fp > 0.55) {
      // score long-oriented: wysokie finalProb = słaby short
      return { ok: false, why: 'finalProb za wysokie na SHORT' };
    }

    // Momentum alignment (przewaga: nie idź pod świeży impuls)
    var c1 = ctx.closes1h || ctx.closes || [];
    if (side === 'LONG' && c1.length > 6 && momDown(c1, 6) && !momUp(c1, 2)) {
      return { ok: false, why: 'LONG pod silnym impulsem spadkowym 1h' };
    }
    if (side === 'SHORT' && c1.length > 6 && momUp(c1, 6) && !momDown(c1, 2)) {
      return { ok: false, why: 'SHORT pod silnym impulsem wzrostowym 1h' };
    }

    // Odbicie long: preferuj gdy krótkie mom up
    if (side === 'LONG' && c1.length > 3 && momUp(c1, 3)) {
      /* bonus path — ok */ 
    }

    // R:R po fee
    var tp = sig.tpPct != null ? sig.tpPct : (sig.tp && sig.price ? Math.abs(sig.tp / sig.price - 1) * 100 : 1.2);
    var sl = sig.slPct != null ? sig.slPct : (sig.sl && sig.price ? Math.abs(1 - sig.sl / sig.price) * 100 : 0.8);
    // jeśli tp/sl w ułamku 0.01 = 1%
    if (tp > 0 && tp < 0.2) tp = tp * 100;
    if (sl > 0 && sl < 0.2) sl = sl * 100;
    var rr = netRROk(tp, sl);
    if (!rr.ok) return rr;

    // Reżim sideways: tylko wyższy score
    if (ctx.regime === 'sideways' && side === 'LONG' && score < 50) {
      return { ok: false, why: 'sideways: long tylko score>=50' };
    }

    return { ok: true, why: 'EDGE OK ' + side + ' netRR~' + (rr.netRR || 0).toFixed(2), netRR: rr.netRR };
  }

  /** Dostosuj size: przy słabszym edge mniejszy size */
  function sizeMult(gate, base) {
    if (!gate || !gate.ok) return 0;
    var m = 1;
    if (gate.netRR != null && gate.netRR < 1.5) m = 0.7;
    if (gate.netRR != null && gate.netRR >= 2) m = 1.1;
    return (base || 1) * m;
  }

  global.CRYPTO_EDGE = {
    FEE: FEE,
    roundTripCostPct: roundTripCostPct,
    netRROk: netRROk,
    entryGate: entryGate,
    sizeMult: sizeMult,
    momUp: momUp,
    momDown: momDown
  };

  if (typeof console !== 'undefined') console.log('[CRYPTO_EDGE] pack active');
})(typeof window !== 'undefined' ? window : globalThis);
