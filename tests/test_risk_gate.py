"""
tests/test_risk_gate.py — Unit tests for RiskGate and SignalProcessor sizing.
"""

from __future__ import annotations

from datetime import datetime, timezone

import pytest

from shared.risk_gate import GateResult, RiskConfig, RiskGate
from shared.types import Direction, Features, ModelName, Regime, Signal


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _cfg(**overrides) -> RiskConfig:
    defaults = dict(
        initial_capital=10_000.0,
        max_daily_trades=20,
        max_concurrent=3,
        daily_loss_limit_pct=0.03,
        max_position_size=500.0,
        min_position_size=10.0,
        kelly_fraction=0.25,
        slippage_guard_bps=3.0,
        fee_rate=0.02,
        regime_low_mult=1.0,
        regime_medium_mult=1.0,
        regime_high_mult=0.5,
        min_signal_strength=0.5,
    )
    defaults.update(overrides)
    return RiskConfig(**defaults)


def _signal(
    regime: Regime = Regime.MEDIUM,
    model: ModelName = ModelName.KC_REVERSION,
    strength: float = 2.0,
    asset: str = "BTC",
    direction: Direction = Direction.UP,
) -> Signal:
    features = Features(
        timestamp=datetime.now(tz=timezone.utc),
        asset=asset,
        kc_upper=0.6, kc_mid=0.5, kc_lower=0.4,
        close=0.5, zscore=0.0,
        atr=0.01, atr_percentile=0.5,
        regime=regime,
        ofi=0.0, ofi_zscore=0.0, vpin=0.5,
        depth_ratio=1.0, bid_ask_imbalance=0.0,
        price_change_5m=0.0,
    )
    return Signal(
        timestamp=datetime.now(tz=timezone.utc),
        asset=asset,
        model=model,
        direction=direction,
        strength=strength,
        regime=regime,
        features=features,
    )


# ---------------------------------------------------------------------------
# Basic allow/block
# ---------------------------------------------------------------------------

class TestRiskGateBasic:
    def test_allows_valid_signal(self):
        gate = RiskGate(_cfg())
        result = gate.check(_signal(), proposed_size=100.0)
        assert result.allowed
        assert result.adjusted_size == pytest.approx(100.0)

    def test_blocks_when_daily_limit_reached(self):
        gate = RiskGate(_cfg(max_daily_trades=3))
        sig = _signal()
        # Simulate 3 open/close cycles
        for _ in range(3):
            gate.on_trade_opened()
            gate.on_trade_closed(0.0)
        result = gate.check(sig, proposed_size=100.0)
        assert not result.allowed
        assert "Daily trade limit" in result.reason

    def test_blocks_when_concurrent_limit_reached(self):
        gate = RiskGate(_cfg(max_concurrent=2))
        gate.on_trade_opened()
        gate.on_trade_opened()
        result = gate.check(_signal(), proposed_size=100.0)
        assert not result.allowed
        assert "concurrent" in result.reason.lower()

    def test_blocks_when_daily_loss_exceeded(self):
        gate = RiskGate(_cfg(initial_capital=10_000, daily_loss_limit_pct=0.03))
        # Loss limit = 300
        gate.on_trade_opened()
        gate.on_trade_closed(-350.0)   # blow past the -300 limit
        result = gate.check(_signal(), proposed_size=100.0)
        assert not result.allowed
        assert "loss limit" in result.reason.lower()

    def test_blocks_weak_signal(self):
        gate = RiskGate(_cfg(min_signal_strength=1.0))
        result = gate.check(_signal(strength=0.4), proposed_size=100.0)
        assert not result.allowed
        assert "strength" in result.reason.lower()

    def test_allows_signal_at_exact_strength_threshold(self):
        gate = RiskGate(_cfg(min_signal_strength=0.5))
        result = gate.check(_signal(strength=0.5), proposed_size=100.0)
        assert result.allowed

    def test_blocks_disabled_model(self):
        gate = RiskGate(_cfg(kc_reversion_enabled=False))
        result = gate.check(_signal(model=ModelName.KC_REVERSION), proposed_size=100.0)
        assert not result.allowed
        assert "disabled" in result.reason.lower()


