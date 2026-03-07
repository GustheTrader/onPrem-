"""
tests/test_features.py — Unit tests for shared.features

Run with:
    pytest tests/test_features.py -v

No network calls, no files — pure math validation.
"""

from __future__ import annotations

import math
from datetime import datetime, timezone
from unittest.mock import MagicMock

import pytest

from shared.features import (
    FeatureEngine,
    _ema,
    _atr,
    _rolling_std,
    _percentile_rank,
    calc_keltner,
    calc_ofi,
    calc_ofi_zscore,
    calc_vpin,
    calc_zscore,
    classify_regime,
    kelly_size,
    zscore_bucket,
)
from shared.types import Bar, OrderBook, OrderBookLevel, Regime, TradeTick


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _bar(close: float, high: float | None = None, low: float | None = None) -> Bar:
    high = high if high is not None else close * 1.005
    low = low if low is not None else close * 0.995
    return Bar(
        timestamp=datetime.now(tz=timezone.utc),
        open=close,
        high=high,
        low=low,
        close=close,
        volume=1000.0,
    )


def _tick(price: float, size: float, side: str) -> TradeTick:
    return TradeTick(
        timestamp=datetime.now(tz=timezone.utc),
        price=price,
        size=size,
        side=side,
    )


# ---------------------------------------------------------------------------
# EMA
# ---------------------------------------------------------------------------

class TestEMA:
    def test_length_matches_input(self):
        vals = list(range(1, 11))
        result = _ema(vals, period=5)
        assert len(result) == len(vals)

    def test_prefix_is_nan(self):
        vals = list(range(1, 11))
        result = _ema(vals, period=5)
        for v in result[:4]:
            assert math.isnan(v)

    def test_seed_equals_simple_mean(self):
        vals = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0]
        result = _ema(vals, period=5)
        # index 4 should be mean of [1,2,3,4,5] = 3.0
        assert pytest.approx(result[4], abs=1e-9) == 3.0

    def test_converges_toward_constant(self):
        # Feed a constant value after seed — EMA should stay constant
        vals = [10.0] * 30
        result = _ema(vals, period=5)
        for v in result[5:]:
            assert pytest.approx(v, abs=1e-6) == 10.0

    def test_rises_with_increasing_input(self):
        vals = list(range(1, 21))
        result = _ema(vals, period=5)
        # Finite values should be monotonically increasing
        finite = [v for v in result if not math.isnan(v)]
        assert all(finite[i] < finite[i + 1] for i in range(len(finite) - 1))


# ---------------------------------------------------------------------------
# ATR
# ---------------------------------------------------------------------------

class TestATR:
    def test_length_matches_input(self):
        bars = [_bar(100.0 + i) for i in range(20)]
        result = _atr(bars, period=14)
        assert len(result) == len(bars)

    def test_first_bar_uses_high_minus_low(self):
        bar = Bar(
            timestamp=datetime.now(tz=timezone.utc),
            open=100.0, high=105.0, low=95.0, close=100.0, volume=1.0
        )
        from shared.features import _true_range
        tr = _true_range([bar])
        assert pytest.approx(tr[0]) == 10.0  # 105 - 95

    def test_atr_is_positive(self):
        bars = [_bar(100.0) for _ in range(20)]
        result = _atr(bars, period=5)
        finite = [v for v in result if not math.isnan(v)]
        assert all(v > 0 for v in finite)


# ---------------------------------------------------------------------------
# Rolling Std
# ---------------------------------------------------------------------------

class TestRollingStd:
    def test_prefix_is_nan(self):
        vals = list(range(10))
        result = _rolling_std(vals, period=5)
        for v in result[:4]:
            assert math.isnan(v)

    def test_constant_series_has_zero_std(self):
        vals = [5.0] * 20
        result = _rolling_std(vals, period=5)
        finite = [v for v in result if not math.isnan(v)]
        for v in finite:
            assert pytest.approx(v, abs=1e-9) == 0.0

    def test_known_std(self):
        # [1, 2, 3, 4, 5] → sample std = sqrt(2.5) ≈ 1.5811
        vals = [1.0, 2.0, 3.0, 4.0, 5.0]
        result = _rolling_std(vals, period=5)
        assert pytest.approx(result[-1], rel=1e-4) == math.sqrt(2.5)


