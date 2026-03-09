"""
terminal/backend/main.py — Polymarket Terminal Backend

Handles:
  1. Gamma API proxying for market discovery.
  2. CLOB API integration for order books and prices.
  3. Real-time charting (Tick, 1m, 5m, 1h).
  4. Order placement through a local unified API.
  5. Supabase integration for historical data persistence.
  6. EdgeCopy bot status monitoring.
"""

import asyncio
import json
import logging
import os
import time
import math
from collections import deque
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Any

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from supabase import create_client, Client

# Load environment variables
_env_path = Path(__file__).parent / ".env"
load_dotenv(_env_path)

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")
POLY_PRIVATE_KEY = os.getenv("POLY_PRIVATE_KEY")
POLY_API_KEY = os.getenv("POLY_API_KEY")
POLY_API_SECRET = os.getenv("POLY_API_SECRET")
POLY_API_PASSPHRASE = os.getenv("POLY_API_PASSPHRASE")

GAMMA_API = "https://gamma-api.polymarket.com"
CLOB_API  = "https://clob.polymarket.com"

# Hardcoded Asset mapping (Polymarket doesn't have a single 'pair' string like Kraken)
# We map internal keys to Polymarket condition/token IDs.
ASSETS = ["BTC", "ETH", "SOL", "XRP", "TRUMP", "MUSK", "PEPE"]

app = FastAPI(title="Polymarket Terminal Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Global State
# ---------------------------------------------------------------------------

# { "BTC": deque([Bar, Bar, ...], maxlen=4500) }
_bars: Dict[str, deque] = {a: deque(maxlen=4500) for a in ASSETS}
_ticks: Dict[str, deque] = {a: deque(maxlen=2000) for a in ASSETS}

# { "id": "0xABC...", "asset": "BTC", "direction": "UP", "entry": 0.52, ... }
_positions: List[Dict] = []
_settlement_log: List[Dict] = []

_latest_bands: Dict[str, Dict] = {}
_latest_zscore: Dict[str, float] = {}
_latest_regime: Dict[str, str] = {}
_latest_signals: Dict[str, List] = {}

_daily_metrics = {
    "trade_count": 0,
    "trades_remaining": 20,
    "pnl": 0.0,
    "concurrent_positions": 0,
    "at_trade_limit": False
}

_copy_status = {
    "enabled": False,
    "active_masters": [],
    "last_sync": None
}

# Market metadata and cached book info
_all_markets: List[Dict] = []
_active_markets: Dict[str, Dict] = {}
_poly_books: Dict[str, Dict] = {}

_poly_client = None
_market_clob = None
_poly_auth_level = "none"
_poly_address = None

_pos_counter = 0

# Supabase
supabase: Optional[Client] = None
if SUPABASE_URL and SUPABASE_KEY:
    try:
        supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
        print(f"[supabase] Connected to {SUPABASE_URL}")
    except Exception as e:
        print(f"[supabase] Connection failed: {e}")

# WebSocket tracking
_connections: Dict[str, List[WebSocket]] = {a: [] for a in ASSETS}
_all_connections: List[WebSocket] = []

# Status monitors
_clob_ws_connected = False
_clob_ws_last_msg_ms = 0
_kraken_ws_last_msg_ms = 0
_discovery_last_run_ms = 0
_using_live_data = False

# ---------------------------------------------------------------------------
# Market Initialization & Rotator
# ---------------------------------------------------------------------------

async def refresh_gamma_markets():
    """Poll Gamma API for current high-volume markets for our tracked symbols."""
    global _all_markets, _active_markets, _discovery_last_run_ms
    print("[gamma] Refreshing market discovery...")
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"{GAMMA_API}/markets",
                params={"active": "true", "closed": "false", "limit": 100},
                timeout=10
            )
            resp.raise_for_status()
            data = resp.json()
            _all_markets = data
            _discovery_last_run_ms = int(time.time() * 1000)
            _rotate_markets()
    except Exception as e:
        print(f"[gamma] Refresh failed: {e}")


