# SwingAI DayTrader — (AI Agent, Day Trading)
https://tomekfalek-cyber.github.io/SwingRAI-daytrader/

Agent AI do handlu **intraday** na Revolut X (SMC: Order Blocks, FVG, Liquidity Sweep, BoS/CHoCH).

## Status: TYLKO GitHub / GitHub Pages

Bez Cloudflare Workera funkcje handlowe nie działają — to oczekiwane.

## Ograniczenie — brak shortów

Revolut X = tylko spot. Sygnały SHORT są informacyjne (paper).

## RECOVERY (2026-11-05)

`worker.js` i `index.html` na main zostały uszkodzone podczas pusha dużych plików przez connector.

**Przywróć działającą wersję:**

```bash
git clone https://github.com/tomekfalek-cyber/SwingRAI-daytrader.git
cd SwingRAI-daytrader
git fetch origin
git checkout 1549087717372b82af9f27dee84f3328d9e027ce -- worker.js index.html
git add worker.js index.html
git commit -m "restore: worker.js + index.html from 1549087"
git push origin main
```

Albo force-restore całego main:
```bash
git push origin 1549087717372b82af9f27dee84f3328d9e027ce:main --force
```

Potem nałóż fix daytrading (btcInfo, scoring 1H/15m/5m, TP 2%/SL 1%, ATR 1.8x/1.0x, UI).
