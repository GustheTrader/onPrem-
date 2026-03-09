-- supabase_migration.sql
-- Run this in the Supabase SQL Editor to initialize tables for the Polymarket Terminal

-- 1. Market Bars (OHLCV)
CREATE TABLE IF NOT EXISTS bars (
    id BIGSERIAL PRIMARY KEY,
    asset TEXT NOT NULL,
    ts TIMESTAMPTZ NOT NULL,
    o REAL NOT NULL,
    h REAL NOT NULL,
    l REAL NOT NULL,
    c REAL NOT NULL,
    v REAL NOT NULL,
    UNIQUE(asset, ts)
);
CREATE INDEX IF NOT EXISTS idx_bars_asset_ts ON bars(asset, ts DESC);

-- 2. Probability Snapshots
-- Records the 'UP%' (YES price) for a market over time
CREATE TABLE IF NOT EXISTS prob_snapshots (
    id BIGSERIAL PRIMARY KEY,
    asset TEXT NOT NULL,
    market_id TEXT NOT NULL,
    ts TIMESTAMPTZ NOT NULL,
    up_pct REAL NOT NULL,
    mid_price REAL,
    UNIQUE(asset, ts)
);
CREATE INDEX IF NOT EXISTS idx_probs_asset_ts ON prob_snapshots(asset, ts DESC);

-- 3. Trade Settlements
CREATE TABLE IF NOT EXISTS settlements (
    id BIGSERIAL PRIMARY KEY,
    asset TEXT NOT NULL,
    market_id TEXT NOT NULL,
    payout_ts TIMESTAMPTZ NOT NULL,
    final_outcome TEXT NOT NULL, -- "YES" or "NO"
    final_price REAL,
    profit_usd REAL
);

-- 4. Enable Row Level Security (RLS)
-- For a private terminal, we might want to restrict read/write
ALTER TABLE bars ENABLE CONTROL;
ALTER TABLE prob_snapshots ENABLE CONTROL;
ALTER TABLE settlements ENABLE CONTROL;

-- Allow public read (for the dashboard)
CREATE POLICY "Public Read Bars" ON bars FOR SELECT USING (true);
CREATE POLICY "Public Read Probs" ON prob_snapshots FOR SELECT USING (true);

-- Restrict write to service_role or authenticated users
CREATE POLICY "Auth Insert Bars" ON bars FOR INSERT WITH CHECK (true);
CREATE POLICY "Auth Insert Probs" ON prob_snapshots FOR INSERT WITH CHECK (true);

-- 5. Helper Views
CREATE OR REPLACE VIEW daily_volume AS
SELECT 
    asset,
    date_trunc('day', ts) as day,
    SUM(v) as total_volume
FROM bars
GROUP BY 1, 2
ORDER BY 2 DESC;
