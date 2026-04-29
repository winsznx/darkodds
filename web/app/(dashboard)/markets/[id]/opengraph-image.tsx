import {ImageResponse} from "next/og";

import {getDarkOddsMarketDetail} from "@/lib/darkodds/single-market";
import {DarkOddsState} from "@/lib/darkodds/types";
import {getOgFonts} from "@/lib/og/fonts";

/// Per-market Open Graph card. Reads the same source the page does
/// (`getDarkOddsMarketDetail`) so OG and page agree about state. Falls back
/// to a generic dossier card if the market id doesn't resolve.
///
/// Polymarket-image enrichment is deferred — the on-chain Market only stores
/// a question string, not a back-link to the source Polymarket id. See
/// DRIFT_LOG → "Per-market OG / Polymarket image fallback".
export const alt = "DarkOdds case file";
export const size = {width: 1200, height: 630};
export const contentType = "image/png";

const BONE = "#F5F1E8";
const INK = "#1A1410";
const INK_70 = "rgba(26, 20, 16, 0.7)";
const INK_50 = "rgba(26, 20, 16, 0.5)";
const HAIRLINE = "rgba(26, 20, 16, 0.2)";
const HAIRLINE_STRONG = "rgba(26, 20, 16, 0.4)";
const REDACTED_RED = "#A82820";
const ACCENT_AMBER = "#B8A356";
const ACCENT_YES = "#1F5C3D";
const ACCENT_NO = "#7A1F1F";

function formatExpiry(expiryTs: bigint): string {
  if (expiryTs === BigInt(0)) return "TBD";
  const date = new Date(Number(expiryTs) * 1000);
  return date.toLocaleDateString("en-US", {year: "numeric", month: "short", day: "numeric"});
}

