import Link from "next/link";

/**
 * Section 1 / 9 — Hero. Translated from the design handoff
 * (darkodds-declassified-dossier/project/hero.html). Surgical edits per the
 * design's chat transcript: stamp reads CLASSIFIED // PRIVACY PERMISSIONLESS,
 * three-line headline ending with "Permissionless creation.", new subhead,
 * stat 3 reframed as "Open-create · Markets" with the redaction-bar treatment
 * to reinforce that the count itself is a moving target.
 *
 * The top utility strip was lifted into ../LandingHeader.tsx so position:sticky
 * survives past the hero's bounding box.
 */
export function Hero(): React.ReactElement {
  return (
    <section className="hero">
      <div className="hero-grid">
        {/* LEFT */}
        <div className="hero-left">
          <div className="stamp-wrap">
            <span className="stamp stamp--red" style={{transform: "rotate(-1deg)"}}>
              CLASSIFIED // PRIVACY PERMISSIONLESS
            </span>
          </div>

          <h1 className="headline">
            Public market.
            <br />
            Private <em>wager</em>.
            <br />
            Permissionless creation.
          </h1>

          <p className="subhead">
            Outcomes public. Wagers redacted. Markets created by anyone. Built on iExec Nox + Arbitrum.
            Selective-disclosure attestations you can show your accountant — or seal forever.
          </p>

          <div className="cta-row">
            <Link href="/markets" className="btn btn--primary">
              ENTER MARKETS&nbsp;&nbsp;→
            </Link>
            <Link href="/audit" className="btn btn--ghost">
              VIEW AUDIT TRAIL
            </Link>
          </div>

          <div className="stat-row">
            <div className="stat">
              <div className="num">10</div>
              <div className="lbl">Deployed contracts</div>
            </div>
            <div className="stat">
              <div className="num">
                178<span className="slash">/</span>180
              </div>
              <div className="lbl">Tests passing</div>
            </div>
            <div className="stat">
              <div className="num">
                <span className="redact-bar" aria-label="redacted" />
              </div>
              <div className="lbl">Open-create · Markets</div>
            </div>
          </div>
        </div>

        {/* RIGHT — protocol diagram */}
        <div className="hero-right">
          <div className="illo">
            <div className="fig-label">
              <span className="b">FIG.01 — DARKODDS PROTOCOL</span>
              <span className="b">ISO 30° / MONO / 1.5PX</span>
              <span className="b">v1.0</span>
            </div>

            <div className="page-no">01 / 09</div>

            <svg viewBox="0 0 720 720" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">
              <defs>
                <pattern id="iso-grid" x="0" y="0" width="24" height="24" patternUnits="userSpaceOnUse">
                  <circle cx="0" cy="0" r="1" fill="var(--illo-grid)" fillOpacity="0.18" />
                </pattern>
              </defs>
              <rect width="720" height="720" fill="url(#iso-grid)" />

              {/* connectors */}
              <g stroke="var(--illo-conn)" strokeWidth="1" fill="none" strokeLinecap="round">
                <g strokeDasharray="4 4">
                  <line x1="220" y1="380" x2="360" y2="460" />
                  <line x1="500" y1="380" x2="360" y2="460" />
                  <line x1="360" y1="240" x2="360" y2="460" />
                </g>
                <g>
                  <line x1="220" y1="580" x2="360" y2="460" />
                  <line x1="500" y1="580" x2="360" y2="460" />
                </g>
              </g>

              {/* iEXEC NOX cube s=64 */}
              <g transform="translate(220 412)">
                <polygon
                  points="0,0 55.4,-32 55.4,-96 0,-64"
                  fill="var(--illo-fill-r)"
                  stroke="var(--illo-stroke)"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                />
                <polygon
                  points="0,0 -55.4,-32 -55.4,-96 0,-64"
                  fill="var(--illo-fill-l)"
                  stroke="var(--illo-stroke)"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                />
                <polygon
                  points="0,-64 55.4,-96 0,-128 -55.4,-96"
                  fill="var(--illo-fill-t)"
                  stroke="var(--illo-stroke)"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                />
                <g transform="translate(0 -96)" stroke="var(--illo-stroke)" strokeWidth="1" fill="none">
                  <rect x="-9" y="-6" width="18" height="12" />
                  <line x1="-12" y1="-3" x2="-9" y2="-3" />
                  <line x1="-12" y1="3" x2="-9" y2="3" />
                  <line x1="9" y1="-3" x2="12" y2="-3" />
                  <line x1="9" y1="3" x2="12" y2="3" />
                  <circle cx="-3" cy="-1" r="1.2" fill="var(--illo-stroke)" />
                  <circle cx="3" cy="2" r="1.2" fill="var(--illo-stroke)" />
                </g>
                <text
                  x="0"
                  y="22"
                  textAnchor="middle"
                  fontFamily="'Geist Mono', monospace"
                  fontSize="11"
                  letterSpacing="0.88"
                  fill="var(--illo-stroke)"
                >
                  iEXEC NOX
                </text>
              </g>

              {/* ARBITRUM cube s=64 */}
              <g transform="translate(500 412)">
                <polygon
                  points="0,0 55.4,-32 55.4,-96 0,-64"
                  fill="var(--illo-fill-r)"
                  stroke="var(--illo-stroke)"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                />
                <polygon
                  points="0,0 -55.4,-32 -55.4,-96 0,-64"
                  fill="var(--illo-fill-l)"
                  stroke="var(--illo-stroke)"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                />
                <polygon
                  points="0,-64 55.4,-96 0,-128 -55.4,-96"
                  fill="var(--illo-fill-t)"
                  stroke="var(--illo-stroke)"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                />
                <g transform="translate(0 -96)" stroke="var(--illo-stroke)" strokeWidth="1.4" fill="none">
                  <path d="M -8 0 C -8 -4, -2 -4, 0 0 C 2 4, 8 4, 8 0 C 8 -4, 2 -4, 0 0 C -2 4, -8 4, -8 0 Z" />
                </g>
                <text
                  x="0"
                  y="22"
                  textAnchor="middle"
                  fontFamily="'Geist Mono', monospace"
                  fontSize="11"
                  letterSpacing="0.88"
                  fill="var(--illo-stroke)"
                >
                  ARBITRUM
                </text>
              </g>

              {/* MARKET cube s=120 — dominant */}
              <g transform="translate(360 520)">
                <polygon
                  points="0,0 103.9,-60 103.9,-180 0,-120"
                  fill="var(--illo-fill-r)"
                  stroke="var(--illo-stroke)"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                />
                <polygon
                  points="0,0 -103.9,-60 -103.9,-180 0,-120"
                  fill="var(--illo-fill-l)"
                  stroke="var(--illo-stroke)"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                />
                <polygon
                  points="0,-120 103.9,-180 0,-240 -103.9,-180"
                  fill="var(--illo-fill-t)"
                  stroke="var(--illo-stroke)"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                />
                <g transform="translate(0 -180)">
                  <circle cx="0" cy="0" r="20" fill="none" stroke="var(--illo-stroke)" strokeWidth="1.2" />
                  <text
                    x="0"
                    y="7"
                    textAnchor="middle"
                    fontFamily="Fraunces, serif"
                    fontStyle="italic"
                    fontSize="24"
                    fontWeight="600"
                    fill="var(--illo-stroke)"
                  >
                    ?
                  </text>
                </g>
                <text
                  x="0"
                  y="24"
                  textAnchor="middle"
                  fontFamily="'Geist Mono', monospace"
                  fontSize="13"
                  letterSpacing="1.04"
                  fontWeight="500"
                  fill="var(--illo-stroke)"
                >
                  MARKET
                </text>
              </g>

              {/* cUSDC cube s=64 */}
              <g transform="translate(220 612)">
                <polygon
                  points="0,0 55.4,-32 55.4,-96 0,-64"
                  fill="var(--illo-fill-r)"
                  stroke="var(--illo-stroke)"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                />
                <polygon
                  points="0,0 -55.4,-32 -55.4,-96 0,-64"
                  fill="var(--illo-fill-l)"
                  stroke="var(--illo-stroke)"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                />
                <polygon
                  points="0,-64 55.4,-96 0,-128 -55.4,-96"
                  fill="var(--illo-fill-t)"
                  stroke="var(--illo-stroke)"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                />
                <g transform="translate(0 -96)">
                  <circle cx="0" cy="0" r="9" fill="none" stroke="var(--illo-stroke)" strokeWidth="1.2" />
                  <text
                    x="0"
                    y="3.5"
                    textAnchor="middle"
                    fontFamily="'Geist Mono', monospace"
                    fontSize="10"
                    fontWeight="700"
                    fill="var(--illo-stroke)"
                  >
                    $
                  </text>
                </g>
                <text
                  x="0"
                  y="22"
                  textAnchor="middle"
                  fontFamily="'Geist Mono', monospace"
                  fontSize="11"
                  letterSpacing="0.88"
                  fill="var(--illo-stroke)"
                >
                  cUSDC
                </text>
              </g>

              {/* ATTESTATION cube s=64 */}
              <g transform="translate(500 612)">
                <polygon
                  points="0,0 55.4,-32 55.4,-96 0,-64"
                  fill="var(--illo-fill-r)"
                  stroke="var(--illo-stroke)"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                />
                <polygon
                  points="0,0 -55.4,-32 -55.4,-96 0,-64"
                  fill="var(--illo-fill-l)"
                  stroke="var(--illo-stroke)"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                />
                <polygon
                  points="0,-64 55.4,-96 0,-128 -55.4,-96"
                  fill="var(--illo-fill-t)"
                  stroke="var(--illo-stroke)"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                />
                <g transform="translate(0 -96)" stroke="var(--illo-stroke)" strokeWidth="1.2" fill="none">
                  <rect x="-3" y="-9" width="6" height="5" />
                  <rect x="-9" y="-4" width="18" height="6" />
                  <line x1="-11" y1="3" x2="11" y2="3" />
                </g>
                <text
                  x="0"
                  y="22"
                  textAnchor="middle"
                  fontFamily="'Geist Mono', monospace"
                  fontSize="11"
                  letterSpacing="0.88"
                  fill="var(--illo-stroke)"
                >
                  ATTESTATION
                </text>
              </g>

              {/* BET cube s=56 */}
              <g transform="translate(360 268)">
                <polygon
                  points="0,0 48.5,-28 48.5,-84 0,-56"
                  fill="var(--illo-fill-r)"
                  stroke="var(--illo-stroke)"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                />
                <polygon
                  points="0,0 -48.5,-28 -48.5,-84 0,-56"
                  fill="var(--illo-fill-l)"
                  stroke="var(--illo-stroke)"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                />
                <polygon
                  points="0,-56 48.5,-84 0,-112 -48.5,-84"
                  fill="var(--illo-fill-t)"
                  stroke="var(--illo-stroke)"
                  strokeWidth="1.5"
                  strokeLinejoin="round"
                />
                <text
                  x="0"
                  y="22"
                  textAnchor="middle"
                  fontFamily="'Geist Mono', monospace"
                  fontSize="11"
                  letterSpacing="0.88"
                  fill="var(--illo-stroke)"
                >
                  BET
                </text>
              </g>

              {/* BET redaction bar — over the BET label, rotated -2° */}
              <g transform="translate(360 290) rotate(-2)">
                <rect x="-53.5" y="-6" width="107" height="12" fill="#000000" />
              </g>
            </svg>

            {/* toggles */}
            <div className="illo-toggle">
              <button type="button" className="bpill is-active">
                BET → ENCRYPTED
              </button>
              <button type="button" className="bpill">
                OUTCOME → PUBLIC
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