# ---------------------------------------------------------------------------
# Size adjustments
# ---------------------------------------------------------------------------

class TestRiskGateSizing:
    def test_size_capped_at_max(self):
        gate = RiskGate(_cfg(max_position_size=200.0))
        result = gate.check(_signal(), proposed_size=500.0)
        assert result.allowed
        assert result.adjusted_size == pytest.approx(200.0)

    def test_size_floored_at_min(self):
        gate = RiskGate(_cfg(min_position_size=50.0))
        result = gate.check(_signal(), proposed_size=5.0)
        # 5 floored to 50, regime mult=1.0, so should pass
        assert result.allowed
        assert result.adjusted_size == pytest.approx(50.0)

    def test_high_vol_regime_halves_size(self):
        gate = RiskGate(_cfg(regime_high_mult=0.5, max_position_size=500.0, min_position_size=10.0))
        result = gate.check(_signal(regime=Regime.HIGH), proposed_size=200.0)
        assert result.allowed
        assert result.adjusted_size == pytest.approx(100.0)

    def test_low_vol_regime_unaffected(self):
        gate = RiskGate(_cfg(regime_low_mult=1.0))
        result = gate.check(_signal(regime=Regime.LOW), proposed_size=150.0)
        assert result.allowed
        assert result.adjusted_size == pytest.approx(150.0)

    def test_high_vol_blocks_if_after_regime_adj_below_min(self):
        gate = RiskGate(_cfg(regime_high_mult=0.5, min_position_size=60.0))
        # 100 * 0.5 = 50 < 60 → blocked
        result = gate.check(_signal(regime=Regime.HIGH), proposed_size=100.0)
        assert not result.allowed


# ---------------------------------------------------------------------------
# State tracking
# ---------------------------------------------------------------------------

class TestRiskGateState:
    def test_concurrent_increments_on_open(self):
        gate = RiskGate(_cfg())
        assert gate.concurrent_positions == 0
        gate.on_trade_opened()
        assert gate.concurrent_positions == 1
        gate.on_trade_opened()
        assert gate.concurrent_positions == 2

    def test_concurrent_decrements_on_close(self):
        gate = RiskGate(_cfg())
        gate.on_trade_opened()
        gate.on_trade_opened()
        gate.on_trade_closed(10.0)
        assert gate.concurrent_positions == 1

    def test_concurrent_never_below_zero(self):
        gate = RiskGate(_cfg())
        gate.on_trade_closed(0.0)  # close without open
        assert gate.concurrent_positions == 0

    def test_trade_count_increments(self):
        gate = RiskGate(_cfg())
        gate.on_trade_opened()
        assert gate.daily_trade_count == 1
        gate.on_trade_opened()
        assert gate.daily_trade_count == 2

    def test_trades_remaining_today(self):
        gate = RiskGate(_cfg(max_daily_trades=5))
        for _ in range(3):
            gate.on_trade_opened()
        assert gate.trades_remaining_today == 2

    def test_pnl_tracks_correctly(self):
        gate = RiskGate(_cfg())
        gate.on_trade_opened()
        gate.on_trade_closed(50.0)
        gate.on_trade_opened()
        gate.on_trade_closed(-20.0)
        assert gate.daily_pnl == pytest.approx(30.0)

    def test_drawdown_calculation(self):
        gate = RiskGate(_cfg())
        gate.on_trade_opened()
        gate.on_trade_closed(100.0)   # peak = 100
        gate.on_trade_opened()
        gate.on_trade_closed(-40.0)   # current = 60
        assert gate.drawdown == pytest.approx(40.0)

    def test_summary_keys(self):
        gate = RiskGate(_cfg())
        s = gate.summary()
        required = {"date", "trades_done", "trades_remaining", "concurrent",
                    "realized_pnl", "drawdown", "daily_loss_limit",
                    "at_trade_limit", "at_position_limit", "at_loss_limit"}
        assert required <= set(s.keys())


