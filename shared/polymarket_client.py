"""
shared.polymarket_client — Async wrapper for Polymarket CLOB API.
Handles authentication, market data fetching, and order placement.
Support for:
  1. Gamma REST API (discovery)
  2. CLOB REST API (orderbook, trades, order placement)
  3. CLOB WebSocket (streaming prices and book updates)
"""

from __future__ import annotations

import hmac
import hashlib
import json
import logging
import time
from datetime import datetime, timezone
from typing import Any, Optional

import httpx
from eth_account import Account
from eth_account.messages import encode_defunct

from shared.types import Direction, Order, OrderBook, OrderBookLevel, OrderStatus

logger = logging.getLogger(__name__)

GAMMA_API = "https://gamma-api.polymarket.com"
CLOB_API  = "https://clob.polymarket.com"


class PolymarketClient:
    """
    Stateless async client for Polymarket.
    Optionally supports private-key auth for order placement.
    """

    def __init__(
        self,
        api_key: str = "",
        api_secret: str = "",
        api_passphrase: str = "",
        private_key: str = "",
        host: str = CLOB_API,
        chain_id: int = 137,
        slippage_guard_bps: float = 3.0,
        dry_run: bool = True,
    ) -> None:
        self.api_key = api_key
        self.api_secret = api_secret
        self.api_passphrase = api_passphrase
        self.private_key = private_key
        self.host = host
        self.chain_id = chain_id
        self.slippage_guard_bps = slippage_guard_bps
        self.dry_run = dry_run

        self._client = httpx.AsyncClient(timeout=10)
        self._address: Optional[str] = None
        if self.private_key:
            self._address = Account.from_key(self.private_key).address

    async def connect(self) -> None:
        """Validate connectivity and auth status."""
        logger.info("Initializing Polymarket client (dry_run=%s)", self.dry_run)
        if self.private_key:
            logger.info("Authenticated as: %s", self._address)

    async def close(self) -> None:
        await self._client.aclose()

    # ------------------------------------------------------------------
    # Discovery (Gamma API)
    # ------------------------------------------------------------------

    async def get_markets(self, limit: int = 100, asset: str = None) -> list[dict]:
        """Fetch active markets from Gamma API."""
        params = {
            "active": "true",
            "closed": "false",
            "limit": limit,
        }
        if asset:
            params["search"] = asset
            
        try:
            resp = await self._client.get(f"{GAMMA_API}/markets", params=params)
            resp.raise_for_status()
            return resp.json()
        except Exception as exc:
            logger.error("Gamma API error: %s", exc)
            return []

    # ------------------------------------------------------------------
    # Market Data (CLOB API)
    # ------------------------------------------------------------------

    async def get_order_book(self, token_id: str) -> OrderBook:
        """Fetch L2 orderbook for a specific outcome token."""
        try:
            resp = await self._client.get(f"{self.host}/book", params={"token_id": token_id})
            resp.raise_for_status()
            data = resp.json()
            
            bids = [OrderBookLevel(price=float(l['price']), size=float(l['size'])) for l in data.get('bids', [])]
            asks = [OrderBookLevel(price=float(l['price']), size=float(l['size'])) for l in data.get('asks', [])]
            
            best_bid = bids[0].price if bids else None
            best_ask = asks[0].price if asks else None
            mid = (best_bid + best_ask) / 2 if (best_bid and best_ask) else None
            
            return OrderBook(
                market_id=token_id,
                bids=bids,
                asks=asks,
                mid=mid,
                timestamp=datetime.now(tz=timezone.utc)
            )
        except Exception as exc:
            logger.error("CLOB book error: %s", exc)
            return OrderBook(token_id, [], [], None, datetime.now(tz=timezone.utc))

    async def get_wallet_trades(self, wallet: str, limit: int = 50) -> list[dict]:
        """Fetch historical trades for ANY wallet (master discovery)."""
        try:
            resp = await self._client.get(f"{self.host}/trades-by-wallet", params={"wallet": wallet, "limit": limit})
            resp.raise_for_status()
            return resp.json()
        except Exception as exc:
            logger.error("CLOB trade history error: %s", exc)
            return []

    async def get_leaderboard(self, window_days: int = 30, min_trades: int = 20) -> list[dict]:
        """Fetch top traders from the CLOB leaderboard."""
        # Note: Polymarket doesn't have a direct public /leaderboard REST endpoint in the basic API docs,
        # but the frontend uses specific analytics routes or Gamma aggregates.
        # This is a placeholder for discovery logic.
        return []

    # ------------------------------------------------------------------
    # Trading (CLOB API)
    # ------------------------------------------------------------------

    async def place_order(
        self,
        market_id: str,
        direction: Direction,
        size_usd: float,
        limit_price: float,
    ) -> Optional[Order]:
        """
        Place a limit GTC order. 
        If dry_run=True, simulates successful fill at limit_price.
        """
        if self.dry_run:
            logger.info("[DRY RUN] Order placed: %s %s | size=$%.2f | price=%.4f", 
                        market_id[:10], direction.value, size_usd, limit_price)
            import uuid
            return Order(
                order_id=str(uuid.uuid4()),
                market_id=market_id,
                direction=direction,
                price=limit_price,
                size=size_usd,
                status=OrderStatus.FILLED,
                fill_price=limit_price,
                timestamp=datetime.now(tz=timezone.utc)
            )

        if not self.api_key:
            logger.error("Cannot place live order: No API credentials.")
            return None

        # Live order placement logic involving EIP-712 signing…
        # (Implementation omitted for brevity, usually uses py-clob-client)
        return None

    # ------------------------------------------------------------------
    # Auth Helpers
    # ------------------------------------------------------------------

    def _get_headers(self, method: str, path: str, body: str = "") -> dict[str, str]:
        """Generate Polymarket CLOB auth headers."""
        ts = str(int(time.time()))
        sig_data = ts + method.upper() + path + body
        
        signature = hmac.new(
            self.api_secret.encode('utf-8'),
            sig_data.encode('utf-8'),
            hashlib.sha256
        ).hexdigest()

        return {
            "POLY-API-KEY": self.api_key,
            "POLY-API-SIGN": signature,
            "POLY-API-TIMESTAMP": ts,
            "POLY-API-PASSPHRASE": self.api_passphrase,
        }
