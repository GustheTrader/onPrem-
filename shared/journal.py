"""
shared.journal — Persistence for trades and performance tracking.
Implements a lightweight SQLite-backed journal for recording trades,
calculating P&L, and generating performance metrics.
"""

from __future__ import annotations

import json
import logging
import sqlite3
from contextlib import asynccontextmanager
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, AsyncGenerator, Optional

from shared.types import Direction, Regime, Trade

logger = logging.getLogger(__name__)


class Journal:
    """
    Persistent trade journal using SQLite.
    Optimised for sub-second writes and bulk analytical queries.
    """

    def __init__(self, db_path: Path) -> None:
        self.db_path = db_path
        self._init_db()

    def _init_db(self) -> None:
        """Create schema if it doesn't exist."""
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS trades (
                    trade_id TEXT PRIMARY KEY,
                    market_id TEXT NOT NULL,
                    asset TEXT NOT NULL,
                    direction TEXT NOT NULL,
                    model TEXT,
                    regime TEXT NOT NULL,
                    entry_time INTEGER NOT NULL,
                    exit_time INTEGER NOT NULL,
                    entry_price REAL NOT NULL,
                    exit_price REAL NOT NULL,
                    size REAL NOT NULL,
                    gross_pnl REAL NOT NULL,
                    net_pnl REAL NOT NULL,
                    fee_usd REAL NOT NULL,
                    slippage_pips REAL NOT NULL,
                    win INTEGER NOT NULL,
                    is_copy INTEGER DEFAULT 0,
                    master_trade_id TEXT,
                    master_entry_price REAL,
                    copy_divergence REAL,
                    metadata_json TEXT
                )
            """)
            conn.execute("CREATE INDEX IF NOT EXISTS idx_trades_time ON trades(entry_time)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_trades_asset ON trades(asset)")

    @classmethod
    @asynccontextmanager
    async def open(cls, db_path: str | Path) -> AsyncGenerator[Journal, None]:
        """Context manager for async usage."""
        journal = cls(Path(db_path))
        yield journal

    async def record(self, trade: Trade) -> None:
        """Persist a closed trade to the database."""
        try:
            with sqlite3.connect(self.db_path) as conn:
                conn.execute(
                    """
                    INSERT INTO trades (
                        trade_id, market_id, asset, direction, model, regime,
                        entry_time, exit_time, entry_price, exit_price,
                        size, gross_pnl, net_pnl, fee_usd, slippage_pips, win,
                        is_copy, master_trade_id, master_entry_price, copy_divergence,
                        metadata_json
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        trade.trade_id,
                        trade.market_id,
                        trade.asset,
                        trade.direction.value,
                        trade.model.value if trade.model else None,
                        trade.regime.value,
                        int(trade.entry_time.timestamp() * 1000),
                        int(trade.exit_time.timestamp() * 1000),
                        trade.entry_price,
                        trade.exit_price,
                        trade.size,
                        trade.gross_pnl,
                        trade.net_pnl,
                        trade.fee_usd,
                        trade.slippage_pips,
                        1 if trade.win else 0,
                        1 if trade.is_copy else 0,
                        trade.master_trade_id,
                        trade.master_entry_price,
                        trade.copy_divergence,
                        json.dumps(trade.metadata or {})
                    )
                )
            logger.info("Trade recorded: %s | Net P&L: $%.2f", trade.trade_id[:8], trade.net_pnl)
        except Exception as exc:
            logger.error("Failed to record trade %s: %s", trade.trade_id, exc)

    async def get_all(
        self,
        since: Optional[datetime] = None,
        until: Optional[datetime] = None,
        asset: Optional[str] = None,
        is_copy: Optional[bool] = None,
        limit: int = 1000,
    ) -> list[Trade]:
        """Query trades with filters."""
        query = "SELECT * FROM trades WHERE 1=1"
        params: list[Any] = []

        if since:
            query += " AND entry_time >= ?"
            params.append(int(since.timestamp() * 1000))
        if until:
            query += " AND entry_time <= ?"
            params.append(int(until.timestamp() * 1000))
        if asset:
            query += " AND asset = ?"
            params.append(asset)
        if is_copy is not None:
            query += " AND is_copy = ?"
            params.append(1 if is_copy else 0)

        query += " ORDER BY entry_time DESC LIMIT ?"
        params.append(limit)

        trades = []
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.execute(query, params)
            for row in cursor:
                trades.append(self._row_to_trade(row))
        return trades

    async def today_pnl(self) -> float:
        """Total net P&L for the current UTC day."""
        start_of_day = datetime.now(tz=timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
        ts = int(start_of_day.timestamp() * 1000)
        with sqlite3.connect(self.db_path) as conn:
            row = conn.execute("SELECT SUM(net_pnl) FROM trades WHERE entry_time >= ?", (ts,)).fetchone()
            return row[0] if row[0] is not None else 0.0

    async def today_count(self) -> int:
        start_of_day = datetime.now(tz=timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
        ts = int(start_of_day.timestamp() * 1000)
        with sqlite3.connect(self.db_path) as conn:
            row = conn.execute("SELECT COUNT(*) FROM trades WHERE entry_time >= ?", (ts,)).fetchone()
            return row[0] or 0

    def _row_to_trade(self, row: sqlite3.Row) -> Trade:
        metadata = {}
        if row["metadata_json"]:
            try:
                metadata = json.loads(row["metadata_json"])
            except Exception:
                pass

        return Trade(
            trade_id=row["trade_id"],
            market_id=row["market_id"],
            asset=row["asset"],
            direction=Direction(row["direction"]),
            model=None, # To be reconstructed if needed
            regime=Regime(row["regime"]),
            entry_time=datetime.fromtimestamp(row["entry_time"] / 1000, tz=timezone.utc),
            exit_time=datetime.fromtimestamp(row["exit_time"] / 1000, tz=timezone.utc),
            entry_price=row["entry_price"],
            exit_price=row["exit_price"],
            size=row["size"],
            gross_pnl=row["gross_pnl"],
            net_pnl=row["net_pnl"],
            fee_usd=row["fee_usd"],
            slippage_pips=row["slippage_pips"],
            win=bool(row["win"]),
            is_copy=bool(row["is_copy"]),
            master_trade_id=row["master_trade_id"],
            master_entry_price=row["master_entry_price"],
            copy_divergence=row["copy_divergence"],
            metadata=metadata
        )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def build_trade(
    market_id: str,
    asset: str,
    direction: Direction,
    model: Optional[Any],
    regime: Regime,
    entry_time: datetime,
    exit_time: datetime,
    entry_price: float,
    exit_price: float,
    size_usd: float,
    fee_rate: float = 0.02,
    slippage_bps: float = 3.0,
    is_copy: bool = False,
    master_trade_id: Optional[str] = None,
    master_entry_price: Optional[float] = None,
) -> Trade:
    """Convenience mapper to create a Trade object with P&L pre-calculated."""
    import uuid
    
    # Simple gross P&L: (exit - entry) / entry * size
    # For NO options (DOWN), it's (entry - exit) / entry * size
    if direction == Direction.UP:
        raw_ret = (exit_price - entry_price) / entry_price if entry_price > 0 else 0
    else:
        raw_ret = (entry_price - exit_price) / entry_price if entry_price > 0 else 0
        
    gross_pnl = raw_ret * size_usd
    fee_usd = size_usd * fee_rate
    net_pnl = gross_pnl - fee_usd
    
    divergence = None
    if is_copy and master_entry_price:
        divergence = abs(entry_price - master_entry_price)

    return Trade(
        trade_id=str(uuid.uuid4()),
        market_id=market_id,
        asset=asset,
        direction=direction,
        model=model,
        regime=regime,
        entry_time=entry_time,
        exit_time=exit_time,
        entry_price=entry_price,
        exit_price=exit_price,
        size=size_usd,
        gross_pnl=gross_pnl,
        net_pnl=net_pnl,
        fee_usd=fee_usd,
        slippage_pips=slippage_bps,
        win=net_pnl > 0,
        is_copy=is_copy,
        master_trade_id=master_trade_id,
        master_entry_price=master_entry_price,
        copy_divergence=divergence
    )
