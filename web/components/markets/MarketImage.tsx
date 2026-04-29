"use client";

import {useState} from "react";

/**
 * 32×32 thumbnail for Polymarket cards. Three-tier fallback:
 *
 *   1. `image`        — primary S3 URL from Gamma
 *   2. `icon`         — secondary S3 URL (often identical, sometimes a
 *                       square crop)
 *   3. category glyph — a single uppercase letter inside a hairline square
 *                       in the dossier mono. Stays on-brand even when
 *                       upstream imagery is missing.
 *
 * `<img>` directly (not next/image): Polymarket's S3 origin isn't in
 * `next.config.js`'s remote allowlist by default, and adding it would tie
 * us to a host we don't control. The 32×32 raster cost is negligible.
 */
export function MarketImage({
  image,
  icon,
  category,
  size = 32,
}: {
  image: string | null;
  icon: string | null;
  category: string;
  size?: number;
}): React.ReactElement {
  const [primaryFailed, setPrimaryFailed] = useState(false);
  const [secondaryFailed, setSecondaryFailed] = useState(false);

  const primary = image && !primaryFailed ? image : null;
  const secondary = !primary && icon && !secondaryFailed ? icon : null;
  const url = primary ?? secondary;

  if (url) {
    /* Polymarket S3 origin is intentionally NOT in next.config.js's
       remote-image allowlist. We don't want our build pinned to a host we
       don't control. 32×32 raster cost is negligible. */
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        className="mc-img"
        src={url}
        alt=""
        aria-hidden
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        style={{width: size, height: size}}
        onError={() => {
          if (primary) setPrimaryFailed(true);
          else setSecondaryFailed(true);
        }}
      />
    );
  }

  // Final fallback — single-letter monogram in a hairline square. Source
  // is the resolved domain category (Crypto/Politics/Geopolitics/etc.):
  //   - always alpha (DOMAIN_TAGS are alpha words; "Other" is the
  //     fallback when no DOMAIN_TAGS hit)
  //   - meaningful per-card (more variety than question monograms which
  //     skew "W" for "Will…" headlines, more legible than slug monograms
  //     which start with kebab-case)
  // We still strip non-A–Z just in case a future tag includes a numeric
  // or punctuation prefix; "?" is the last-resort character.
  const sanitized = (category ?? "").replace(/[^A-Za-z]/g, "");
  const letter = sanitized[0] ?? "?";
  return (
    <span
      className="mc-img mc-img--fallback"
      aria-hidden
      style={{width: size, height: size, fontSize: Math.round(size * 0.45)}}
    >
      {letter.toUpperCase()}
    </span>
  );
}
