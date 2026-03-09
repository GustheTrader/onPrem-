"""
shared.features — Feature engineering and technical indicators.
Pure functions for RSI, EMA, ATR, Keltner Channels, Z-score, OFI, VPIN.
"""

from __future__ import annotations

import logging
import math
import statistics
from datetime import datetime
from typing import Optional

from shared.types import Bar, Features, Regime, TradeTick

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Core Math Utilities
# ---------------------------------------------------------------------------

def _ema(values: list[float], period: int) -> list[float]:
    """Compute Exponential Moving Average."""
    if not values:
        return []
    alpha = 2 / (period + 1)
    results = [float('nan')] * len(values)
    
    # Need enough data for the first seed point (simple average)
    if len(values) < period:
        return results
        
    seed = sum(values[:period]) / period
    results[period - 1] = seed
    
    for i in range(period, len(values)):
        results[i] = alpha * values[i] + (1 - alpha) * results[i - 1]
    return results


def _true_range(bars: list[Bar]) -> list[float]:
    """Compute True Range sequence."""
    if not bars:
        return []
    tr = [float('nan')] * len(bars)
    tr[0] = bars[0].high - bars[0].low
    for i in range(1, len(bars)):
        c1 = bars[i - 1].close
        h = bars[i].high
        l = bars[i].low
        tr[i] = max(h - l, abs(h - c1), abs(l - c1))
    return tr


def _atr(bars: list[Bar], period: int) -> list[float]:
    """Compute Average True Range using EMA of TR."""
    tr = _true_range(bars)
    # Filter nan for the EMA calc then pad back
    return _ema(tr, period)


def _rolling_std(values: list[float], period: int) -> list[float]:
    results = [float('nan')] * len(values)
    if len(values) < period:
        return results
    for i in range(period - 1, len(values)):
        window = values[i - period + 1 : i + 1]
        results[i] = statistics.stdev(window) if len(window) > 1 else 0.0
    return results


def _percentile_rank(value: float, history: list[float]) -> float:
    """Returns 0.0 to 1.0 ranking where value sits in history."""
    if not history:
        return 0.5
    count = sum(1 for x in history if x < value)
    return count / len(history)


# ---------------------------------------------------------------------------
# Indicator Logic
# ---------------------------------------------------------------------------

def calc_keltner(bars: list[Bar], period: int = 20, atr_mult: float = 2.5) -> tuple[list[float], list[float], list[float]]:
    """Compute Keltner Channels (EMA +/- ATR multiplier)."""
    closes = [b.close for b in bars]
    mid = _ema(closes, period)
    atr = _atr(bars, period)
    
    upper = [m + (a * atr_mult) for m, a in zip(mid, atr)]
    lower = [m - (a * atr_mult) for m, a in zip(mid, atr)]
    return upper, mid, lower


def calc_zscore(price: float, mean: float, std: float) -> float:
    if std < 1e-12:
        return 0.0
    return (price - mean) / std


def classify_regime(atr: float, atr_history: list[float]) -> Regime:
    """Classify market regime based on relative volatility (ATR percentile)."""
    p = _percentile_rank(atr, atr_history)
    if p < 0.30:
        return Regime.LOW
    if p > 0.70:
        return Regime.HIGH
    return Regime.MEDIUM


def zscore_bucket(z: float) -> int:
    """Convert z-score to discrete feature bucket (0-4)."""
    if z < -2: return 0
    if z < -0.5: return 1
    if z <= 0.5: return 2
    if z <= 2: return 3
    return 4


# ---------------------------------------------------------------------------
# Microstructure Logic
# ---------------------------------------------------------------------------

def calc_ofi(ticks: list[TradeTick]) -> float:
    """Compute Order Flow Imbalance (-1.0 to 1.0)."""
    if not ticks:
        return 0.0
    buy_vol = sum(t.size for t in ticks if t.side.lower() == "buy")
    sell_vol = sum(t.size for t in ticks if t.side.lower() == "sell")
    total = buy_vol + sell_vol
    if total < 1e-9:
        return 0.0
    return (buy_vol - sell_vol) / total


def calc_ofi_zscore(ofi: float, ofi_history: list[float]) -> float:
    if not ofi_history:
        return 0.0
    mean = sum(ofi_history) / len(ofi_history)
    std = statistics.stdev(ofi_history) if len(ofi_history) > 1 else 0.1
    return calc_zscore(ofi, mean, std)