# ---------------------------------------------------------------------------
# Signal processor sizing modes
# ---------------------------------------------------------------------------

class TestSignalProcessorSizing:
    """Test the _compute_size logic via SignalProcessor directly."""

    def _make_processor(self, mode: str = "proportional", balance: float = 10_000.0, max_size: float = 500.0):
        from edgecopy.signal_processor import SignalProcessor
        from shared.types import CopyConfig
        from shared.risk_gate import RiskGate

        cfg = CopyConfig(
            sizing_mode=mode,
            fixed_size_usd=100.0,
            kelly_fraction=0.25,
            max_size_usd=max_size,
            regime_reduce_high_vol=True,
        )
        gate = RiskGate(_cfg())
        proc = SignalProcessor(
            copy_cfg=cfg,
            risk_gate=gate,
            follower_balance=balance,
            input_queue=asyncio.Queue(),
            output_queue=asyncio.Queue(),
        )
        return proc

    def _make_signal(self, master_size: float = 200.0, regime: Regime = Regime.MEDIUM):
        from edgecopy.watcher import CopySignal
        from shared.types import MasterTrader
        master = MasterTrader(
            wallet_address="0xABC",
            alias=None,
            source="leaderboard",
        )
        return CopySignal(
            detected_at=datetime.now(tz=timezone.utc),
            master=master,
            master_trade_id="t1",
            market_id="m1",
            asset="BTC",
            direction=Direction.UP,
            entry_price=0.5,
            master_size_usd=master_size,
            regime=regime,
        )

    def test_fixed_mode(self):
        import asyncio
        proc = self._make_processor(mode="fixed")
        sig = self._make_signal(master_size=999.0)
        size = proc._compute_size(sig)
        assert size == pytest.approx(100.0)

    def test_proportional_capped_at_max(self):
        import asyncio
        proc = self._make_processor(mode="proportional", max_size=300.0)
        sig = self._make_signal(master_size=999.0)
        size = proc._compute_size(sig)
        assert size <= 300.0

    def test_kelly_mode(self):
        import asyncio
        proc = self._make_processor(mode="kelly", balance=10_000.0, max_size=500.0)
        sig = self._make_signal()
        size = proc._compute_size(sig)
        # kelly_fraction=0.25 * 10_000 = 2500, capped at 500
        assert size == pytest.approx(500.0)

    def test_high_vol_halves_size(self):
        import asyncio
        proc = self._make_processor(mode="fixed", max_size=500.0)
        sig = self._make_signal(master_size=200.0, regime=Regime.HIGH)
        size = proc._compute_size(sig)
        assert size == pytest.approx(50.0)  # 100 fixed * 0.5

    def test_master_stats_should_pause_below_threshold(self):
        from edgecopy.signal_processor import MasterStats
        stats = MasterStats("0xABC", min_win_rate=0.45)
        for _ in range(10):
            stats.record(False)   # 10 losses → win_rate = 0%
        assert stats.should_pause

    def test_master_stats_no_pause_above_threshold(self):
        from edgecopy.signal_processor import MasterStats
        stats = MasterStats("0xABC", min_win_rate=0.45)
        for _ in range(6):
            stats.record(True)
        for _ in range(4):
            stats.record(False)
        # win_rate = 0.6 > 0.45 → should NOT pause
        assert not stats.should_pause

    def test_master_stats_insufficient_data(self):
        from edgecopy.signal_processor import MasterStats
        stats = MasterStats("0xABC", min_win_rate=0.45)
        stats.record(False)
        stats.record(False)   # only 2 — need 5
        assert stats.win_rate is None
        assert not stats.should_pause


# ---------------------------------------------------------------------------
# Import needed for asyncio.Queue in test
# ---------------------------------------------------------------------------
import asyncio
