"""
shared.models — Trading signal generation logic.
Implements the core signal logic for each market model:
  1. KC_REVERSION (Mean reversion at Keltner edges)
  2. FLOW_TOXICITY (Adverse selection based on VPIN)
  3. LOW_VOL_ACCUM (Low volatility accumulation breakout)
  4. HIGH_VOL_MOMENTUM (High volatility trend following)
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Optional

from shared.types import Direction, Features, ModelName, Regime, Signal

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# KC_REVERSION (Mean Reversion)
# ---------------------------------------------------------------------------

def check_kc_reversion(f: Features) -> Optional[Signal]:
    """
    Buy if price hits KC-Lower in LOW/MEDIUM vol.
    Sell if price hits KC-Upper in LOW/MEDIUM vol.
    """
    if f.regime == Regime.HIGH:
        return None  # don't mean revert in high vol (trend risk)

    # Oversold (hit lower band)
    if f.close <= f.kc_lower and f.zscore <= -2.0:
        return Signal(
            timestamp=f.timestamp,
            asset=f.asset,
            model=ModelName.KC_REVERSION,
            direction=Direction.UP,
            strength=abs(f.zscore) / 2.0,
            regime=f.regime,
            features=f
        )

    # Overbought (hit upper band)
    if f.close >= f.kc_upper and f.zscore >= 2.0:
        return Signal(
            timestamp=f.timestamp,
            asset=f.asset,
            model=ModelName.KC_REVERSION,
            direction=Direction.DOWN,
            strength=f.zscore / 2.0,
            regime=f.regime,
            features=f
        )

    return None


# ---------------------------------------------------------------------------
# FLOW_TOXICITY (Adverse Selection)
# ---------------------------------------------------------------------------

def check_flow_toxicity(f: Features) -> Optional[Signal]:
    """
    High VPIN + High OFI z-score = Directional Toxicity.
    Ride the flow in high-toxicity environments.
    """
    if f.vpin < 0.7:
        return None

    # Strong buy flow
    if f.ofi_zscore >= 2.5:
        return Signal(
            timestamp=f.timestamp,
            asset=f.asset,
            model=ModelName.FLOW_TOXICITY,
            direction=Direction.UP,
            strength=f.vpin * 2.0,
            regime=f.regime,
            features=f
        )

    # Strong sell flow
    if f.ofi_zscore <= -2.5:
        return Signal(
            timestamp=f.timestamp,
            asset=f.asset,
            model=ModelName.FLOW_TOXICITY,
            direction=Direction.DOWN,
            strength=f.vpin * 2.0,
            regime=f.regime,
            features=f
        )

    return None


# ---------------------------------------------------------------------------
# LOW_VOL_ACCUM (Mean Reversion / Breakout)
# ---------------------------------------------------------------------------

def check_low_vol_accum(f: Features) -> Optional[Signal]:
    """
    In LOW vol, look for range contraction (tight KC) and slight imbalance.
    """
    if f.regime != Regime.LOW:
        return None

    # Look for tight bands (proxy: low ATR percentile)
    if f.atr_percentile > 0.15:
        return None

    if f.ofi_zscore > 1.5:
        return Signal(
            timestamp=f.timestamp,
            asset=f.asset,
            model=ModelName.LOW_VOL_ACCUM,
            direction=Direction.UP,
            strength=1.5,
            regime=f.regime,
            features=f
        )

    if f.ofi_zscore < -1.5:
        return Signal(
            timestamp=f.timestamp,
            asset=f.asset,
            model=ModelName.LOW_VOL_ACCUM,
            direction=Direction.DOWN,
            strength=1.5,
            regime=f.regime,
            features=f
        )

    return None


# ---------------------------------------------------------------------------
# HIGH_VOL_MOMENTUM
# ---------------------------------------------------------------------------

def check_high_vol_momentum(f: Features) -> Optional[Signal]:
    """
    In HIGH vol, ride the trend if OFI and Price Action align.
    """
    if f.regime != Regime.HIGH:
        return None

    # Trend following: price above KC-mid and rising
    if f.close > f.kc_mid and f.ofi_zscore > 1.0:
        return Signal(
            timestamp=f.timestamp,
            asset=f.asset,
            model=ModelName.HIGH_VOL_MOMENTUM,
            direction=Direction.UP,
            strength=2.0,
            regime=f.regime,
            features=f
        )

    if f.close < f.kc_mid and f.ofi_zscore < -1.0:
        return Signal(
            timestamp=f.timestamp,
            asset=f.asset,
            model=ModelName.HIGH_VOL_MOMENTUM,
            direction=Direction.DOWN,
            strength=2.0,
            regime=f.regime,
            features=f
        )

    return None


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------

def run_all_models(f: Features) -> list[Signal]:
    """Execute all enabled models and return fired signals."""
    signals = []
    
    for checker in [
        check_kc_reversion,
        check_flow_toxicity,
        check_low_vol_accum,
        check_high_vol_momentum
    ]:
        sig = checker(f)
        if sig:
            signals.append(sig)
            
    return signals


def best_signal(signals: list[Signal]) -> Optional[Signal]:
    """Selection logic if multiple models fire (e.g. prioritize by strength)."""
    if not signals:
        return None
    return max(signals, key=lambda s: s.strength)