def calc_vpin(ticks: list[TradeTick], volume_buckets: int = 50) -> float:
    """Volume-synchronized Probability of Informed Trading (simplified)."""
    if not ticks:
        return 0.5
    # Split into buckets of roughly equal volume
    total_vol = sum(t.size for t in ticks)
    if total_vol < 1e-9:
        return 0.5
    bucket_vol = total_vol / volume_buckets
    
    imbalances = []
    current_buy = 0.0
    current_sell = 0.0
    current_acc = 0.0
    
    for t in ticks:
        if t.side.lower() == "buy":
            current_buy += t.size
        else:
            current_sell += t.size
        current_acc += t.size
        
        if current_acc >= bucket_vol:
            imbalances.append(abs(current_buy - current_sell))
            current_buy, current_sell, current_acc = 0, 0, 0
            
    if not imbalances:
        return 0.5
    return sum(imbalances) / (volume_buckets * bucket_vol)


# ---------------------------------------------------------------------------
# Sizing Logic
# ---------------------------------------------------------------------------

def kelly_size(
    win_rate: float,
    avg_win: float,
    avg_loss: float,
    fraction: float = 0.25,
    account_balance: float = 10_000,
    max_size: float = 500,
) -> float:
    """Compute Kelly Criterion position size, capped and fraction-adjusted."""
    if avg_loss < 1e-9:
        return 0.0
    b = avg_win / avg_loss
    # f* = (p*b - q) / b
    f_star = (win_rate * b - (1 - win_rate)) / b
    
    if f_star <= 0:
        return 0.0
        
    size = account_balance * f_star * fraction
    return min(size, max_size)


# ---------------------------------------------------------------------------
# Feature Engine Class
# ---------------------------------------------------------------------------

class FeatureEngine:
    """
    Stateful engine to compute technical features from streaming bars and ticks.
    Maintains internal history buffers for rolling calculations.
    """
    
    def __init__(
        self,
        asset: str,
        ema_period: int = 20,
        atr_period: int = 14,
        atr_mult: float = 2.5,
        regime_lookback: int = 100,
        ofi_lookback: int = 50,
    ) -> None:
        self.asset = asset
        self.ema_period = ema_period
        self.atr_period = atr_period
        self.atr_mult = atr_mult
        self.regime_lookback = regime_lookback
        self.ofi_lookback = ofi_lookback
        
        # Buffers
        self._bars: list[Bar] = []
        self._atr_history: list[float] = []
        self._ofi_history: list[float] = []
        
    def update(self, bar: Bar, ticks: list[TradeTick] = None) -> Optional[Features]:
        """Update state with new bar and optional ticks, return computed features."""
        self._bars.append(bar)
        if len(self._bars) > max(self.regime_lookback, self.ema_period, self.atr_period) + 10:
            self._bars.pop(0)
            
        if len(self._bars) < self.ema_period:
            return None
            
        # 1. Keltner Channels
        upper, mid, lower = calc_keltner(self._bars, self.ema_period, self.atr_mult)
        u, m, l = upper[-1], mid[-1], lower[-1]
        
        # 2. Volatility and Regime
        atr_list = _atr(self._bars, self.atr_period)
        cur_atr = atr_list[-1]
        if not math.isnan(cur_atr):
            self._atr_history.append(cur_atr)
            if len(self._atr_history) > self.regime_lookback:
                self._atr_history.pop(0)
                
        regime = classify_regime(cur_atr, self._atr_history)
        
        # 3. Z-Score (price vs EMA)
        stdevs = _rolling_std([b.close for b in self._bars], self.ema_period)
        z = calc_zscore(bar.close, m, stdevs[-1])
        
        # 4. Microstructure (OFI, VPIN)
        ofi = calc_ofi(ticks) if ticks else 0.0
        self._ofi_history.append(ofi)
        if len(self._ofi_history) > self.ofi_lookback:
            self._ofi_history.pop(0)
        ofi_z = calc_ofi_zscore(ofi, self._ofi_history)
        
        vpin = calc_vpin(ticks) if ticks else 0.5
        
        # 5. Order book imbalance proxy (from ticks if not provided)
        # In a real setup, we'd pass raw OrderBook object here.
        depth_ratio = 1.0 # placeholder
        
        return Features(
            timestamp=bar.timestamp,
            asset=self.asset,
            kc_upper=u,
            kc_mid=m,
            kc_lower=l,
            close=bar.close,
            zscore=z,
            atr=cur_atr,
            atr_percentile=_percentile_rank(cur_atr, self._atr_history),
            regime=regime,
            ofi=ofi,
            ofi_zscore=ofi_z,
            vpin=vpin,
            depth_ratio=depth_ratio,
            bid_ask_imbalance=0.0,
            price_change_5m=0.0 # to be implemented via external momentum check
        )