export default async function MarketOG({params}: {params: Promise<{id: string}>}): Promise<ImageResponse> {
  const {id: idStr} = await params;

  let id: bigint;
  try {
    id = BigInt(idStr);
  } catch {
    return notFoundCard();
  }
  if (id <= BigInt(0)) return notFoundCard();

  const market = await getDarkOddsMarketDetail(id).catch(() => null);
  if (!market) return notFoundCard();

  const yesPct = market.outcomes[0].probability ?? null;
  const noPct = market.outcomes[1].probability ?? null;
  const yesFlex = yesPct !== null ? Math.max(yesPct, 0.02) : 0.5;
  const noFlex = noPct !== null ? Math.max(noPct, 0.02) : 0.5;
  const stateLabel: string =
    market.state === DarkOddsState.Open
      ? "OPEN"
      : market.state === DarkOddsState.Resolved || market.state === DarkOddsState.ClaimWindow
        ? "CLOSED"
        : market.state === DarkOddsState.Invalid
          ? "INVALID"
          : "PENDING";

  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        background: BONE,
        padding: "56px 64px",
        display: "flex",
        flexDirection: "column",
        gap: 28,
        fontFamily: "Geist",
      }}
    >
      {/* Header strip — case file + state */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          paddingBottom: 14,
          borderBottom: `1px solid ${HAIRLINE_STRONG}`,
        }}
      >
        <div
          style={{
            fontFamily: "GeistMono",
            fontSize: 18,
            letterSpacing: 3,
            color: INK,
            textTransform: "uppercase",
            display: "flex",
            gap: 14,
          }}
        >
          <div style={{display: "flex"}}>CASE FILE {idStr.padStart(2, "0")}</div>
          <div style={{display: "flex", color: INK_50}}>·</div>
          <div style={{display: "flex"}}>iEXEC NOX</div>
          <div style={{display: "flex", color: INK_50}}>·</div>
          <div
            style={{
              display: "flex",
              color: market.state === DarkOddsState.Open ? ACCENT_AMBER : INK_50,
            }}
          >
            {stateLabel}
          </div>
        </div>
        <div
          style={{
            border: `2px solid ${REDACTED_RED}`,
            color: REDACTED_RED,
            padding: "6px 12px",
            fontSize: 16,
            fontFamily: "SpecialElite",
            letterSpacing: 2,
            textTransform: "uppercase",
            transform: "rotate(-1deg)",
            display: "flex",
          }}
        >
          DARKODDS
        </div>
      </div>

      {/* Question */}
      <div
        style={{
          fontSize: 60,
          fontFamily: "Fraunces",
          fontWeight: 600,
          color: INK,
          lineHeight: 1.05,
          letterSpacing: -1.5,
          display: "flex",
        }}
      >
        {market.question.length > 110 ? `${market.question.slice(0, 107)}…` : market.question}
      </div>

      {/* Odds bar */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontFamily: "GeistMono",
            fontSize: 16,
            letterSpacing: 2,
            color: INK_70,
            textTransform: "uppercase",
          }}
        >
          <div style={{display: "flex"}}>YES {yesPct !== null ? `${Math.round(yesPct * 100)}%` : "—"}</div>
          <div style={{display: "flex"}}>NO {noPct !== null ? `${Math.round(noPct * 100)}%` : "—"}</div>
        </div>
        <div
          style={{
            display: "flex",
            height: 16,
            border: `1px solid ${HAIRLINE_STRONG}`,
          }}
        >
          <div style={{flex: yesFlex, background: ACCENT_YES, display: "flex"}} />
          <div style={{flex: noFlex, background: ACCENT_NO, display: "flex"}} />
        </div>
      </div>

      {/* Pool redaction bar + expiry */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-end",
          gap: 32,
        }}
      >
        <div style={{display: "flex", flexDirection: "column", gap: 8}}>
          <div
            style={{
              fontFamily: "GeistMono",
              fontSize: 14,
              letterSpacing: 2,
              color: INK_50,
              textTransform: "uppercase",
              display: "flex",
            }}
          >
            POOL TOTAL
          </div>
          <div style={{display: "flex", alignItems: "center", gap: 12}}>
            <div style={{width: 220, height: 22, background: INK, display: "flex"}} />
            <div
              style={{
                fontFamily: "GeistMono",
                fontSize: 16,
                color: INK_70,
                display: "flex",
              }}
            >
              cUSDC
            </div>
          </div>
        </div>
        <div style={{display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end"}}>
          <div
            style={{
              fontFamily: "GeistMono",
              fontSize: 14,
              letterSpacing: 2,
              color: INK_50,
              textTransform: "uppercase",
              display: "flex",
            }}
          >
            RESOLVES BY
          </div>
          <div style={{fontSize: 26, fontFamily: "Fraunces", fontWeight: 600, color: INK, display: "flex"}}>
            {formatExpiry(market.expiryTs)}
          </div>
        </div>
      </div>

      {/* Footer hairline + URL */}
      <div style={{display: "flex", flexDirection: "column", gap: 12, marginTop: "auto"}}>
        <div style={{height: 1, background: HAIRLINE, width: "100%"}} />
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: 14,
            color: INK_50,
            fontFamily: "GeistMono",
            letterSpacing: 1.5,
            textTransform: "uppercase",
          }}
        >
          <div style={{display: "flex"}}>darkodds.site</div>
          <div style={{display: "flex"}}>permissionless · privacy · arbitrum sepolia</div>
        </div>
      </div>
    </div>,
    {...size, fonts: getOgFonts()},
  );
}

function notFoundCard(): ImageResponse {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        background: BONE,
        padding: 64,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        gap: 24,
        fontFamily: "Geist",
      }}
    >
      <div
        style={{
          border: `2px solid ${REDACTED_RED}`,
          color: REDACTED_RED,
          padding: "12px 24px",
          fontSize: 22,
          fontFamily: "SpecialElite",
          letterSpacing: 3,
          textTransform: "uppercase",
          transform: "rotate(-1deg)",
          display: "flex",
        }}
      >
        NO CASE FILE FOUND
      </div>
      <div
        style={{
          fontSize: 96,
          fontFamily: "Fraunces",
          fontWeight: 600,
          color: INK,
          letterSpacing: -2,
          display: "flex",
        }}
      >
        DARKODDS
      </div>
      <div
        style={{
          fontSize: 22,
          color: INK_70,
          fontFamily: "Geist",
          display: "flex",
        }}
      >
        Public market. Private wager. Permissionless creation.
      </div>
    </div>,
    {...size, fonts: getOgFonts()},
  );
}
