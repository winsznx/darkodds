"use client";

/**
 * <ClaimQueue> — small inline status panel for "your claim is being
 * settled, you're position N in queue with ~Ks ETA".
 *
 * Data source is STUB. The deployed v5 Market.sol settles claims in the
 * order they're submitted (they're individual `claimWinnings(...)` calls
 * — there's no on-chain queue contract). To surface a "real" queue we'd
 * need an off-chain aggregator watching the mempool + recent blocks for
 * pending claims, which is subgraph/indexer territory (deferred to v1.1).
 *
 * For the polish-all phase we render plausible stub values supplied by
 * the parent. The visual mass is what mattered for the demo; the data
 * layer fills in once F11 indexer ships.
 *
 * Render contract per PRD §7.3:
 *   - Mono caps, ink color, hairline border.
 *   - "CLAIM QUEUE · POSITION 3 · ETA ~45S".
 *   - Renders only when `position` > 0 (parent gates this).
 */
interface ClaimQueueProps {
  /** 1-indexed position in the claim queue. */
  position: number;
  /** Estimated wait seconds. Rounded to nearest 5s for display. */
  estimatedWaitSec: number;
}

export function ClaimQueue({position, estimatedWaitSec}: ClaimQueueProps): React.ReactElement | null {
  if (position <= 0) return null;
  const eta = Math.max(5, Math.round(estimatedWaitSec / 5) * 5);
  return (
    <div className="claim-queue" role="status" aria-live="polite">
      <span className="claim-queue-seg">CLAIM QUEUE</span>
      <span className="claim-queue-sep">·</span>
      <span className="claim-queue-seg">POSITION {position}</span>
      <span className="claim-queue-sep">·</span>
      <span className="claim-queue-seg">ETA ~{eta}S</span>
    </div>
  );
}