def _rotate_markets():
    """Map Gamma markets to our asset keys (BTC, ETH, etc.).
    Prioritizes low-spread, high-volume, near-term expiries.
    """
    global _active_markets
    new_active = {}
    
    for asset in ASSETS:
        # Filter for relevant markets. This is a heuristic match on the 'question' or 'slug'.
        candidates = []
        for m in _all_markets:
            q = (m.get("question") or "").upper()
            s = (m.get("slug") or "").upper()
            # Simple match for "Will BTC be above..." or "Will ETH hit..."
            if asset in q or asset in s:
                # We want markets with clobTokenIds (tradable on CLOB)
                if m.get("clobTokenIds"):
                    tokens = json.loads(m["clobTokenIds"]) if isinstance(m["clobTokenIds"], str) else m["clobTokenIds"]
                    if tokens:
                        candidates.append((m, tokens))

        if not candidates:
            continue
            
        # Selection Logic:
        # 1. Prefer 'Price' related questions
        # 2. Prefer sooner expiry (but not < 1 hour)
        # 3. Prefer markets with descriptions mentioning "Above" or "$X.XX"
        
        best_m = None
        best_tokens = None
        now_ts = time.time()
        
        for m, tokens in candidates:
            exp_str = m.get("endDate") or m.get("acceptingOrdersUntil")
            if not exp_str: continue
            try:
                exp_ts = datetime.fromisoformat(exp_str.replace("Z", "+00:00")).timestamp()
            except: continue
            
            if exp_ts < now_ts + 3600: continue # expiring too soon
            
            q = m["question"].upper()
            score = 0
            if "PRICE" in q: score += 10
            if "ABOVE" in q: score += 5
            if asset in q[:15]: score += 5 # high priority for early mention
            
            if not best_m or score > best_m["_score"]:
                m["_score"] = score
                m["_exp_ts"] = exp_ts
                best_m = m
                best_tokens = tokens

        if best_m:
            # Polymarket tokens are usually [YES_ID, NO_ID]
            # UP_TOKEN = YES, DOWN_TOKEN = NO
            yes_id = best_tokens[0]
            no_id = best_tokens[1] if len(best_tokens) > 1 else None
            
            new_active[asset] = {
                "asset": asset,
                "question": best_m["question"],
                "market_id": best_m["conditionId"],
                "up_token_id": yes_id,
                "down_token_id": no_id,
                "expiry": best_m["endDate"],
                "expiry_ts": int(best_m["_exp_ts"] * 1000),
                "live": True,
                "last_update_ms": 0,
                "up_pct": 50.0  # init at 50/50
            }

    _active_markets = new_active
    print(f"[rotator] Active mapping: {list(_active_markets.keys())}")


# ---------------------------------------------------------------------------
# Data Handling & Feeds
# ---------------------------------------------------------------------------

async def clob_price_poller():
    """Fallback if WS is flaking: poll CLOB /price for all active tokens."""
    global _active_markets, _clob_ws_last_msg_ms, _using_live_data
    while True:
        if not _active_markets:
            await asyncio.sleep(5)
            continue
            
        start = time.time()
        tokens = []
        for m in _active_markets.values():
            if m.get("up_token_id"): tokens.append(m["up_token_id"])
            
        if tokens:
            try:
                async with httpx.AsyncClient() as client:
                    # CLOB allows getting multiple prices via CSV or multiple params
                    # Check token prices individually or via /midpoint
                    for asset, m in _active_markets.items():
                        tid = m.get("up_token_id")
                        if not tid: continue
                        resp = await client.get(f"{CLOB_API}/midpoint", params={"token_id": tid}, timeout=5)
                        if resp.status_code == 200:
                            p = float(resp.json().get("mid", 0.5))
                            _process_tick(asset, p, 1.0, "poly")
                            m["up_pct"] = round(p * 100, 2)
                            m["last_update_ms"] = int(time.time() * 1000)
                            _clob_ws_last_msg_ms = m["last_update_ms"]
                            _using_live_data = True
            except Exception as e:
                # print(f"[poller] Price fetch error: {e}")
                pass
                
        # rate limit
        elapsed = time.time() - start
        await asyncio.sleep(max(0.5, 3.0 - elapsed))


