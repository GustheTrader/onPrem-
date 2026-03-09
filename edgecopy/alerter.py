"""
edgecopy.alerter — Notification handling (Console, Slack).
Provides different alert levels and structured logging for trading events.
"""

from __future__ import annotations

import json
import logging
import os
from datetime import datetime
from typing import Any, Optional

import httpx

logger = logging.getLogger(__name__)


class Alerter:
    """
    Unified alerting system for EdgeCopy.
    Sends notification to Console and optionally Slack/Discord.
    """

    def __init__(
        self,
        name: str = "EdgeCopy",
        slack_webhook: Optional[str] = None,
        log_level: str = "INFO",
    ) -> None:
        self.name = name
        self.slack_webhook = slack_webhook or os.getenv("EDGECOPY_ALERTER_SLACK_WEBHOOK")
        
        logging.basicConfig(
            level=getattr(logging, log_level.upper()),
            format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
            datefmt="%Y-%m-%d %H:%M:%S"
        )
        self.log = logging.getLogger(name)

    async def notify(self, message: str, level: str = "info", data: Optional[dict] = None) -> None:
        """Send notification to all enabled channels."""
        # 1. Console / Local logging
        log_func = getattr(self.log, level.lower(), self.log.info)
        log_func(message)
        if data:
            self.log.debug("Alert Data: %s", data)

        # 2. Slack (async)
        if self.slack_webhook:
            await self._send_slack(message, level, data)

    async def _send_slack(self, message: str, level: str, data: Optional[dict]) -> None:
        """Post formatted message to Slack."""
        emoji = {
            "info": "ℹ️",
            "success": "🟢",
            "warning": "⚠️",
            "error": "🚨",
            "trade": "💰",
            "closed": "🎯"
        }.get(level.lower(), "🔹")

        color = {
            "info": "#439FE0",
            "success": "#36A64F",
            "warning": "#FCB400",
            "error": "#FF0000",
            "trade": "#7B1FA2",
            "closed": "#00BCD4"
        }.get(level.lower(), "#E0E0E0")

        payload = {
            "attachments": [{
                "fallback": f"[{self.name}] {message}",
                "color": color,
                "pretext": f"{emoji} *{self.name} Notification*",
                "text": message,
                "footer": "EdgeCopy Engine v0.1.0",
                "ts": int(datetime.now().timestamp()),
                "fields": []
            }]
        }

        if data:
            for k, v in data.items():
                payload["attachments"][0]["fields"].append({
                    "title": k.replace("_", " ").title(),
                    "value": str(v),
                    "short": True
                })

        try:
            async with httpx.AsyncClient() as client:
                await client.post(self.slack_webhook, json=payload, timeout=5)
        except Exception as exc:
            self.log.error("Slack notification failed: %s", exc)

    # ------------------------------------------------------------------
    # Convenience Methods
    # ------------------------------------------------------------------

    async def info(self, msg: str, data: Optional[dict] = None) -> None:
        await self.notify(msg, "info", data)

    async def success(self, msg: str, data: Optional[dict] = None) -> None:
        await self.notify(msg, "success", data)

    async def warning(self, msg: str, data: Optional[dict] = None) -> None:
        await self.notify(msg, "warning", data)

    async def error(self, msg: str, data: Optional[dict] = None) -> None:
        await self.notify(msg, "error", data)

    async def trade_placed(self, asset: str, side: str, size: float, price: float, model: str = "copy") -> None:
        msg = f"*Trade Placed*: {side} {asset} at ${price:.4f}"
        data = {
            "asset": asset,
            "side": side,
            "size_usd": f"${size:.2f}",
            "price": f"{price:.4f}",
            "model": model,
            "time": datetime.now().strftime("%H:%M:%S UTC")
        }
        await self.notify(msg, "trade", data)

    async def trade_closed(self, asset: str, pnl: float, exit_price: float, duration_mins: int) -> None:
        outcome = "Profit" if pnl > 0 else "Loss"
        msg = f"*Trade Closed*: {asset} | {outcome}: ${pnl:.2f}"
        data = {
            "asset": asset,
            "pnl": f"${pnl:.2f}",
            "exit_price": f"{exit_price:.4f}",
            "duration": f"{duration_mins}m"
        }
        await self.notify(msg, "closed", data)

    async def risk_alert(self, reason: str, details: str = "") -> None:
        msg = f"*RISK ALERT*: {reason}"
        data = {"details": details} if details else None
        await self.notify(msg, "error", data)
