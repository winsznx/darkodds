"use client";

import {useEffect, useState} from "react";

/**
 * <BatchTimer> — countdown to the next on-chain batch publish.
 *
 * Data source is REAL: every Market.sol stores `lastBatchTs` (uint256, seconds
 * since epoch) and a constant `BATCH_INTERVAL` (60s in the deployed v5
 * contracts). The page reads both via the existing single-market multicall
 * and passes `nextBatchTs = lastBatchTs + BATCH_INTERVAL` here.
 *
 * Render contract:
 *   - Hairline-bordered band, 32px tall.
 *   - Left: "NEXT BATCH" mono cap label.
 *   - Right: "mm:ss" Geist Mono numerics.
 *   - When countdown hits ≤0: switches to "PUBLISHING…" with a subtle pulse.
 *   - lastBatchTs === 0 → "AWAITING FIRST BATCH" (market is Open but no
 *     batch has been published yet).
 *
 * Caveat: if the parent unmounts the component (e.g. market resolves), the
 * `setInterval` cleanup runs and the timer stops. We don't poll the chain;
 * after PUBLISHING… is shown, the parent's revalidate will refetch
 * `lastBatchTs` and re-mount this with a new countdown.
 */
interface BatchTimerProps {
  /** Unix seconds. Pass `null` if the market hasn't published a first batch
   *  yet (lastBatchTs === 0); the timer renders an awaiting state. */
  nextBatchTs: number | null;
}

function format(secsRemaining: number): string {
  const mm = Math.floor(secsRemaining / 60)
    .toString()
    .padStart(2, "0");
  const ss = (secsRemaining % 60).toString().padStart(2, "0");
  return `${mm}:${ss}`;
}

export function BatchTimer({nextBatchTs}: BatchTimerProps): React.ReactElement {
  // First render uses Date.now() once (lazy state init) so the initial
  // markup is consistent during hydration. After that, the interval below
  // updates every second.
  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    const id = window.setInterval(() => {
      setNowSec(Math.floor(Date.now() / 1000));
    }, 1_000);
    return () => window.clearInterval(id);
  }, []);

  if (nextBatchTs === null) {
    return (
      <div className="batch-timer" data-state="awaiting" aria-live="polite">
        <span className="batch-timer-lbl">NEXT BATCH</span>
        <span className="batch-timer-val">AWAITING FIRST BATCH</span>
      </div>
    );
  }

  const remaining = Math.max(0, nextBatchTs - nowSec);
  const publishing = remaining <= 0;

  return (
    <div className="batch-timer" data-state={publishing ? "publishing" : "counting"} aria-live="polite">
      <span className="batch-timer-lbl">NEXT BATCH</span>
      <span className="batch-timer-val">{publishing ? "PUBLISHING…" : format(remaining)}</span>
    </div>
  );
}
