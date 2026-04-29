"use client";

import {useEffect, useState} from "react";

import {Check, Copy, X as XIcon} from "lucide-react";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://darkodds.site";
const AUTO_DISMISS_MS = 30_000;

interface PostDeployBannerProps {
  marketId: string;
  question: string;
}

/**
 * Renders at the top of /markets/[id] when ?just-created=1 is in the URL.
 * Auto-dismisses on first scroll, first click anywhere, or after 30s —
 * whichever arrives first. A user who deploys a market sees one beat of
 * "you did this, here's the link" and the page reverts to its normal
 * shape on first interaction so the banner doesn't follow them around.
 *
 * The persistent "CREATED BY YOU" badge on the case-file row is a
 * separate concern (CreatedByYouBadge.tsx) — that one stays for the
 * lifetime of the localStorage / server-ledger entry.
 */
export function PostDeployBanner({marketId, question}: PostDeployBannerProps): React.ReactElement | null {
  const [visible, setVisible] = useState(true);
  const [copied, setCopied] = useState(false);

  // Use window.location.origin client-side as the runtime-correct URL even
  // if NEXT_PUBLIC_APP_URL is misconfigured for the current deploy. Falls
  // back to the env var when the component first paints during hydration.
  // Microtask-deferred to satisfy react-hooks/set-state-in-effect.
  const [origin, setOrigin] = useState(APP_URL);
  useEffect(() => {
    if (typeof window === "undefined" || !window.location.origin) return;
    const next = window.location.origin;
    const t = setTimeout(() => setOrigin(next), 0);
    return () => clearTimeout(t);
  }, []);

  // Auto-dismiss orchestration: scroll OR click anywhere OR 30s timeout.
  useEffect(() => {
    if (!visible) return;
    const dismiss = (): void => setVisible(false);
    const scrollListener = (): void => dismiss();
    const clickListener = (e: MouseEvent): void => {
      // Ignore clicks INSIDE the banner — those are the operator's intentional
      // CTAs (COPY LINK / SHARE ON X / dismiss button, all handled separately).
      const target = e.target;
      if (target instanceof Node) {
        const banner = document.querySelector(".post-deploy-banner");
        if (banner?.contains(target)) return;
      }
      dismiss();
    };
    const timer = window.setTimeout(dismiss, AUTO_DISMISS_MS);
    window.addEventListener("scroll", scrollListener, {once: true, passive: true});
    window.addEventListener("click", clickListener);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("scroll", scrollListener);
      window.removeEventListener("click", clickListener);
    };
  }, [visible]);

  if (!visible) return null;

  const url = `${origin}/markets/${marketId}`;
  const tweetText = [
    "Just deployed a market on DarkOdds — privacy permissionless prediction markets on Arbitrum Sepolia.",
    "",
    `Market #${marketId}: ${question.length > 200 ? `${question.slice(0, 197)}...` : question}`,
    "",
    url,
    "",
    "Built on @iEx_ec Nox + @Chain_GPT",
  ].join("\n");
  const tweetUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(tweetText)}`;

  const handleCopy = (): void => {
    if (typeof navigator === "undefined" || !navigator.clipboard) return;
    void navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_500);
    });
  };

  return (
    <div className="post-deploy-banner" role="status" aria-live="polite">
      <div className="post-deploy-banner-body">
        <span className="stamp stamp--red" style={{transform: "rotate(-1deg)"}}>
          MARKET #{marketId} DEPLOYED BY YOU
        </span>
        <p className="post-deploy-banner-sub">Save this link · Share with bettors</p>
      </div>
      <div className="post-deploy-banner-actions">
        <button
          type="button"
          className="post-deploy-banner-cta"
          onClick={handleCopy}
          aria-label="Copy market link"
        >
          {copied ? <Check size={11} /> : <Copy size={11} />} {copied ? "COPIED" : "COPY LINK"}
        </button>
        <a className="post-deploy-banner-cta" href={tweetUrl} target="_blank" rel="noopener noreferrer">
          SHARE ON X
        </a>
        <button
          type="button"
          className="post-deploy-banner-dismiss"
          onClick={() => setVisible(false)}
          aria-label="Dismiss banner"
        >
          <XIcon size={12} />
        </button>
      </div>
    </div>
  );
}
