/**
 * Section 3 / 9 — Three steps. Nothing more.
 * Translated from the design handoff (sec3 in hero.html). Three procedural
 * columns — Wrap / Bet / Claim — each with its own isometric SVG and a
 * PUBLIC / PRIVATE contract row. INVARIANT punchline at the foot.
 */
export function HowItWorks(): React.ReactElement {
  return (
    <section className="sec3" data-screen-label="03 How It Works">
      <div className="sec3-head">
        <span className="stamp stamp--ink" style={{transform: "rotate(-1deg)", alignSelf: "flex-start"}}>
          PROCEDURE // FILE NO. DK-0426 §3
        </span>
        <h2 className="sec3-h">
          Three steps.
          <br />
          Nothing <em>more</em>.
        </h2>
        <p className="sec3-sub">
          A bettor&apos;s path through DarkOdds in plain English. What&apos;s public stays public. What&apos;s
          private stays private. Math runs in a TEE.
        </p>
      </div>

      <p className="sec3-caption">
        Anyone can create the market. Anyone can bet. The math runs in the enclave. The privacy is
        mathematical.
      </p>

      <div className="steps-wrap">
        <div className="steps">
          {/* STEP 01 — WRAP */}
          <div className="step">
            <div className="step-num">STEP 01</div>
            <h3 className="step-title">Wrap.</h3>
            <p className="step-desc">
              Deposit TestUSDC into the cUSDC contract. Your balance becomes an encrypted handle, ACL&apos;d
              to your wallet only.
            </p>

            <div className="step-illo">
              <svg
                viewBox="0 0 480 240"
                preserveAspectRatio="xMidYMid meet"
                xmlns="http://www.w3.org/2000/svg"
              >
                <defs>
                  <pattern id="g3-1" x="0" y="0" width="20" height="20" patternUnits="userSpaceOnUse">
                    <circle cx="0" cy="0" r="0.9" fill="var(--illo-grid)" fillOpacity="0.18" />
                  </pattern>
                </defs>
                <rect width="480" height="240" fill="url(#g3-1)" />

                {/* TestUSDC cube s=44 */}
                <g transform="translate(140 168)">
                  <polygon
                    points="0,0 38.1,-22 38.1,-66 0,-44"
                    fill="var(--illo-fill-r)"
                    stroke="var(--illo-stroke)"
                    strokeWidth="1.5"
                    strokeLinejoin="round"
                  />
                  <polygon
                    points="0,0 -38.1,-22 -38.1,-66 0,-44"
                    fill="var(--illo-fill-l)"
                    stroke="var(--illo-stroke)"
                    strokeWidth="1.5"
                    strokeLinejoin="round"
                  />
                  <polygon
                    points="0,-44 38.1,-66 0,-88 -38.1,-66"
                    fill="var(--illo-fill-t)"
                    stroke="var(--illo-stroke)"
                    strokeWidth="1.5"
                    strokeLinejoin="round"
                  />
                  <text
                    x="0"
                    y="20"
                    textAnchor="middle"
                    fontFamily="'Geist Mono', monospace"
                    fontSize="10"
                    letterSpacing="0.8"
                    fill="var(--illo-stroke)"
                  >
                    TestUSDC
                  </text>
                </g>

                <g stroke="var(--illo-stroke)" strokeWidth="1" fill="none">
                  <line x1="200" y1="125" x2="276" y2="125" />
                  <polyline points="270,120 280,125 270,130" strokeLinejoin="round" />
                </g>

                {/* cUSDC cube s=56 with redaction */}
                <g transform="translate(340 174)">
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
                  <rect
                    x="-22"
                    y="-90"
                    width="44"
                    height="8"
                    fill="#000000"
                    transform="skewY(-30) translate(0 12)"
                  />
                  <text
                    x="0"
                    y="20"
                    textAnchor="middle"
                    fontFamily="'Geist Mono', monospace"
                    fontSize="10"
                    letterSpacing="0.8"
                    fill="var(--illo-stroke)"
                  >
                    cUSDC
                  </text>
                </g>
              </svg>
            </div>

            <div className="pp-strip">
              <div>
                <b>PUBLIC:</b> cUSDC contract address, transaction hash
              </div>
              <div>
                <b>PRIVATE:</b> balance amount
              </div>
            </div>
          </div>

          {/* STEP 02 — BET */}
          <div className="step">
            <div className="step-num">STEP 02</div>
            <h3 className="step-title">Bet.</h3>
            <p className="step-desc">
              Encrypt your stake off-chain via the Nox SDK, bound to a specific market. Submit to
              Market.placeBet. Your handle commits to the on-chain ACL — the bet is locked, the size stays
              sealed.
            </p>

            <div className="step-illo">
              <svg
                viewBox="0 0 480 240"
                preserveAspectRatio="xMidYMid meet"
                xmlns="http://www.w3.org/2000/svg"
              >
                <defs>
                  <pattern id="g3-2" x="0" y="0" width="20" height="20" patternUnits="userSpaceOnUse">
                    <circle cx="0" cy="0" r="0.9" fill="var(--illo-grid)" fillOpacity="0.18" />
                  </pattern>
                </defs>
                <rect width="480" height="240" fill="url(#g3-2)" />

                <g transform="translate(130 170)">
                  <polygon
                    points="0,0 38.1,-22 38.1,-66 0,-44"
                    fill="var(--illo-fill-r)"
                    stroke="var(--illo-stroke)"
                    strokeWidth="1.5"
                    strokeLinejoin="round"
                  />
                  <polygon
                    points="0,0 -38.1,-22 -38.1,-66 0,-44"
                    fill="var(--illo-fill-l)"
                    stroke="var(--illo-stroke)"
                    strokeWidth="1.5"
                    strokeLinejoin="round"
                  />
                  <polygon
                    points="0,-44 38.1,-66 0,-88 -38.1,-66"
                    fill="var(--illo-fill-t)"
                    stroke="var(--illo-stroke)"
                    strokeWidth="1.5"
                    strokeLinejoin="round"
                  />
                  <rect
                    x="-17"
                    y="-70"
                    width="34"
                    height="6"
                    fill="#000000"
                    transform="skewY(-30) translate(0 9)"
                  />
                  <text
                    x="0"
                    y="20"
                    textAnchor="middle"
                    fontFamily="'Geist Mono', monospace"
                    fontSize="10"
                    letterSpacing="0.8"
                    fill="var(--illo-stroke)"
                  >
                    cUSDC
                  </text>
                </g>

                <g stroke="var(--illo-stroke)" strokeWidth="1" fill="none">
                  <line x1="190" y1="125" x2="266" y2="125" />
                  <polyline points="260,120 270,125 260,130" strokeLinejoin="round" />
                </g>

                <g transform="translate(350 180)">
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
                  <text
                    x="0"
                    y="20"
                    textAnchor="middle"
                    fontFamily="'Geist Mono', monospace"
                    fontSize="10"
                    letterSpacing="0.8"
                    fill="var(--illo-stroke)"
                  >
                    MARKET
                  </text>
                </g>

                <g transform="translate(350 50) rotate(-2)">
                  <rect x="-30" y="-7" width="60" height="14" fill="#000000" />
                  <text
                    x="0"
                    y="3"
                    textAnchor="middle"
                    fontFamily="'Geist Mono', monospace"
                    fontSize="8"
                    letterSpacing="1"
                    fill="#F5F1E8"
                  >
                    BET
                  </text>
                </g>
                <line
                  x1="350"
                  y1="64"
                  x2="350"
                  y2="84"
                  stroke="var(--illo-stroke)"
                  strokeWidth="1"
                  strokeDasharray="3 3"
                />

                <text
                  x="240"
                  y="232"
                  textAnchor="middle"
                  fontFamily="'Special Elite', monospace"
                  fontSize="10"
                  letterSpacing="1.2"
                  fill="var(--illo-stroke)"
                >
                  ENCRYPTED ON NOX
                </text>
              </svg>
            </div>

            <div className="pp-strip">
              <div>
                <b>PUBLIC:</b> market address, side (YES/NO), batch publication
              </div>
              <div>
                <b>PRIVATE:</b> bet size
              </div>
            </div>
          </div>

          {/* STEP 03 — CLAIM */}
          <div className="step">
            <div className="step-num">STEP 03</div>
            <h3 className="step-title">Claim.</h3>
            <p className="step-desc">
              When the market resolves, call claimWinnings. The TEE computes your proportional payout in
              plaintext inside the enclave, re-encrypts the result, and transfers cUSDC back to your wallet.
              Optionally generate an audit attestation — signed, recipient-bound, downloadable.
            </p>

            <div className="step-illo">
              <svg
                viewBox="0 0 480 240"
                preserveAspectRatio="xMidYMid meet"
                xmlns="http://www.w3.org/2000/svg"
              >
                <defs>
                  <pattern id="g3-3" x="0" y="0" width="20" height="20" patternUnits="userSpaceOnUse">
                    <circle cx="0" cy="0" r="0.9" fill="var(--illo-grid)" fillOpacity="0.18" />
                  </pattern>
                </defs>
                <rect width="480" height="240" fill="url(#g3-3)" />

                <g transform="translate(135 158)">
                  <polygon
                    points="0,0 45,-26 45,-78 0,-52"
                    fill="var(--illo-fill-r)"
                    stroke="var(--illo-stroke)"
                    strokeWidth="1.5"
                    strokeLinejoin="round"
                  />
                  <polygon
                    points="0,0 -45,-26 -45,-78 0,-52"
                    fill="var(--illo-fill-l)"
                    stroke="var(--illo-stroke)"
                    strokeWidth="1.5"
                    strokeLinejoin="round"
                  />
                  <polygon
                    points="0,-52 45,-78 0,-104 -45,-78"
                    fill="var(--illo-fill-t)"
                    stroke="var(--illo-stroke)"
                    strokeWidth="1.5"
                    strokeLinejoin="round"
                  />
                  <text
                    x="0"
                    y="20"
                    textAnchor="middle"
                    fontFamily="'Geist Mono', monospace"
                    fontSize="10"
                    letterSpacing="0.8"
                    fill="var(--illo-stroke)"
                  >
                    MARKET
                  </text>
                  <text
                    x="0"
                    y="34"
                    textAnchor="middle"
                    fontFamily="'Geist Mono', monospace"
                    fontSize="9"
                    letterSpacing="1.6"
                    fill="var(--illo-stroke)"
                    opacity="0.6"
                  >
                    RESOLVED
                  </text>
                </g>

                <g stroke="var(--illo-stroke)" strokeWidth="1" fill="none">
                  <line x1="200" y1="115" x2="276" y2="115" />
                  <polyline points="270,110 280,115 270,120" strokeLinejoin="round" />
                </g>

                <g transform="translate(345 158)">
                  <polygon
                    points="0,0 45,-26 45,-78 0,-52"
                    fill="var(--illo-fill-r)"
                    stroke="var(--illo-stroke)"
                    strokeWidth="1.5"
                    strokeLinejoin="round"
                  />
                  <polygon
                    points="0,0 -45,-26 -45,-78 0,-52"
                    fill="var(--illo-fill-l)"
                    stroke="var(--illo-stroke)"
                    strokeWidth="1.5"
                    strokeLinejoin="round"
                  />
                  <polygon
                    points="0,-52 45,-78 0,-104 -45,-78"
                    fill="var(--illo-fill-t)"
                    stroke="var(--illo-stroke)"
                    strokeWidth="1.5"
                    strokeLinejoin="round"
                  />
                  <rect
                    x="-20"
                    y="-82"
                    width="40"
                    height="7"
                    fill="#000000"
                    transform="skewY(-30) translate(0 11)"
                  />
                  <text
                    x="0"
                    y="20"
                    textAnchor="middle"
                    fontFamily="'Geist Mono', monospace"
                    fontSize="10"
                    letterSpacing="0.8"
                    fill="var(--illo-stroke)"
                  >
                    PAYOUT
                  </text>
                </g>

                <g transform="translate(240 210) rotate(-2)">
                  <rect
                    x="-90"
                    y="-12"
                    width="180"
                    height="22"
                    fill="none"
                    stroke="var(--redacted-red)"
                    strokeWidth="1.5"
                  />
                  <text
                    x="0"
                    y="3"
                    textAnchor="middle"
                    fontFamily="'Special Elite', monospace"
                    fontSize="10"
                    letterSpacing="1.4"
                    fill="var(--redacted-red)"
                  >
                    ATTESTATION // SELECTIVE-DISCLOSURE
                  </text>
                </g>
                <text
                  x="240"
                  y="234"
                  textAnchor="middle"
                  fontFamily="'Geist Mono', monospace"
                  fontSize="8"
                  letterSpacing="1.2"
                  fill="var(--illo-stroke)"
                  opacity="0.6"
                >
                  OPTIONAL — RECIPIENT-BOUND OR BEARER MODE
                </text>
              </svg>
            </div>

            <div className="pp-strip">
              <div>
                <b>PUBLIC:</b> claim transaction, market outcome
              </div>
              <div>
                <b>PRIVATE:</b> payout amount
              </div>
            </div>
          </div>
        </div>

        <div className="sec3-foot">
          <div className="pl">INVARIANT</div>
          <div className="pm">the enclave keeps the wagers.</div>
          <div className="pr">EVERY TIME.</div>
        </div>
      </div>

      <div className="sec3-pageno">03 / 09</div>
    </section>
  );
}
