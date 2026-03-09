"""
edgecopy.order_engine — Position management and execution.
Responsible for:
  1. Placing orders on Polymarket CLOB.
  2. Tracking active positions in memory.
  3. Handling partial exits (selling 50% at 2x profit).
  4. Finalizing trades and recording them to the Journal.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Optional

from edgecopy.alerter import Alerter
from shared.journal import Journal, build_trade
from shared.polymarket_client import PolymarketClient
from shared.risk_gate import RiskGate
from shared.types import Direction, Order, PartialExitConfig, Position, Trade

logger = logging.getLogger(__name__)


class OrderEngine:
    """
    Consumer of the order_queue.
    Orchestrates execution and manages position state.
    """

    def __init__(
        self,
        client: PolymarketClient,
        risk_gate: RiskGate,
        journal: Journal,
        input_queue: asyncio.Queue,
        pe_cfg: PartialExitConfig,
        alerter: Optional[Alerter] = None,
    ) -> None:
        self.client = client
        self.risk_gate = risk_gate
        self.journal = journal
        self.input_queue = input_queue
        self.pe_cfg = pe_cfg
        self.alerter = alerter
        
        self._active_positions: dict[str, Position] = {}
        self._running = False

    def stop(self) -> None:
        self._running = False

    async def run(self) -> None:
        """Main loop consuming order requests."""
        self._running = True
        logger.info("Order Engine active — consuming order queue")
        
        # Start background task to monitor partial exits
        mon_task = asyncio.create_task(self._monitor_positions())
        
        try:
            while self._running:
                try:
                    # Wait for next approved signal
                    signal = await asyncio.wait_for(self.input_queue.get(), timeout=1.0)
                    await self._execute_signal(signal)
                    self.input_queue.task_done()
                except asyncio.TimeoutError:
                    continue
                except Exception as exc:
                    logger.error("Error in order engine loop: %s", exc)
        finally:
            mon_task.cancel()

    async def _execute_signal(self, signal: Any) -> None:
        """
        Final execution step:
        1. Place the order.
        2. If filled, update RiskGate and internal state.
        """
        # Determine price (use best ask for UP, best bid for DOWN if available)
        # For simplicity, we assume we hit the mid or calculated target price from processor
        target_price = signal.entry_price
        
        order = await self.client.place_order(
            market_id=signal.market_id,
            direction=signal.direction,
            size_usd=signal.adjusted_size,
            limit_price=target_price
        )
        
        if not order or not order.fill_price:
            logger.warning("Order failed or not filled for %s", signal.market_id)
            return

        # Success!
        self.risk_gate.on_trade_opened()
        
        pos_id = f"pos_{order.order_id[:8]}"
        pos = Position(
            position_id=pos_id,
            asset=signal.asset,
            direction=signal.direction,
            entry_price=order.fill_price,
            size=order.size,
            current_size=order.size,
            entry_time=datetime.now(tz=timezone.utc),
            partial_exit=False
        )
        
        self._active_positions[pos_id] = pos
        
        if self.alerter:
            await self.alerter.trade_placed(
                asset=pos.asset,
                side=pos.direction.value,
                size=pos.size,
                price=pos.entry_price,
                model="copy" if signal.is_copy else signal.model.value
            )

    async def _monitor_positions(self) -> None:
        """
        Background worker that checks prices for active positions.
        Handles partial exits and stops.
        """
        while True:
            await asyncio.sleep(5) # Poll status every 5s
            
            for pid, pos in list(self._active_positions.items()):
                # In real scenario, we'd fetch current book mid/price
                # for the specific token from the client.
                book = await self.client.get_order_book(pos.asset) # pseudo call
                if not book or not book.mid:
                    continue
                
                await self._check_exit_logic(pos, book.mid)

    async def _check_exit_logic(self, pos: Position, current_price: float) -> None:
        """
        Rules for exiting:
        1. Partial Exit: Sell 50% if price hits 2x (for UP) or 0.5x (for DOWN).
        2. Final Exit: Time-based or Take Profit (not fully implemented here).
        3. Settlement: Market closed.
        """
        # 1. Partial Exit
        if self.pe_cfg.enabled and not pos.partial_exit:
            did_hit = False
            if pos.direction == Direction.UP and current_price >= (pos.entry_price * self.pe_cfg.first_exit_multiple):
                did_hit = True
            elif pos.direction == Direction.DOWN and current_price <= (pos.entry_price / self.pe_cfg.first_exit_multiple):
                did_hit = True

            if did_hit:
                await self._handle_partial_exit(pos, current_price)

    async def _handle_partial_exit(self, pos: Position, current_price: float) -> None:
        """Sell half the position to lock in gains."""
        exit_size = pos.size * self.pe_cfg.first_exit_fraction
        logger.info("Partial exit triggered for %s at %.4f", pos.position_id, current_price)
        
        # Place offsetting order...
        # Update internal state
        updated_pos = Position(
            position_id=pos.position_id,
            asset=pos.asset,
            direction=pos.direction,
            entry_price=pos.entry_price,
            size=pos.size,
            current_size=pos.size - exit_size,
            entry_time=pos.entry_time,
            partial_exit=True
        )
        self._active_positions[pos.position_id] = updated_pos
        
        # Record this slice as a 'trade' in the journal
        partial_trade = build_trade(
            market_id="N/A", # would provide real ID
            asset=pos.asset,
            direction=pos.direction,
            model=None,
            regime=Regime.MEDIUM, # would provide real regime
            entry_time=pos.entry_time,
            exit_time=datetime.now(tz=timezone.utc),
            entry_price=pos.entry_price,
            exit_price=current_price,
            size_usd=exit_size
        )
        await self.journal.record(partial_trade)
        
        if self.alerter:
            await self.alerter.notify(f"Partial exit done for {pos.asset}: +${partial_trade.net_pnl:.2f}")

    async def close_position(self, pos_id: str, exit_price: float) -> None:
        """Manually close out remaining position."""
        if pos_id not in self._active_positions:
            return
            
        pos = self._active_positions.pop(pos_id)
        
        # Build final trade record
        final_trade = build_trade(
            market_id="N/A",
            asset=pos.asset,
            direction=pos.direction,
            model=None,
            regime=Regime.MEDIUM,
            entry_time=pos.entry_time,
            exit_time=datetime.now(tz=timezone.utc),
            entry_price=pos.entry_price,
            exit_price=exit_price,
            size_usd=pos.current_size
        )
        
        await self.journal.record(final_trade)
        self.risk_gate.on_trade_closed(final_trade.net_pnl)
        
        if self.alerter:
            duration = int((final_trade.exit_time - final_trade.entry_time).total_seconds() / 60)
            await self.alerter.trade_closed(pos.asset, final_trade.net_pnl, exit_price, duration)
