import {ThemeToggle} from "./ThemeToggle";

export function Hero(): React.ReactElement {
  return (
    <section className="hero">
      <div className="hero-strip">
        <div className="left">
          <span className="brand">
            <span className="crest">D◆</span>
            Dark<em>Odds</em>
          </span>
          <span>
            <span className="dot" />
            CLASSIFIED · INTERNAL
          </span>
          <span>FILE NO. DK-0426 / Δ</span>
        </div>
        <div className="right">
          <span>iEXEC NOX · ARBITRUM</span>
          <ThemeToggle />
        </div>
      </div>

      <div className="hero-grid">
        <div className="hero-left">
          <div className="stamp-wrap">
            <span className="stamp stamp--red" style={{transform: "rotate(-1deg)"}}>
              CLASSIFIED // CONFIDENTIAL DEFI
            </span>
          </div>

          <h1 className="headline">
            Public market.
            <br />
            Private <em>wager</em>.
          </h1>

          <p className="subhead">
            A prediction market where the odds are public and your bet size is encrypted. Built on iExec Nox +
            Arbitrum. Selective-disclosure payouts you can show your accountant — or keep sealed forever.
          </p>

          <div className="cta-row">
            <a href="#markets" className="btn btn--primary">
              ENTER MARKETS &nbsp;→
            </a>
            <a href="#audit" className="btn btn--ghost">
              VIEW AUDIT TRAIL
            </a>
          </div>

          <div className="stat-row">
            <div className="stat">
              <div className="num">10</div>
              <div className="lbl">Deployed contracts</div>
            </div>
            <div className="stat">
              <div className="num">
                159<span className="slash">/</span>159
              </div>
              <div className="lbl">Tests passing</div>
            </div>
            <div className="stat">
              <div className="num">
                <span className="redact-bar" aria-label="redacted" />
              </div>
              <div className="lbl">Bets hidden</div>
            </div>
          </div>
        </div>

        <div className="hero-right">
          <div className="illo">
            <div className="fig-label">
              <span className="b">FIG.01 — DARKODDS PROTOCOL</span>
              <span className="b">ISO 30° / MONO / 1.5PX</span>
              <span className="b">v1.0</span>
            </div>

            <div className="page-no">01 / 09</div>

            {/* Isometric protocol diagram. viewBox 720×720; iso 30°/150°/90°.
                Cube edges: MARKET 100, satellites 64, BET 56. Diamond layout
                with all bases on a shared iso lattice. */}
            <svg viewBox="0 0 720 720" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">
              <defs>
                <pattern id="iso-grid" x="0" y="0" width="24" height="24" patternUnits="userSpaceOnUse">
                  <circle cx="0" cy="0" r="1" fill="var(--illo-grid)" fillOpacity="0.18" />
                </pattern>
              </defs>
              <rect width="720" height="720" fill="url(#iso-grid)" />

              {/* Connectors (behind cubes) */}
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

              {/* iEXEC NOX — s=64, base (220,412) */}
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

              {/* ARBITRUM — s=64, base (500,412) */}
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

              {/* MARKET — s=120, base (360,520) DOMINANT */}
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

              {/* cUSDC — s=64, base (220,612) */}
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

              {/* ATTESTATION — s=64, base (500,612) */}
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

              {/* BET — s=56, base (360,268) */}
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

              {/* BET redaction bar — over the "BET" label, rotated -2°. */}
              <g transform="translate(360 290) rotate(-2)">
                <rect x="-53.5" y="-6" width="107" height="12" fill="#000000" />
              </g>
            </svg>

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
