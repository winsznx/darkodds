import {ImageResponse} from "next/og";

/// 512×512 PNG of the DarkOdds crest, served at `/icon-512`. Used as the
/// Privy auth modal logo. Privy's `appearance.logo` accepts any URL that
/// returns image bytes; this route stays stable across deploys (no hashed
/// filename) so the Privy config can reference it as a literal path.
///
/// Node runtime (default). No font dependency — the crest is hand-drawn
/// SVG inside the JSX so it renders without going through Satori's text
/// path.

export function GET(): ImageResponse {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        background: "#F5F1E8",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <svg width="512" height="512" viewBox="0 0 32 32">
        <rect width="32" height="32" fill="#F5F1E8" />
        <rect x="2.5" y="2.5" width="27" height="27" fill="none" stroke="#1A1410" strokeWidth="2" />
        <path d="M9 9 L9 23 L17 23 C20.5 23 22 20.3 22 16 C22 11.7 20.5 9 17 9 Z" fill="#1A1410" />
        <rect x="20" y="14" width="4" height="4" fill="#A82820" transform="rotate(45 22 16)" />
      </svg>
    </div>,
    {width: 512, height: 512},
  );
}
