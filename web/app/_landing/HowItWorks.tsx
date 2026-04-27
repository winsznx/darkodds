/**
 * Section 3 — "Three steps. Nothing more."
 *
 * Triptych explaining the bettor's path through DarkOdds in plain English.
 * Each step has a step illustration and a PUBLIC/PRIVATE contract row.
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

                {/* FIX 2: TestUSDC s=44→57 (30% bump). ISO 30°:
                    cos30*57=49.4, sin30*57=28.5, height=57 */}
                <g transform="translate(130 178)">
                  <polygon
                    points="0,0 49.4,-28.5 49.4,-85.5 0,-57"
                    fill="var(--illo-fill-r)"
                    stroke="var(--illo-stroke)"
                    strokeWidth="1.5"
                    strokeLinejoin="round"
                  />
                  <polygon
                    points="0,0 -49.4,-28.5 -49.4,-85.5 0,-57"
                    fill="var(--illo-fill-l)"
                    stroke="var(--illo-stroke)"
                    strokeWidth="1.5"
                    strokeLinejoin="round"
                  />
                  <polygon
                    points="0,-57 49.4,-85.5 0,-114 -49.4,-85.5"
                    fill="var(--illo-fill-t)"
                    stroke="var(--illo-stroke)"
                    strokeWidth="1.5"
                    strokeLinejoin="round"
                  />
                  <text
                    x="0"
                    y="12"
                    textAnchor="middle"
                    fontFamily="'Geist Mono', monospace"
                    fontSize="11"
                    letterSpacing="0.1em"
                    fill="var(--illo-stroke)"
                    style={{textTransform: "uppercase"}}
                  >
                    TestUSDC
                  </text>
                </g>

                {/* FIX 2: Arrow — 1.5px stroke, hairline arrowhead, ink 80% opacity */}
                <g stroke="var(--illo-stroke)" strokeWidth="1.5" fill="none" opacity="0.8">
                  <line x1="200" y1="125" x2="276" y2="125" />
                  <polyline points="271,121 280,125 271,129" strokeLinejoin="round" />
                </g>

                {/* FIX 2: cUSDC s=56→73 (30% bump). ISO 30°:
                    cos30*73=63.2, sin30*73=36.5, height=73 */}
                <g transform="translate(350 182)">
                  <polygon
                    points="0,0 63.2,-36.5 63.2,-109.5 0,-73"
                    fill="var(--illo-fill-r)"
                    stroke="var(--illo-stroke)"
                    strokeWidth="1.5"
                    strokeLinejoin="round"
                  />
                  <polygon
                    points="0,0 -63.2,-36.5 -63.2,-109.5 0,-73"
                    fill="var(--illo-fill-l)"
                    stroke="var(--illo-stroke)"
                    strokeWidth="1.5"
                    strokeLinejoin="round"
                  />
                  <polygon
                    points="0,-73 63.2,-109.5 0,-146 -63.2,-109.5"
                    fill="var(--illo-fill-t)"
                    stroke="var(--illo-stroke)"
                    strokeWidth="1.5"
                    strokeLinejoin="round"
                  />
                  {/* Small redaction bar on top face */}
                  <rect
                    x="-28"
                    y="-116"
                    width="56"
                    height="10"
                    fill="var(--redaction)"
                    transform="skewY(-30) translate(0 14)"
                  />
                  <text
                    x="0"
                    y="12"
                    textAnchor="middle"
                    fontFamily="'Geist Mono', monospace"
                    fontSize="11"
                    letterSpacing="0.1em"
                    fill="var(--illo-stroke)"
                    style={{textTransform: "uppercase"}}
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

                {/* FIX 2: cUSDC s=44→57 (30% bump). ISO 30°:
                    cos30*57=49.4, sin30*57=28.5, height=57 */}
                <g transform="translate(120 180)">
                  <polygon
                    points="0,0 49.4,-28.5 49.4,-85.5 0,-57"
                    fill="var(--illo-fill-r)"
                    stroke="var(--illo-stroke)"
                    strokeWidth="1.5"
                    strokeLinejoin="round"
                  />
                  <polygon
                    points="0,0 -49.4,-28.5 -49.4,-85.5 0,-57"
                    fill="var(--illo-fill-l)"
                    stroke="var(--illo-stroke)"
                    strokeWidth="1.5"
                    strokeLinejoin="round"
                  />
                  <polygon
                    points="0,-57 49.4,-85.5 0,-114 -49.4,-85.5"
                    fill="var(--illo-fill-t)"
                    stroke="var(--illo-stroke)"
                    strokeWidth="1.5"
                    strokeLinejoin="round"
                  />
                  {/* Small redaction bar on top face */}
                  <rect
                    x="-22"
                    y="-92"
                    width="44"
                    height="8"
                    fill="var(--redaction)"
                    transform="skewY(-30) translate(0 12)"
                  />
                  <text
                    x="0"
                    y="12"
                    textAnchor="middle"
                    fontFamily="'Geist Mono', monospace"
                    fontSize="11"
                    letterSpacing="0.1em"
                    fill="var(--illo-stroke)"
                    style={{textTransform: "uppercase"}}
                  >
                    cUSDC
                  </text>
                </g>

                {/* FIX 2: Arrow — 1.5px stroke, hairline arrowhead, ink 80% opacity */}
                <g stroke="var(--illo-stroke)" strokeWidth="1.5" fill="none" opacity="0.8">
                  <line x1="190" y1="125" x2="266" y2="125" />
                  <polyline points="261,121 270,125 261,129" strokeLinejoin="round" />
                </g>

                {/* FIX 2: MARKET s=64→83 (30% bump). ISO 30°:
                    cos30*83=71.9, sin30*83=41.5, height=83 */}
                <g transform="translate(350 190)">
                  <polygon
                    points="0,0 71.9,-41.5 71.9,-124.5 0,-83"
                    fill="var(--illo-fill-r)"
                    stroke="var(--illo-stroke)"
                    strokeWidth="1.5"
                    strokeLinejoin="round"
                  />
                  <polygon
                    points="0,0 -71.9,-41.5 -71.9,-124.5 0,-83"
                    fill="var(--illo-fill-l)"
                    stroke="var(--illo-stroke)"
                    strokeWidth="1.5"
                    strokeLinejoin="round"
                  />
                  <polygon
                    points="0,-83 71.9,-124.5 0,-166 -71.9,-124.5"
                    fill="var(--illo-fill-t)"
                    stroke="var(--illo-stroke)"
                    strokeWidth="1.5"
                    strokeLinejoin="round"
                  />
                  <text
                    x="0"
                    y="12"
                    textAnchor="middle"
                    fontFamily="'Geist Mono', monospace"
                    fontSize="11"
                    letterSpacing="0.1em"
                    fill="var(--illo-stroke)"
                    style={{textTransform: "uppercase"}}
                  >
                    MARKET
                  </text>
                </g>

                {/* FIX 2: "BET" redaction bar — 16px tall, partially overlaps
                    top of MARKET cube, slight -2° rotation.
                    MARKET cube top-face apex is at (350, 190-166) = (350, 24).
                    Bar sits just above top face, overlapping ~30% into it. */}
                <g transform="translate(350 38) rotate(-2)">
                  <rect x="-36" y="-8" width="72" height="16" fill="var(--redaction)" />
                  <text
                    x="0"
                    y="4"
                    textAnchor="middle"
                    fontFamily="'Geist Mono', monospace"
                    fontSize="9"
                    letterSpacing="0.1em"
                    fill="var(--bone, #f5f1e8)"
                    style={{textTransform: "uppercase"}}
                  >
                    BET
                  </text>
                </g>
                {/* Dashed connector from BET bar to MARKET cube top */}
                <line
                  x1="350"
                  y1="46"
                  x2="350"
                  y2="66"
                  stroke="var(--illo-stroke)"
                  strokeWidth="1.5"
                  strokeDasharray="4 3"
                  opacity="0.8"
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

                {/* FIX 2: MARKET s=52→68 (30% bump). ISO 30°:
                    cos30*68=58.9, sin30*68=34, height=68 */}
                <g transform="translate(125 170)">
                  <polygon
                    points="0,0 58.9,-34 58.9,-102 0,-68"
                    fill="var(--illo-fill-r)"
                    stroke="var(--illo-stroke)"
                    strokeWidth="1.5"
                    strokeLinejoin="round"
                  />
                  <polygon
                    points="0,0 -58.9,-34 -58.9,-102 0,-68"
                    fill="var(--illo-fill-l)"
                    stroke="var(--illo-stroke)"
                    strokeWidth="1.5"
                    strokeLinejoin="round"
                  />
                  <polygon
                    points="0,-68 58.9,-102 0,-136 -58.9,-102"
                    fill="var(--illo-fill-t)"
                    stroke="var(--illo-stroke)"
                    strokeWidth="1.5"
                    strokeLinejoin="round"
                  />
                  <text
                    x="0"
                    y="12"
                    textAnchor="middle"
                    fontFamily="'Geist Mono', monospace"
                    fontSize="11"
                    letterSpacing="0.1em"
                    fill="var(--illo-stroke)"
                    style={{textTransform: "uppercase"}}
                  >
                    MARKET
                  </text>
                  <text
                    x="0"
                    y="26"
                    textAnchor="middle"
                    fontFamily="'Geist Mono', monospace"
                    fontSize="9"
                    letterSpacing="0.18em"
                    fill="var(--illo-stroke)"
                    opacity="0.6"
                    style={{textTransform: "uppercase"}}
                  >
                    RESOLVED
                  </text>
                </g>

                {/* FIX 2: Arrow — 1.5px stroke, hairline arrowhead, ink 80% opacity */}
                <g stroke="var(--illo-stroke)" strokeWidth="1.5" fill="none" opacity="0.8">
                  <line x1="205" y1="115" x2="276" y2="115" />
                  <polyline points="271,111 280,115 271,119" strokeLinejoin="round" />
                </g>

                {/* FIX 2: PAYOUT s=52→68 (30% bump). ISO 30°:
                    cos30*68=58.9, sin30*68=34, height=68 */}
                <g transform="translate(355 170)">
                  <polygon
                    points="0,0 58.9,-34 58.9,-102 0,-68"
                    fill="var(--illo-fill-r)"
                    stroke="var(--illo-stroke)"
                    strokeWidth="1.5"
                    strokeLinejoin="round"
                  />
                  <polygon
                    points="0,0 -58.9,-34 -58.9,-102 0,-68"
                    fill="var(--illo-fill-l)"
                    stroke="var(--illo-stroke)"
                    strokeWidth="1.5"
                    strokeLinejoin="round"
                  />
                  <polygon
                    points="0,-68 58.9,-102 0,-136 -58.9,-102"
                    fill="var(--illo-fill-t)"
                    stroke="var(--illo-stroke)"
                    strokeWidth="1.5"
                    strokeLinejoin="round"
                  />
                  {/* Redaction bar on top face */}
                  <rect
                    x="-26"
                    y="-108"
                    width="52"
                    height="9"
                    fill="var(--redaction)"
                    transform="skewY(-30) translate(0 14)"
                  />
                  <text
                    x="0"
                    y="12"
                    textAnchor="middle"
                    fontFamily="'Geist Mono', monospace"
                    fontSize="11"
                    letterSpacing="0.1em"
                    fill="var(--illo-stroke)"
                    style={{textTransform: "uppercase"}}
                  >
                    PAYOUT
                  </text>
                </g>

                {/* FIX 2: ATTESTATION // SELECTIVE-DISCLOSURE stamp.
                    Positioned with 24px clearance from cubes and column edge.
                    Cubes end at y=182 (base 170 + 12px label). Stamp at y=170+24=194 min.
                    Using y=196. Narrowed to avoid clipping column edges. */}
                <g transform="translate(240 196) rotate(-2)">
                  <rect
                    x="-84"
                    y="-10"
                    width="168"
                    height="20"
                    fill="none"
                    stroke="var(--redacted-red)"
                    strokeWidth="1.5"
                  />
                  <text
                    x="0"
                    y="4"
                    textAnchor="middle"
                    fontFamily="'Special Elite', monospace"
                    fontSize="9"
                    letterSpacing="0.12em"
                    fill="var(--redacted-red)"
                    style={{textTransform: "uppercase"}}
                  >
                    ATTESTATION // SELECTIVE-DISCLOSURE
                  </text>
                </g>
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
          <div className="pm">the math runs in the enclave.</div>
          <div className="pr">EVERY TIME.</div>
        </div>
      </div>

      <div className="sec3-pageno">03 / 09</div>
    </section>
  );
}