# ---------------------------------------------------------------------------
# Percentile Rank
# ---------------------------------------------------------------------------

class TestPercentileRank:
    def test_minimum(self):
        assert _percentile_rank(0.0, [1, 2, 3, 4]) == 0.0

    def test_maximum(self):
        assert _percentile_rank(10.0, [1, 2, 3, 4]) == 1.0

    def test_median(self):
        # 2 out of 4 values less than 3 → 0.5
        assert _percentile_rank(3.0, [1, 2, 4, 5]) == 0.5

    def test_empty(self):
        assert _percentile_rank(5.0, []) == 0.5


# ---------------------------------------------------------------------------
# Keltner Channels
# ---------------------------------------------------------------------------

class TestKeltner:
    def test_upper_above_lower(self):
        bars = [_bar(100.0) for _ in range(30)]
        upper, mid, lower = calc_keltner(bars)
        finite_idx = [i for i, v in enumerate(upper) if not math.isnan(v)]
        for i in finite_idx:
            assert upper[i] > lower[i]

    def test_mid_between_bands(self):
        bars = [_bar(100.0 + i * 0.1) for i in range(30)]
        upper, mid, lower = calc_keltner(bars)
        for i in range(len(bars)):
            if math.isnan(upper[i]):
                continue
            assert lower[i] <= mid[i] <= upper[i]

    def test_output_length(self):
        bars = [_bar(100.0) for _ in range(25)]
        upper, mid, lower = calc_keltner(bars)
        assert len(upper) == len(mid) == len(lower) == 25


# ---------------------------------------------------------------------------
# Z-Score
# ---------------------------------------------------------------------------

class TestZscore:
    def test_zero_when_at_mean(self):
        assert calc_zscore(100.0, 100.0, 5.0) == 0.0

    def test_positive_above_mean(self):
        assert calc_zscore(110.0, 100.0, 5.0) == pytest.approx(2.0)

    def test_negative_below_mean(self):
        assert calc_zscore(90.0, 100.0, 5.0) == pytest.approx(-2.0)

    def test_zero_std_returns_zero(self):
        assert calc_zscore(100.0, 100.0, 0.0) == 0.0


class TestZscoreBucket:
    def test_buckets(self):
        assert zscore_bucket(-3.0) == 0
        assert zscore_bucket(-1.5) == 1
        assert zscore_bucket(0.0) == 2
        assert zscore_bucket(1.5) == 3
        assert zscore_bucket(2.5) == 4


# ---------------------------------------------------------------------------
# Regime classification
# ---------------------------------------------------------------------------

class TestRegime:
    def test_low_when_below_threshold(self):
        history = list(range(1, 101))  # 1..100
        # value=10 → percentile_rank = 9/100 = 0.09 < 0.30 → LOW
        assert classify_regime(10.0, history) == Regime.LOW

    def test_high_when_above_threshold(self):
        history = list(range(1, 101))
        # value=95 → percentile_rank = 94/100 = 0.94 > 0.70 → HIGH
        assert classify_regime(95.0, history) == Regime.HIGH

    def test_medium_in_the_middle(self):
        history = list(range(1, 101))
        # value=50 → percentile_rank = 49/100 = 0.49 → MEDIUM
        assert classify_regime(50.0, history) == Regime.MEDIUM


# ---------------------------------------------------------------------------
# OFI
# ---------------------------------------------------------------------------

class TestOFI:
    def test_all_buys(self):
        ticks = [_tick(100.0, 10.0, "buy") for _ in range(5)]
        assert calc_ofi(ticks) == pytest.approx(1.0)

    def test_all_sells(self):
        ticks = [_tick(100.0, 10.0, "sell") for _ in range(5)]
        assert calc_ofi(ticks) == pytest.approx(-1.0)

    def test_balanced(self):
        ticks = [
            _tick(100.0, 5.0, "buy"),
            _tick(100.0, 5.0, "sell"),
        ]
        assert calc_ofi(ticks) == pytest.approx(0.0)

    def test_empty_returns_zero(self):
        assert calc_ofi([]) == 0.0


