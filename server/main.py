from __future__ import annotations

import json
import math
import os
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any

import yfinance as yf
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Vantage yfinance API")
_CORS_ORIGINS = [
    o.strip()
    for o in os.environ.get(
        "VANTAGE_CORS_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173",
    ).split(",")
    if o.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_CORS_ORIGINS,
    allow_methods=["GET"],
    allow_headers=["*"],
)

MAX_SYMBOLS = 40
MAX_SEARCH_LEN = 64
_SYMBOL_RE = re.compile(r"^[A-Za-z0-9.^_-]{1,15}$")


def _normalize_symbol(symbol: str) -> str:
    s = symbol.strip().upper()
    if not _SYMBOL_RE.match(s):
        raise HTTPException(400, "invalid symbol")
    return s

RANGE_MAP = {
    "1D":  {"period": "1d",  "interval": "5m"},
    "1W":  {"period": "5d",  "interval": "15m"},
    "1M":  {"period": "1mo", "interval": "30m"},
    "3M":  {"period": "3mo", "interval": "1h"},
    "6M":  {"period": "6mo", "interval": "1h"},
    "YTD": {"period": "ytd", "interval": "1h"},
    "1Y":  {"period": "1y",  "interval": "1h"},
    "2Y":  {"period": "2y",  "interval": "1d"},
    "5Y":  {"period": "5y",  "interval": "1d"},
    "10Y": {"period": "10y", "interval": "1d"},
    "ALL": {"period": "max", "interval": "1d"},
}

# TTL cache: Yahoo aggressively rate-limits, so serve cached data and fall
# back to stale entries when yfinance errors out. Persisted to disk so
# restarts still have last-good quotes instead of zeros / client fakes.
_CACHE: dict[str, tuple[float, Any]] = {}
_CACHE_LOCK = threading.Lock()
_CACHE_PATH = Path(__file__).resolve().parent / ".yf_cache.json"

QUOTE_TTL = 60.0
HISTORY_TTL = {
    "1D": 120.0, "1W": 300.0, "1M": 600.0, "3M": 900.0, "6M": 900.0,
    "YTD": 900.0, "1Y": 1800.0, "2Y": 3600.0, "5Y": 3600.0, "10Y": 3600.0,
    "ALL": 3600.0,
}
SEARCH_TTL = 300.0


def _cache_load() -> None:
    if not _CACHE_PATH.exists():
        return
    try:
        raw = json.loads(_CACHE_PATH.read_text())
        if not isinstance(raw, dict):
            return
        loaded: dict[str, tuple[float, Any]] = {}
        for k, entry in raw.items():
            if not isinstance(entry, (list, tuple)) or len(entry) != 2:
                continue
            ts, value = entry
            if isinstance(ts, (int, float)) and value is not None:
                loaded[str(k)] = (float(ts), value)
        with _CACHE_LOCK:
            _CACHE.update(loaded)
    except Exception:
        pass


def _cache_save() -> None:
    with _CACHE_LOCK:
        snapshot = {k: [ts, v] for k, (ts, v) in _CACHE.items()}
    try:
        tmp = _CACHE_PATH.with_suffix(".tmp")
        tmp.write_text(json.dumps(snapshot, default=str))
        os.replace(tmp, _CACHE_PATH)
    except Exception:
        pass


def _cache_get(key: str, ttl: float) -> tuple[Any, bool]:
    """Returns (value, fresh). value is None if missing entirely."""
    with _CACHE_LOCK:
        entry = _CACHE.get(key)
    if entry is None:
        return None, False
    ts, value = entry
    return value, (time.time() - ts) < ttl


def _cache_put(key: str, value: Any) -> None:
    with _CACHE_LOCK:
        _CACHE[key] = (time.time(), value)
    _cache_save()


_cache_load()

SECTORS = {
    "AAPL": "Technology",
    "MSFT": "Technology",
    "NVDA": "Technology",
    "GOOGL": "Technology",
    "AMZN": "Consumer",
    "META": "Technology",
    "TSLA": "Automotive",
    "JPM": "Finance",
    "V": "Finance",
    "SPY": "ETF",
    "QQQ": "ETF",
    "NFLX": "Technology",
    "BRK.B": "Finance",
    "GLD": "Commodity",
    "JNJ": "Healthcare",
}


def _yf_symbol(symbol: str) -> str:
    """Yahoo uses dashes for class shares (BRK.B → BRK-B)."""
    return symbol.strip().upper().replace(".", "-")


def _num(v: Any) -> float | None:
    if v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    if math.isnan(f) or math.isinf(f):
        return None
    return f