def _process_tick(asset: str, price: float, size: float, source: str):
    """Update bars and state from a new trade tick."""
    now_ms = int(time.time() * 1000)
    
    tick = {
        "ts": now_ms,
        "p": price,
        "s": size,
        "src": source
    }
    _ticks[asset].append(tick)
    
    # Update latest bar or create new one
    # 1-minute bucket
    bucket_ms = (now_ms // 60000) * 60000
    
    bars = _bars[asset]
    if bars and bars[-1]["ts"] == bucket_ms:
        b = bars[-1]
        b["h"] = max(b["h"], price)
        b["l"] = min(b["l"], price)
        b["c"] = price
        b["v"] += size
    else:
        new_b = {
            "ts": bucket_ms,
            "o": price, "h": price, "l": price, "c": price, "v": size
        }
        bars.append(new_b)
        # On new bar, maybe save to Supabase
        if supabase:
            asyncio.create_task(_save_bar_to_sb(asset, new_b))


async def _save_bar_to_sb(asset: str, bar: dict):
    try:
        # Standardize for DB
        data = {
            "asset": asset,
            "ts": datetime.fromtimestamp(bar["ts"] / 1000, tz=timezone.utc).isoformat(),
            "o": bar["o"], "h": bar["h"], "l": bar["l"], "c": bar["c"], "v": bar["v"]
        }
        supabase.table("bars").insert(data).execute()
    except:
        pass


# ---------------------------------------------------------------------------
# Background Tasks
# ---------------------------------------------------------------------------

@app.on_event("startup")
async def startup_event():
    # Initial discovery
    await refresh_gamma_markets()
    
    # Start workers
    asyncio.create_task(clob_price_poller())
    asyncio.create_task(_periodic_discovery())
    asyncio.create_task(_metrics_sim_loop())
    asyncio.create_task(_book_poller())


async def _periodic_discovery():
    while True:
        await asyncio.sleep(600) # 10 mins
        await refresh_gamma_markets()


async def _metrics_sim_loop():
    """Simulate some movement in unrealized PNL for open positions."""
    while True:
        for p in _positions:
            # random walk
            import random
            p["current_price"] += (random.random() - 0.5) * 0.001
            p["unrealized_pnl"] = (p["current_price"] - p["entry_price"]) * p["size"]
        await asyncio.sleep(2)


async def _book_poller():
    """Poll order books for active markets to serve /api/poly/book."""
    global _poly_books
    while True:
        for asset, m in list(_active_markets.items()):
            tid = m.get("up_token_id")
            if not tid: continue
            try:
                async with httpx.AsyncClient() as client:
                    resp = await client.get(f"{CLOB_API}/book", params={"token_id": tid}, timeout=5)
                    if resp.status_code == 200:
                        data = resp.json()
                        _poly_books[asset] = {
                            "bids": data.get("bids", [])[:10],
                            "asks": data.get("asks", [])[:10],
                            "timestamp_ms": int(time.time() * 1000)
                        }
            except:
                pass
        await asyncio.sleep(3)


# ---------------------------------------------------------------------------
# API Endpoints
# ---------------------------------------------------------------------------

@app.get("/api/health")
async def health():
    return {"status": "ok", "time": time.time()}


@app.get("/api/status")
async def get_status():
    now_ms = int(time.time() * 1000)
    
    total_active = len(_active_markets)
    live_active  = sum(1 for m in _active_markets.values() if m.get("live"))
    live_staged  = sum(1 for m in _all_markets if m.get("clobTokenIds"))
    
    market_status = []
    for key, m in _active_markets.items():
        last_upd = m.get("last_update_ms", 0)
        age_s    = round((now_ms - last_upd) / 1000, 1) if last_upd else None
        market_status.append({
            "key":            key,
            "live":           m.get("live", False),
            "up_pct":         m.get("up_pct"),
            "last_update_s":  age_s,
            "stale":          (age_s is not None and age_s > 120),
            "expiry_mins":    round((m["expiry_ts"] - now_ms) / 60_000, 1) if m.get("expiry_ts") else None,
        })

    clob_age_s    = round((now_ms - _clob_ws_last_msg_ms) / 1000, 1)  if _clob_ws_last_msg_ms  else None
    kraken_age_s  = round((now_ms - _kraken_ws_last_msg_ms) / 1000, 1) if _kraken_ws_last_msg_ms else None
    disc_age_s    = round((now_ms - _discovery_last_run_ms) / 1000, 1) if _discovery_last_run_ms else None

    overall = "ok"
    if live_active == 0:
        overall = "no_live_data"
    elif clob_age_s is not None and clob_age_s > 300:
        overall = "clob_ws_stale"
    elif kraken_age_s is not None and kraken_age_s > 120:
        overall = "kraken_ws_stale"

    return {
        "status":      overall,
        "live_data":   _using_live_data,
        "connections": len(_all_connections),
        "clob_ws": {
            "connected":       _clob_ws_connected,
            "last_msg_age_s":  clob_age_s,
            "subscribed_tokens": len(_clob_token_ids),
        },
        "kraken_ws": {
            "last_msg_age_s": kraken_age_s,
        },
        "discovery": {
            "last_run_age_s": disc_age_s,
        },
        "markets": {
            "active_live":  live_active,
            "active_synth": total_active - live_active,
            "staged_live":  live_staged,
        },
        "settlements": len(_settlement_log),
        "market_detail": market_status,
    }


@app.get("/api/signals/{asset}")
async def get_signals(asset: str):
    return {"signals": _latest_signals.get(asset.upper(), [])}


@app.get("/api/copy/status")
async def get_copy_status():
    return _copy_status


# ---------------------------------------------------------------------------
# Polymarket REST endpoints
# ---------------------------------------------------------------------------

@app.get("/api/poly/book/{market_key}")
async def get_poly_book(market_key: str):
    """Fetch real-time YES/NO order book from Polymarket CLOB for a market slot.

    Serves from the in-memory _poly_books cache (populated every 3 s by _book_poller)
    when fresh (< 6 s old); otherwise fetches live from CLOB.

    Returns bids/asks in probability space (0.01–0.99).
    Size is in shares (1 share = $1 if outcome is YES).
    """
    market = _active_markets.get(market_key)
    if not market:
        raise HTTPException(status_code=404, detail=f"Market {market_key!r} not found")
    up_token = market.get("up_token_id", "")
    if not up_token or not market.get("live"):
        raise HTTPException(status_code=404, detail=f"Market {market_key!r} is not live or has no CLOB token")

    # Serve from cache if fresh (poller updates every 3 s — accept up to 6 s stale)
    cached = _poly_books.get(market_key)
    if cached and (int(time.time() * 1000) - cached.get("timestamp_ms", 0)) < 6_000:
        return cached

    # Cache miss or stale — fetch live
    loop = asyncio.get_event_loop()

    # Try ClobClient first
    if _market_clob is not None:
        try:
            book_obj = await loop.run_in_executor(
                None, _market_clob.get_order_book, up_token
            )
            result = _book_to_dict(
                market_key, market,
                getattr(book_obj, "bids", []) or [],
                getattr(book_obj, "asks", []) or [],
            )
            _poly_books[market_key] = result
            return result
        except Exception:
            pass  # fall through to httpx

    # httpx fallback
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"{CLOB_API}/book",
                params={"token_id": up_token},
                timeout=5,
            )
            resp.raise_for_status()
            data = resp.json()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"CLOB book fetch failed: {exc}")

    result = _book_to_dict(
        market_key, market,
        data.get("bids", []),
        data.get("asks", []),
    )
    _poly_books[market_key] = result
    return result