# ---------------------------------------------------------------------------
# VPIN
# ---------------------------------------------------------------------------

class TestVPIN:
    def test_all_one_side_is_high(self):
        ticks = [_tick(100.0, 1.0, "buy") for _ in range(100)]
        v = calc_vpin(ticks, volume_buckets=10)
        assert v > 0.8, f"Expected high VPIN, got {v}"

    def test_balanced_is_low(self):
        ticks = []
        for _ in range(50):
            ticks.append(_tick(100.0, 1.0, "buy"))
            ticks.append(_tick(100.0, 1.0, "sell"))
        v = calc_vpin(ticks, volume_buckets=10)
        assert v < 0.3, f"Expected low VPIN, got {v}"

    def test_empty_returns_neutral(self):
        assert calc_vpin([], volume_buckets=10) == 0.5

    def test_range(self):
        ticks = [_tick(100.0, 1.0, "buy") for _ in range(50)]
        ticks += [_tick(100.0, 1.0, "sell") for _ in range(30)]
        v = calc_vpin(ticks)
        assert 0.0 <= v <= 1.0


# ---------------------------------------------------------------------------
# Kelly Criterion
# ---------------------------------------------------------------------------

class TestKelly:
    def test_positive_edge(self):
        # win_rate=0.6, avg_win=1.0, avg_loss=1.0 → f* = (0.6*1 - 0.4)/1 = 0.2
        size = kelly_size(0.6, 1.0, 1.0, fraction=0.25, account_balance=10_000, max_size=500)
        assert size > 0

    def test_negative_edge_returns_zero(self):
        # win_rate=0.4, avg_win=0.5, avg_loss=1.0 → f* < 0
        size = kelly_size(0.4, 0.5, 1.0, fraction=0.25, account_balance=10_000, max_size=500)
        assert size == 0.0

    def test_capped_at_max(self):
        # High Kelly → should be capped
        size = kelly_size(0.8, 3.0, 1.0, fraction=1.0, account_balance=100_000, max_size=200)
        assert size <= 200.0

    def test_zero_avg_loss_returns_zero(self):
        assert kelly_size(0.6, 1.0, 0.0) == 0.0


# ---------------------------------------------------------------------------
# FeatureEngine integration
# ---------------------------------------------------------------------------

class TestFeatureEngine:
    def _make_bars(self, n: int, base: float = 100.0) -> list[Bar]:
        bars = []
        for i in range(n):
            c = base + i * 0.1
            bars.append(Bar(
                timestamp=datetime.now(tz=timezone.utc),
                open=c, high=c * 1.005, low=c * 0.995, close=c, volume=1000.0,
            ))
        return bars

    def test_returns_none_until_warmup(self):
        engine = FeatureEngine(asset="BTC")
        bars = self._make_bars(20)
        results = [engine.update(b) for b in bars]
        # First 20 bars need period=20 EMA and period=14 ATR → need at least 21 bars
        assert all(r is None for r in results[:20])

    def test_returns_features_after_warmup(self):
        engine = FeatureEngine(asset="BTC")
        bars = self._make_bars(30)
        results = [engine.update(b) for b in bars]
        features = [r for r in results if r is not None]
        assert len(features) > 0

    def test_features_fields_populated(self):
        engine = FeatureEngine(asset="ETH")
        bars = self._make_bars(30)
        feats = None
        for b in bars:
            f = engine.update(b)
            if f is not None:
                feats = f
        assert feats is not None
        assert feats.asset == "ETH"
        assert not math.isnan(feats.kc_upper)
        assert not math.isnan(feats.kc_mid)
        assert not math.isnan(feats.kc_lower)
        assert feats.kc_upper > feats.kc_lower
        assert feats.regime in list(Regime)

    def test_with_ticks(self):
        engine = FeatureEngine(asset="BTC")
        bars = self._make_bars(25)
        ticks = [_tick(100.0, 10.0, "buy") for _ in range(10)]
        feats = None
        for b in bars:
            f = engine.update(b, ticks=ticks)
            if f is not None:
                feats = f
        assert feats is not None
        # With all-buy ticks, OFI should be +1
        assert feats.ofi == pytest.approx(1.0)
