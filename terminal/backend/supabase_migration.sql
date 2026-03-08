-- Run this once in:
-- https://supabase.com/dashboard/project/clfxhobptzssyemihabn/sql/new

-- OHLCV bars (real Binance data, 1-min interval)
CREATE TABLE IF NOT EXISTS bars (
    id          BIGSERIAL PRIMARY KEY,
    asset       TEXT      NOT NULL,          -- 'BTC' | 'ETH' | 'SOL' | 'XRP'
    ts          BIGINT    NOT NULL,          -- kline open time, unix ms
    open        NUMERIC(18, 8) NOT NULL,
    high        NUMERIC(18, 8) NOT NULL,
    low         NUMERIC(18, 8) NOT NULL,
    close       NUMERIC(18, 8) NOT NULL,
    volume      NUMERIC(24, 8) NOT NULL,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT bars_asset_ts_unique UNIQUE (asset, ts)
);

CREATE INDEX IF NOT EXISTS bars_asset_ts_idx ON bars (asset, ts DESC);

-- Polymarket probability snapshots
CREATE TABLE IF NOT EXISTS prob_snapshots (
    id          BIGSERIAL PRIMARY KEY,
    market_key  TEXT      NOT NULL,          -- 'BTC_15min' etc.
    ts          BIGINT    NOT NULL,          -- unix ms
    up_pct      NUMERIC(6, 2) NOT NULL,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT prob_asset_ts_unique UNIQUE (market_key, ts)
);

CREATE INDEX IF NOT EXISTS prob_market_ts_idx ON prob_snapshots (market_key, ts DESC);

-- Market Rotation / Settlement Log
CREATE TABLE IF NOT EXISTS settlements (
    id              BIGSERIAL PRIMARY KEY,
    settled_at      BIGINT    NOT NULL,          -- unix ms
    market_key      TEXT      NOT NULL,
    asset           TEXT      NOT NULL,
    timeframe       TEXT      NOT NULL,
    question        TEXT      NOT NULL,
    final_up_pct    NUMERIC(6, 2) NOT NULL,
    final_down_pct  NUMERIC(6, 2) NOT NULL,
    outcome         TEXT      NOT NULL,          -- 'UP' | 'DOWN'
    volume          NUMERIC(24, 2) NOT NULL,
    expiry_ts       BIGINT    NOT NULL,
    condition_id    TEXT      DEFAULT '',
    live            BOOLEAN   DEFAULT FALSE,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS settlements_asset_ts_idx ON settlements (asset, settled_at DESC);

-- Enable Row Level Security
ALTER TABLE bars           ENABLE ROW LEVEL SECURITY;
ALTER TABLE prob_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE settlements    ENABLE ROW LEVEL SECURITY;

-- Bars Policies
CREATE POLICY "anon read bars" ON bars FOR SELECT USING (true);
CREATE POLICY "service insert bars" ON bars FOR INSERT WITH CHECK (true);
CREATE POLICY "service update bars" ON bars FOR UPDATE USING (true);

-- Prob Snapshots Policies
CREATE POLICY "anon read prob" ON prob_snapshots FOR SELECT USING (true);
CREATE POLICY "service insert prob" ON prob_snapshots FOR INSERT WITH CHECK (true);
CREATE POLICY "service update prob" ON prob_snapshots FOR UPDATE USING (true);

-- Settlements Policies
CREATE POLICY "anon read settlements" ON settlements FOR SELECT USING (true);
CREATE POLICY "service insert settlements" ON settlements FOR INSERT WITH CHECK (true);