def _live_price(t: yf.Ticker) -> float | None:
    try:
        fast = dict(t.fast_info) if t.fast_info is not None else {}
    except Exception:
        fast = {}
    for k in ("lastPrice", "last_price", "regularMarketPrice", "currentPrice"):
        n = _num(fast.get(k))
        if n is not None:
            return n
    try:
        info = t.info or {}
    except Exception:
        info = {}
    for k in ("regularMarketPrice", "currentPrice", "previousClose"):
        n = _num(info.get(k))
        if n is not None:
            return n
    return None


def _quote_one(symbol: str) -> dict[str, Any]:
    display = symbol.strip().upper()
    t = yf.Ticker(_yf_symbol(display))
    info: dict[str, Any] = {}
    try:
        info = t.info or {}
    except Exception:
        info = {}

    fast: dict[str, Any] = {}
    try:
        fast = dict(t.fast_info) if t.fast_info is not None else {}
    except Exception:
        fast = {}

    def pick(*keys: str) -> float | None:
        for k in keys:
            if k in fast:
                n = _num(fast.get(k))
                if n is not None:
                    return n
            if k in info:
                n = _num(info.get(k))
                if n is not None:
                    return n
        return None

    price = pick("lastPrice", "last_price", "regularMarketPrice", "currentPrice") or 0.0
    prev = pick("previousClose", "previous_close", "regularMarketPreviousClose") or 0.0
    change = pick("regularMarketChange")
    change_pct = pick("regularMarketChangePercent")
    if change is None and prev:
        change = price - prev
    if change_pct is None and prev:
        change_pct = ((price - prev) / prev) * 100 if prev else 0.0
    if change is None:
        change = 0.0
    if change_pct is None:
        change_pct = 0.0

    div = pick("dividendYield", "trailingAnnualDividendYield")
    if div is not None and div <= 1:
        div = div * 100

    name = (
        info.get("longName")
        or info.get("shortName")
        or info.get("displayName")
        or display
    )

    return {
        "symbol": display,
        "name": str(name),
        "sector": SECTORS.get(display) or info.get("sector") or "—",
        "price": price,
        "change": change,
        "changePercent": change_pct,
        "volume": pick("lastVolume", "regularMarketVolume", "volume") or 0.0,
        "avgVolume": pick("threeMonthAverageVolume", "averageVolume", "averageDailyVolume3Month") or 0.0,
        "marketCap": pick("marketCap", "market_cap") or 0.0,
        "pe": pick("trailingPE", "forwardPE"),
        "high52w": pick("yearHigh", "fiftyTwoWeekHigh", "fifty_two_week_high") or 0.0,
        "low52w": pick("yearLow", "fiftyTwoWeekLow", "fifty_two_week_low") or 0.0,
        "open": pick("open", "regularMarketOpen") or 0.0,
        "dayHigh": pick("dayHigh", "regularMarketDayHigh") or 0.0,
        "dayLow": pick("dayLow", "regularMarketDayLow") or 0.0,
        "eps": pick("trailingEps", "epsTrailingTwelveMonths"),
        "dividendYield": div,
        "stale": False,
        "asOf": time.time(),
    }


def _empty_quote(sym: str, err: str | None = None) -> dict[str, Any]:
    q: dict[str, Any] = {
        "symbol": sym,
        "name": sym,
        "sector": SECTORS.get(sym, "—"),
        "price": 0,
        "change": 0,
        "changePercent": 0,
        "volume": 0,
        "avgVolume": 0,
        "marketCap": 0,
        "pe": None,
        "high52w": 0,
        "low52w": 0,
        "open": 0,
        "dayHigh": 0,
        "dayLow": 0,
        "eps": None,
        "dividendYield": None,
        "stale": True,
    }
    if err:
        q["error"] = err
    return q


def _stale_quote(sym: str, err: str | None = None) -> dict[str, Any]:
    """Prefer last-good cached quote over empty zeros when Yahoo fails."""
    with _CACHE_LOCK:
        entry = _CACHE.get(f"q:{sym}")
    if entry is not None:
        ts, value = entry
        if isinstance(value, dict) and value.get("price"):
            out = dict(value)
            out["stale"] = True
            out["asOf"] = ts
            if err:
                out["error"] = err
            return out
    return _empty_quote(sym, err)


