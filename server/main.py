from __future__ import annotations

import math
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any

import yfinance as yf
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Vantage yfinance API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

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
# back to stale entries when yfinance errors out.
_CACHE: dict[str, tuple[float, Any]] = {}
_CACHE_LOCK = threading.Lock()

QUOTE_TTL = 60.0
HISTORY_TTL = {
    "1D": 120.0, "1W": 300.0, "1M": 600.0, "3M": 900.0, "6M": 900.0,
    "YTD": 900.0, "1Y": 1800.0, "2Y": 3600.0, "5Y": 3600.0, "10Y": 3600.0,
    "ALL": 3600.0,
}
SEARCH_TTL = 300.0


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
    }
    if err:
        q["error"] = err
    return q


@app.get("/api/quotes")
def quotes(symbols: str = Query(..., description="Comma-separated tickers")):
    syms = [s.strip().upper() for s in symbols.split(",") if s.strip()]
    if not syms:
        raise HTTPException(400, "symbols required")

    by_sym: dict[str, dict[str, Any]] = {}
    to_fetch: list[str] = []
    for s in syms:
        cached, fresh = _cache_get(f"q:{s}", QUOTE_TTL)
        if cached is not None and fresh:
            by_sym[s] = cached
        else:
            to_fetch.append(s)

    if to_fetch:
        with ThreadPoolExecutor(max_workers=min(8, len(to_fetch))) as pool:
            futs = {pool.submit(_quote_one, s): s for s in to_fetch}
            for fut in as_completed(futs):
                sym = futs[fut]
                q: dict[str, Any] | None = None
                err: str | None = None
                try:
                    q = fut.result()
                except Exception as e:
                    err = str(e)
                if q is not None and q.get("price"):
                    _cache_put(f"q:{sym}", q)
                    by_sym[sym] = q
                else:
                    # Fetch failed or returned no price: fall back to stale cache
                    stale, _ = _cache_get(f"q:{sym}", QUOTE_TTL)
                    by_sym[sym] = stale if stale is not None else (q or _empty_quote(sym, err))

    return {"quotes": [by_sym[s] for s in syms]}


@app.get("/api/history/{symbol}")
def history(symbol: str, range: str = Query("1D")):
    key = range.upper()
    cfg = RANGE_MAP.get(key)
    if not cfg:
        raise HTTPException(400, f"invalid range: {range}")

    cache_key = f"h:{symbol.upper()}:{key}"
    cached, fresh = _cache_get(cache_key, HISTORY_TTL.get(key, 600.0))
    if cached is not None and fresh:
        return cached

    err: str | None = None
    df = None
    display = symbol.strip().upper()
    t = yf.Ticker(_yf_symbol(display))
    try:
        # Unadjusted closes so chart aligns with quote price
        df = t.history(period=cfg["period"], interval=cfg["interval"], auto_adjust=False)
    except Exception as e:
        err = str(e)

    if df is None or df.empty:
        if cached is not None:
            return cached  # stale beats nothing when Yahoo is rate-limiting
        if err:
            raise HTTPException(502, f"yfinance error: {err}")
        return {"points": []}

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

    result = {"points": points, "lastPrice": live}
    if points:
        _cache_put(cache_key, result)
    return result


@app.get("/api/search")
def search(q: str = Query(..., min_length=1)):
    query = q.strip()
    if not query:
        return {"results": []}

    cache_key = f"s:{query.lower()}"
    cached, fresh = _cache_get(cache_key, SEARCH_TTL)
    if cached is not None and fresh:
        return cached

    try:
        s = yf.Search(query, max_results=12, news_count=0)
        quotes = s.quotes or []
    except Exception as e:
        if cached is not None:
            return cached
        raise HTTPException(502, f"search error: {e}") from e

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

    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)
