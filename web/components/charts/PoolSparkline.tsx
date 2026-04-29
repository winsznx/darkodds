"use client";

import {Line, LineChart, ResponsiveContainer, Tooltip} from "recharts";

/**
 * <PoolSparkline> — 48px-tall single-series sparkline showing pool total
 * over recent batches.
 *
 * Data source is STUB (see DRIFT_LOG → "PoolSparkline stub series"). Real
 * pool history requires indexing the Market.sol `BatchPublished` event
 * (timestamp + bets-in-batch + cumulative pool) into a subgraph or kv
 * store. We don't have that yet, so the parent feeds a synthesized
 * monotonic-up series anchored on the current pool total. F11 will swap
 * the input for real data; the component contract is the same.
 *
 * Render contract per PRD §7.5:
 *   - 48px tall.
 *   - Single line, var(--accent-signal) (defaults to ink at 0.7).
 *   - No grid, no axes, no labels.
 *   - Subtle dot on the most-recent point.
 *   - Hover tooltip shows {ts, total} for accountability — keeps the
 *     "we're not lying about being a sparkline" promise.
 */
interface PoolSparklineProps {
  /** Each point: unix-seconds + total volume (yes + no). */
  data: Array<{ts: number; yesPool: number; noPool: number}>;
}

export function PoolSparkline({data}: PoolSparklineProps): React.ReactElement | null {
  if (!data || data.length < 2) return null;
  const enriched = data.map((d) => ({...d, total: d.yesPool + d.noPool}));
  return (
    <div className="pool-sparkline" aria-label="Pool total over recent batches">
      <ResponsiveContainer width="100%" height={48}>
        <LineChart data={enriched} margin={{top: 4, right: 4, bottom: 4, left: 4}}>
          <Tooltip
            cursor={false}
            wrapperStyle={{outline: "none"}}
            contentStyle={{
              background: "var(--bg)",
              border: "1px solid var(--hairline-strong)",
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: "var(--fg)",
              padding: "6px 10px",
              borderRadius: 0,
            }}
            labelFormatter={() => ""}
            formatter={(value) => {
              const n = typeof value === "number" ? value : 0;
              return [new Intl.NumberFormat("en-US", {maximumFractionDigits: 0}).format(n), "POOL"];
            }}
          />
          <Line
            type="monotone"
            dataKey="total"
            stroke="var(--accent-signal, rgba(26, 20, 16, 0.7))"
            strokeWidth={1}
            dot={{r: 0}}
            activeDot={{r: 2.5, fill: "var(--accent-signal, rgba(26, 20, 16, 0.7))"}}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/**
 * Build a 5-point stub series for a market with known current pool totals.
 * Anchors on the supplied current values and synthesizes a monotonic-up
 * curve four batches earlier. Used by /markets/[id] until the F11 indexer
 * provides real history.
 *
 * Deterministic: marketId hash drives the curve shape so the same market
 * always renders the same sparkline shape across renders / sessions —
 * "stub but stable" beats "stub and flickering" for demo recording.
 */
export function buildStubPoolSeries(
  currentYes: bigint,
  currentNo: bigint,
  marketIdSeed: bigint,
  nowSec: number,
  batchIntervalSec: number,
): Array<{ts: number; yesPool: number; noPool: number}> {
  const yes = Number(currentYes);
  const no = Number(currentNo);
  if (yes + no <= 0) return [];

  // Derive 4 prior fractions from a deterministic seed so the curve is
  // stable for a given market. Walks 0.4 → 1.0 in a roughly-monotonic
  // way with small per-market variation.
  const seed = Number(marketIdSeed % BigInt(1_000_000));
  const fractions = [0.42, 0.58, 0.74, 0.88, 1.0].map((base, i) => {
    const wobble = ((seed * (i + 7)) % 60) / 1000; // 0..0.06 deterministic
    return Math.min(1, Math.max(0, base + (i < 4 ? wobble - 0.03 : 0)));
  });

  return fractions.map((frac, i) => ({
    ts: nowSec - (4 - i) * batchIntervalSec,
    yesPool: yes * frac,
    noPool: no * frac,
  }));
}
