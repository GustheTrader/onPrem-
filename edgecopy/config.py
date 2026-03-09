"""
edgecopy.config — Configuration loader for the EdgeCopy bot.
Parses config.toml and applies environment variable overrides.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

import tomli

from shared.risk_gate import RiskConfig
from shared.types import CopyConfig, PartialExitConfig


@dataclass
class LogConfig:
    level: str = "INFO"
    log_file: str = "logs/edgecopy.log"
    rotate_mb: int = 10
    backup_count: int = 5


@dataclass
class TerminalConfig:
    theme: str = "dark"
    default_asset: str = "BTC"
    refresh_ms: int = 1000


@dataclass
class AppConfig:
    """Unified configuration for the edgecopy bot and terminal backend."""
    
    # Generic
    dry_run: bool = True
    chain_id: int = 137
    assets: list[str] = field(default_factory=lambda: ["BTC", "ETH"])
    
    # Nested configs
    risk: RiskConfig = field(default_factory=RiskConfig)
    copy: CopyConfig = field(default_factory=CopyConfig)
    partial_exit: PartialExitConfig = field(default_factory=PartialExitConfig)
    logging: LogConfig = field(default_factory=LogConfig)
    terminal: TerminalConfig = field(default_factory=TerminalConfig)
    
    # Database / Storage
    db_path: Path = Path("data/journal.db")
    
    # Raw segments for late binding
    _raw: dict[str, Any] = field(default_factory=dict, repr=False)


def load_config(path: Optional[str | Path] = None) -> AppConfig:
    """Load config from TOML and apply ENV overrides."""
    if path is None:
        path = Path("config.toml")
    else:
        path = Path(path)

    if not path.exists():
        # Fallback to default if not found
        return AppConfig()

    with open(path, "rb") as f:
        data = tomli.load(f)

    # ------------------------------------------------------------------
    # 1. Parse Segments
    # ------------------------------------------------------------------
    
    # Risk
    risk_data = data.get("risk", {})
    # Flatten regime_sizing if present
    if "regime_sizing" in risk_data:
        sizing = risk_data.pop("regime_sizing")
        risk_data["regime_low_mult"] = sizing.get("low_multiplier", 1.0)
        risk_data["regime_medium_mult"] = sizing.get("medium_multiplier", 1.0)
        risk_data["regime_high_mult"] = sizing.get("high_multiplier", 0.5)
        
    risk_cfg = RiskConfig.from_dict(risk_data)
    
    # Copy
    copy_data = data.get("copy_trading", {})
    copy_cfg = CopyConfig(
        sizing_mode=copy_data.get("sizing_mode", "proportional"),
        fixed_size_usd=copy_data.get("fixed_size_usd", 100.0),
        kelly_fraction=copy_data.get("kelly_fraction", 0.25),
        max_size_usd=copy_data.get("max_copy_size", 500.0),
        regime_reduce_high_vol=copy_data.get("regime_reduce", True)
    )
    
    # Partial Exit
    pe_data = data.get("partial_exit", {})
    pe_cfg = PartialExitConfig(**pe_data)
    
    # Logging
    log_cfg = LogConfig(**data.get("logging", {}))
    
    # Terminal
    term_cfg = TerminalConfig(**data.get("terminal", {}))

    # ------------------------------------------------------------------
    # 2. Build AppConfig
    # ------------------------------------------------------------------
    app_cfg = AppConfig(
        dry_run=data.get("polymarket", {}).get("dry_run", True),
        chain_id=data.get("polymarket", {}).get("chain_id", 137),
        assets=data.get("assets", {}).get("enabled", ["BTC", "ETH"]),
        risk=risk_cfg,
        copy=copy_cfg,
        partial_exit=pe_cfg,
        logging=log_cfg,
        terminal=term_cfg,
        db_path=Path(data.get("storage", {}).get("db_path", "data/journal.db")),
        _raw=data
    )

    # ------------------------------------------------------------------
    # 3. Apply Environment Variable Overrides
    # format: EDGECOPY_<SECTION>_<KEY> (e.g. EDGECOPY_RISK_MAX_DAILY_TRADES)
    # ------------------------------------------------------------------
    # (Simple override implementation for critical keys)
    if "EDGECOPY_DRY_RUN" in os.environ:
        app_cfg.dry_run = os.environ["EDGECOPY_DRY_RUN"].lower() == "true"

    return app_cfg


def get_polymarket_creds() -> dict[str, str]:
    """Retrieve credentials solely from environment for security."""
    return {
        "api_key":        os.getenv("POLYMARKET_API_KEY", ""),
        "api_secret":     os.getenv("POLYMARKET_API_SECRET", ""),
        "api_passphrase": os.getenv("POLYMARKET_API_PASSPHRASE", ""),
        "private_key":    os.getenv("POLYMARKET_PRIVATE_KEY", ""),
    }