@app.get("/api/quotes")
def quotes(symbols: str = Query(..., description="Comma-separated tickers")):
    raw = [s for s in symbols.split(",") if s.strip()]
    if not raw:
        raise HTTPException(400, "symbols required")
    if len(raw) > MAX_SYMBOLS:
        raise HTTPException(400, f"max {MAX_SYMBOLS} symbols")
    syms = [_normalize_symbol(s) for s in raw]

    by_sym: dict[str, dict[str, Any]] = {}
    to_fetch: list[str] = []
    for s in syms:
        cached, fresh = _cache_get(f"q:{s}", QUOTE_TTL)
        if cached is not None and fresh and isinstance(cached, dict) and cached.get("price"):
            q = dict(cached)
            q["stale"] = False
            by_sym[s] = q
        else:
            to_fetch.append(s)

    # Keep concurrency low — Yahoo rate-limits hard on parallel .info hits
    if to_fetch:
        with ThreadPoolExecutor(max_workers=min(3, len(to_fetch))) as pool:
            futs = {pool.submit(_quote_one, s): s for s in to_fetch}
            for fut in as_completed(futs):
                sym = futs[fut]
                q: dict[str, Any] | None = None
                try:
                    q = fut.result()
                except Exception:
                    q = None
                if q is not None and q.get("price"):
                    _cache_put(f"q:{sym}", q)
                    by_sym[sym] = q
                else:
                    by_sym[sym] = _stale_quote(sym)

    return {"quotes": [by_sym[s] for s in syms]}


@app.get("/api/history/{symbol}")
def history(symbol: str, range: str = Query("1D")):
    key = range.upper()
    cfg = RANGE_MAP.get(key)
    if not cfg:
        raise HTTPException(400, "invalid range")

    display = _normalize_symbol(symbol)
    cache_key = f"h:{display}:{key}"
    cached, fresh = _cache_get(cache_key, HISTORY_TTL.get(key, 600.0))
    if cached is not None and fresh:
        out = dict(cached) if isinstance(cached, dict) else cached
        if isinstance(out, dict):
            out["stale"] = False
        return out

    failed = False
    df = None
    t = yf.Ticker(_yf_symbol(display))
    try:
        # Unadjusted closes so chart aligns with quote price
        df = t.history(period=cfg["period"], interval=cfg["interval"], auto_adjust=False)
    except Exception:
        failed = True

    if df is None or df.empty:
        if cached is not None:
            out = dict(cached) if isinstance(cached, dict) else {"points": []}
            if isinstance(out, dict):
                out["stale"] = True
            return out  # stale beats nothing when Yahoo is rate-limiting
        if failed:
            raise HTTPException(502, "upstream quote error")
        return {"points": [], "stale": True}

    points: list[dict[str, float]] = []
    for ts, row in df.iterrows():
        close = _num(row.get("Close"))
        if close is None:
            continue
        t_ms = int(ts.timestamp() * 1000)
        points.append({"t": t_ms, "p": close})

    # Snap final point to live quote so graph matches displayed price
    live = _live_price(t)
    if live is not None and points:
        points[-1] = {"t": points[-1]["t"], "p": live}
    elif live is not None and not points:
        points = [{"t": int(time.time() * 1000), "p": live}]

    result = {"points": points, "lastPrice": live, "stale": False}
    if points:
        _cache_put(cache_key, result)
    return result


@app.get("/api/search")
def search(q: str = Query(..., min_length=1, max_length=MAX_SEARCH_LEN)):
    query = q.strip()
    if not query:
        return {"results": []}
    if len(query) > MAX_SEARCH_LEN:
        raise HTTPException(400, "query too long")

    cache_key = f"s:{query.lower()}"
    cached, fresh = _cache_get(cache_key, SEARCH_TTL)
    if cached is not None and fresh:
        return cached

    try:
        s = yf.Search(query, max_results=12, news_count=0)
        quotes = s.quotes or []
    except Exception:
        if cached is not None:
            out = dict(cached) if isinstance(cached, dict) else cached
            if isinstance(out, dict):
                out["stale"] = True
            return out
        raise HTTPException(502, "upstream search error")

    results = []
    seen: set[str] = set()
    for item in quotes:
        sym = str(item.get("symbol") or "").strip()
        if not sym or sym in seen:
            continue
        qtype = str(item.get("quoteType") or item.get("typeDisp") or "")
        # Prefer equities / ETFs / funds
        if qtype and qtype.upper() not in {
            "EQUITY", "ETF", "MUTUALFUND", "INDEX", "CRYPTOCURRENCY", "ECNQUOTE", ""
        }:
            continue
        seen.add(sym)
        results.append({
            "symbol": sym,
            "name": str(item.get("longname") or item.get("shortname") or sym),
            "sector": str(item.get("sector") or item.get("typeDisp") or "—"),
            "exchange": str(item.get("exchDisp") or item.get("exchange") or ""),
            "type": qtype,
        })
    out = {"results": results[:10]}
    _cache_put(cache_key, out)
    return out


@app.get("/api/health")
def health():
    return {"ok": True, "source": "yfinance"}


if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("PORT", "8000"))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=os.environ.get("RENDER") is None)