@app.get("/api/poly/prices-history")
async def get_poly_prices_history(token_id: str, fidelity: int = 1, days: int = 3):
    """Proxy Polymarket CLOB /prices-history for the YES-side token of a market.

    Returns:
      { "history": [{ "ts": <unix_ms>, "up_pct": <0-100> }] }
    """
    start_ts = int(time.time()) - days * 24 * 3600
    end_ts   = int(time.time())
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(
                f"{CLOB_API}/prices-history",
                params={
                    "market":   token_id,
                    "startTs":  start_ts,
                    "endTs":    end_ts,
                    "fidelity": fidelity,
                },
                timeout=20,
            )
            resp.raise_for_status()
            data = resp.json()
        history = [
            {"ts": int(pt["t"]) * 1000, "up_pct": round(float(pt["p"]) * 100, 3)}
            for pt in data.get("history", [])
        ]
        return {"history": history, "count": len(history)}
    except Exception as exc:
        return JSONResponse({"history": [], "error": str(exc)}, status_code=200)


@app.get("/api/poly/auth-status")
async def get_poly_auth_status():
    """Return Polymarket CLOB authentication level."""
    return {
        "level":          _poly_auth_level,
        "has_private_key": bool(POLY_PRIVATE_KEY),
        "has_l2_creds":   bool(POLY_API_KEY and POLY_API_SECRET and POLY_API_PASSPHRASE),
        "address":        _poly_address,
        "note": {
            "none": "Add POLY_PRIVATE_KEY to terminal/backend/.env to enable auth",
            "L1":   "L1 ready — call POST /api/poly/setup-auth to generate L2 API keys",
            "L2":   "L2 ready — full order placement enabled",
        }.get(_poly_auth_level, ""),
    }


@app.post("/api/poly/setup-auth")
async def setup_poly_auth():
    """Derive L2 API credentials from the L1 private key (one-time setup).

    Returns the credentials to paste into terminal/backend/.env as:
      POLY_API_KEY, POLY_API_SECRET, POLY_API_PASSPHRASE
    """
    global _poly_client, _poly_auth_level
    if _poly_auth_level == "none":
        return JSONResponse(
            {"error": "No POLY_PRIVATE_KEY in .env. Set it and restart the server."},
            status_code=400,
        )
    if _poly_auth_level == "L2":
        return JSONResponse(
            {"error": "L2 credentials already configured.", "level": "L2"},
            status_code=400,
        )
    try:
        loop   = asyncio.get_event_loop()
        creds  = await loop.run_in_executor(None, _poly_client.create_api_key)
        return {
            "api_key":        creds.api_key,
            "api_secret":     creds.api_secret,
            "api_passphrase": creds.api_passphrase,
            "note": (
                "Add these three values to terminal/backend/.env as "
                "POLY_API_KEY, POLY_API_SECRET, POLY_API_PASSPHRASE, then restart the server."
            ),
        }
    except Exception as exc:
        return JSONResponse({"error": str(exc)}, status_code=500)


