"""
shared.types — Global type definitions and data structures.
Employs frozen dataclasses for immutability and Enums for safety.
Used by both backend, edgecopy bot, and features engine.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Any, Optional


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------

class Direction(Enum):
    UP   = "UP"     # YES share / Long
    DOWN = "DOWN"   # NO share / Short


class Regime(Enum):
    LOW    = "low"
    MEDIUM = "medium"
    HIGH   = "high"


class ModelName(Enum):
    KC_REVERSION       = "kc_reversion"
    FLOW_TOXICITY      = "flow_toxicity"
    LOW_VOL_ACCUM      = "low_vol_accum"
    HIGH_VOL_MOMENTUM  = "high_vol_momentum"


class OrderStatus(Enum):
    OPEN      = "open"
    FILLED    = "filled"
    CANCELLED = "cancelled"
    EXPIRED   = "expired"


# ---------------------------------------------------------------------------
# Market Data Containers
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class Bar:
    """Standard OHLCV bar."""
    timestamp: datetime
    open:      float
    high:      float
    low:       float
    close:     float
    volume:    float


@dataclass(frozen=True)
class TradeTick:
    """Raw trade execution event (e.g. from Kraken or Polymarket)."""
    timestamp:  datetime
    price:      float
    size:       float
    side:       str      # "buy" or "sell"


@dataclass(frozen=True)
class OrderBookLevel:
    price: float
    size:  float


@dataclass(frozen=True)
class OrderBook:
    """L2 snapshot of buy/sell depth."""
    market_id:  str
    bids:       list[OrderBookLevel]
    asks:       list[OrderBookLevel]
    mid:        Optional[float]
    timestamp:  datetime


# ---------------------------------------------------------------------------
# Signal and Logic Containers
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class Features:
    """Rich technical context for a specific point in time."""
    timestamp:          datetime
    asset:              str
    
    # Technicals
    kc_upper:           float
    kc_mid:             float
    kc_lower:           float
    close:              float
    zscore:             float     # price vs EMA
    atr:                float
    atr_percentile:     float     # relative volatility (0-1)
    regime:             Regime
    
    # Microstructure
    ofi:                float     # order flow imbalance (-1 to 1)
    ofi_zscore:         float
    vpin:               float     # informed trading proxy (0-1)
    depth_ratio:        float     # bid vs ask depth at top of book
    bid_ask_imbalance:  float
    
    price_change_5m:    float     # simple momentum


@dataclass(frozen=True)
class Signal:
    """Output from a trading model."""
    timestamp:  datetime
    asset:      str
    model:      ModelName
    direction:  Direction
    strength:   float           # 0.0 to 3.0 (confidence score)
    regime:     Regime
    features:   Features


# ---------------------------------------------------------------------------
# Position and Execution Containers
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class Order:
    """Request or record of an order placement."""
    order_id:   str
    market_id:  str
    direction:  Direction
    price:      float
    size:       float
    status:     OrderStatus
    fill_price: Optional[float] = None
    timestamp:  datetime = field(default_factory=datetime.now)


@dataclass(frozen=True)
class Position:
    """Active exposure in a market."""
    position_id:      str
    asset:            str
    direction:        Direction
    entry_price:      float
    size:             float           # initial size
    current_size:     float           # remaining size (if partial exit)
    entry_time:       datetime
    unrealized_pnl:   float = 0.0
    partial_exit:     bool = False


@dataclass(frozen=True)
class Trade:
    """Immutable record of a CLOSED trade."""
    trade_id:           str
    market_id:          str
    asset:              str
    direction:          Direction
    model:              Optional[ModelName]
    regime:             Regime
    entry_time:         datetime
    exit_time:          datetime
    entry_price:        float
    exit_price:         float
    size:               float           # size at entry
    gross_pnl:          float
    net_pnl:            float
    fee_usd:            float
    slippage_pips:      float
    win:                bool
    
    # Copy trading specific
    is_copy:            bool = False
    master_trade_id:    Optional[str] = None
    master_entry_price: Optional[float] = None
    copy_divergence:    Optional[float] = None  # slippage vs master
    
    metadata:           dict[str, Any] = field(default_factory=dict)


# ---------------------------------------------------------------------------
# Bot Configuration Containers
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class MasterTrader:
    """Profile of a trader we are following."""
    wallet_address:   str
    alias:            Optional[str]
    source:           str             # "leaderboard" or "manual"
    win_rate:         float = 0.0
    sharpe:           float = 0.0
    profit_factor:    float = 0.0
    max_drawdown:     float = 0.0
    trade_count:      int = 0
    paused:           bool = False


@dataclass(frozen=True)
class CopyConfig:
    """Bot-specific copy logic."""
    sizing_mode:            str   # "proportional" | "kelly" | "fixed"
    fixed_size_usd:         float = 100.0
    kelly_fraction:         float = 0.25
    max_size_usd:           float = 500.0
    regime_reduce_high_vol: bool = True


@dataclass(frozen=True)
class PartialExitConfig:
    enabled:              bool = True
    first_exit_multiple:  float = 2.0  # target (e.g. 2x)
    first_exit_fraction:  float = 0.5  # sell 50%
