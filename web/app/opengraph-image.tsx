import {ImageResponse} from "next/og";

import {getOgFonts} from "@/lib/og/fonts";

/// Default Open Graph card for the app (1200×630). Auto-wired by Next.js as
/// <meta property="og:image"> on the root route. Per-market routes override
/// via their own opengraph-image.tsx files.
///
/// Dossier typography wired via @/lib/og/fonts (Fraunces 600 for the
/// wordmark, Geist 400 for body, Geist Mono 400 for numerics, Special Elite
/// for the stamp).
export const alt = "DarkOdds — Public market. Private wager. Permissionless creation.";
export const size = {width: 1200, height: 630};
export const contentType = "image/png";

const BONE = "#F5F1E8";
const INK = "#1A1410";
const INK_70 = "rgba(26, 20, 16, 0.7)";
const INK_60 = "rgba(26, 20, 16, 0.6)";
const HAIRLINE = "rgba(26, 20, 16, 0.18)";
const REDACTED_RED = "#A82820";

export default function DefaultOG(): ImageResponse {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        background: BONE,
        padding: "64px",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        fontFamily: "Geist",
      }}
    >
      {/* Top row — top-right CLASSIFIED stamp */}
      <div style={{display: "flex", justifyContent: "flex-end"}}>
        <div
          style={{
            border: `2px solid ${REDACTED_RED}`,
            color: REDACTED_RED,
            padding: "10px 18px",
            fontSize: 20,
            fontFamily: "SpecialElite",
            letterSpacing: 2,
            textTransform: "uppercase",
            transform: "rotate(-1.5deg)",
            display: "flex",
          }}
        >
          CLASSIFIED // PRIVACY PERMISSIONLESS
        </div>
      </div>

      {/* Middle — wordmark + tagline */}
      <div style={{display: "flex", flexDirection: "column", alignItems: "center", gap: 28}}>
        <div
          style={{
            fontSize: 156,
            fontFamily: "Fraunces",
            fontWeight: 600,
            color: INK,
            letterSpacing: -3,
            lineHeight: 1,
            display: "flex",
          }}
        >
          DARKODDS
        </div>
        <div
          style={{
            fontSize: 32,
            color: INK_70,
            fontFamily: "Geist",
            textAlign: "center",
            maxWidth: 980,
            display: "flex",
            justifyContent: "center",
          }}
        >
          Public market. Private wager. Permissionless creation.
        </div>
      </div>

      {/* Bottom — hairline + URL strip */}
      <div style={{display: "flex", flexDirection: "column", gap: 16}}>
        <div style={{height: 1, background: HAIRLINE, width: "100%"}} />
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: 18,
            color: INK_60,
            fontFamily: "GeistMono",
            letterSpacing: 1.5,
            textTransform: "uppercase",
          }}
        >
          <div style={{display: "flex"}}>iExec Nox · Arbitrum Sepolia</div>
          <div style={{display: "flex"}}>github.com/winsznx/darkodds</div>
        </div>
      </div>
    </div>,
    {...size, fonts: getOgFonts()},
  );
}