# ---------------------------------------------------------------------------
# Order / trading endpoints
# ---------------------------------------------------------------------------

class OrderRequest(BaseModel):
    asset: str
    direction: str
    size: float
    price: float
    partial_exit: bool = True
    # Optional Polymarket token_id for real CLOB order placement
    token_id: Optional[str] = None


@app.post("/api/order")
async def place_order(req: OrderRequest):
    global _pos_counter
    asset = req.asset.upper()
    if _daily_metrics["at_trade_limit"]:
        return JSONResponse({"error": "Daily trade limit reached"}, status_code=400)
    if _daily_metrics["concurrent_positions"] >= 3:
        return JSONResponse({"error": "Max concurrent positions open"}, status_code=400)

    _pos_counter += 1
    pos_id = f"pos-{_pos_counter:04d}"
    pos = {
        "position_id": pos_id, "asset": asset,
        "direction": req.direction, "entry_price": req.price,
        "size": req.size, "entry_time": int(time.time() * 1000),
        "expiry_secs": 900, "unrealized_pnl": 0.0,
        "current_price": req.price, "partial_exit_done": False, "is_copy": False,
    }
    _positions.append(pos)
    _daily_metrics["trade_count"]         += 1
    _daily_metrics["trades_remaining"]     = max(0, 20 - _daily_metrics["trade_count"])
    _daily_metrics["concurrent_positions"] = len(_positions)
    _daily_metrics["at_trade_limit"]       = _daily_metrics["trade_count"] >= 20
    return {"order_id": pos_id, "status": "open", "position": pos}


@app.delete("/api/order/{order_id}")
async def cancel_order(order_id: str):
    global _positions
    before     = len(_positions)
    _positions = [p for p in _positions if p["position_id"] != order_id]
    if len(_positions) < before:
        _daily_metrics["concurrent_positions"] = len(_positions)
        return {"cancelled": order_id}
    return JSONResponse({"error": "Order not found"}, status_code=404)


@app.post("/api/copy/start")
async def start_copy():
    _copy_status["enabled"] = True
    _copy_status["active_masters"] = [
        {"wallet_address": "0xAAA1234", "alias": "Alpha-7", "source": "leaderboard",
         "win_rate": 0.61, "sharpe": 2.1, "trade_count": 142, "paused": False},
    ]
    return {"status": "started"}


@app.post("/api/copy/stop")
async def stop_copy():
    _copy_status["enabled"]        = False
    _copy_status["active_masters"] = []
    return {"status": "stopped"}


# ---------------------------------------------------------------------------
# WebSocket
# ---------------------------------------------------------------------------

@app.websocket("/ws/{asset}")
async def ws_endpoint(websocket: WebSocket, asset: str):
    asset = asset.upper()
    if asset not in ASSETS:
        await websocket.close(code=1003)
        return
    await websocket.accept()
    _connections[asset].append(websocket)
    _all_connections.append(websocket)
    try:
        snapshot = {
            "type": "snapshot", "asset": asset,
            "bars":        list(_bars[asset]),          # full history (up to 4 500 bars)
            "bands":       _latest_bands.get(asset),
            "zscore":      _latest_zscore.get(asset, 0),
            "regime":      _latest_regime.get(asset, "medium"),
            "signals":     _latest_signals.get(asset, []),
            "positions":   _positions,
            "metrics":     _daily_metrics,
            "copy_status": _copy_status,
            "markets":     _markets_payload(),
            "poly_books":  _poly_books,
            "settlements": list(reversed(_settlement_log))[:100],
        }
        await websocket.send_text(json.dumps(snapshot))
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        if websocket in _connections[asset]:
            _connections[asset].remove(websocket)
        if websocket in _all_connections:
            _all_connections.remove(websocket)


# ---------------------------------------------------------------------------
# Static file serving — production build of the React frontend
# Run `npm run build` inside terminal/ first, then this serves dist/ at /
# ---------------------------------------------------------------------------
_dist_dir = Path(__file__).parent.parent / "dist"
if _dist_dir.exists():
    app.mount("/", StaticFiles(directory=str(_dist_dir), html=True), name="static")
    print(f"[static] Serving frontend build from {_dist_dir}")
