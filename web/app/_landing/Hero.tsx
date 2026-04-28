import {ThemeToggle} from "./ThemeToggle";

// Isometric helper component for standard hardware cubes
type CubeProps = {
  cx: number;
  cy: number;
  a: number;
  label: string;
  topIcon?: React.ReactNode;
  id?: string;
};
const Cube = ({cx, cy, a, label, topIcon, id}: CubeProps) => {
  const dx = a * 0.866025; // a * cos(30)
  const dy = a * 0.5; // a * sin(30)

  return (
    <g id={id}>
      {/* TOP FACE */}
      <polygon
        points={`${cx},${cy} ${cx + dx},${cy - dy} ${cx},${cy - a} ${cx - dx},${cy - dy}`}
        fill="var(--illo-fill-t)"
        stroke="var(--illo-stroke)"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />

      {/* LEFT FACE */}
      <polygon
        points={`${cx},${cy} ${cx - dx},${cy - dy} ${cx - dx},${cy + dy} ${cx},${cy + a}`}
        fill="var(--illo-fill-l)"
        stroke="var(--illo-stroke)"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />

      {/* RIGHT FACE */}
      <polygon
        points={`${cx},${cy} ${cx},${cy + a} ${cx + dx},${cy + dy} ${cx + dx},${cy - dy}`}
        fill="var(--illo-fill-r)"
        stroke="var(--illo-stroke)"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />

      {/* SUBSYSTEM VENTS (Left Face) */}
      <g stroke="var(--illo-stroke)" strokeWidth="1.5" strokeLinecap="round">
        <line
          x1={cx - dx * 0.3}
          y1={cy + a * 0.3 - dy * 0.3}
          x2={cx - dx * 0.7}
          y2={cy + a * 0.3 - dy * 0.7}
        />
        <line
          x1={cx - dx * 0.3}
          y1={cy + a * 0.45 - dy * 0.3}
          x2={cx - dx * 0.7}
          y2={cy + a * 0.45 - dy * 0.7}
        />
        <line
          x1={cx - dx * 0.3}
          y1={cy + a * 0.6 - dy * 0.3}
          x2={cx - dx * 0.7}
          y2={cy + a * 0.6 - dy * 0.7}
        />
        <line
          x1={cx - dx * 0.3}
          y1={cy + a * 0.75 - dy * 0.3}
          x2={cx - dx * 0.7}
          y2={cy + a * 0.75 - dy * 0.7}
        />
      </g>

      {/* STATUS LEDS (Right Face) */}
      <g fill="var(--illo-stroke)">
        <circle cx={cx + dx * 0.55} cy={cy + a * 0.85 - dy * 0.55} r="1.5" />
        <circle cx={cx + dx * 0.75} cy={cy + a * 0.85 - dy * 0.75} r="1.5" />
      </g>

      {/* TOP FACE ICON (Isometric Projection) */}
      {topIcon && <g transform={`translate(${cx}, ${cy - a / 2}) scale(1, 0.577) rotate(45)`}>{topIcon}</g>}

      {/* LABEL */}
      <text
        x={cx}
        y={cy + a + 16}
        textAnchor="middle"
        fill="var(--fg)"
        fontFamily="var(--font-mono)"
        fontSize="11"
        fontWeight="bold"
        letterSpacing="0.08em"
      >
        {label}
      </text>
    </g>
  );
};

function ProtocolArchitecture() {
  // Isometric spacing & coordinates
  const centerMarket = {cx: 320, cy: 310, a: 60};
  const betNode = {cx: 320, cy: 150, a: 28};
  // iEXEC and cUSDC on the left side (150° and 210° axes)
  const iexecNode = {cx: 146.8, cy: 210, a: 32};
  const cusdcNode = {cx: 146.8, cy: 410, a: 32};
  // ARBITRUM and ATTESTATION on the right side (30° and 330° axes)
  const arbitrumNode = {cx: 493.2, cy: 210, a: 32};
  const attestationNode = {cx: 493.2, cy: 410, a: 32};

  return (
    <svg
      viewBox="0 0 640 600"
      width="100%"
      height="100%"
      xmlns="http://www.w3.org/2000/svg"
      className="illo-svg"
      style={{display: "block"}}
    >
      <defs>
        {/* Background Grid Pattern */}
        <pattern id="grid-pattern" x="0" y="0" width="24" height="24" patternUnits="userSpaceOnUse">
          <circle cx="2" cy="2" r="1" fill="var(--illo-grid)" opacity="0.08" />
        </pattern>
      </defs>

      {/* Grid Layer */}
      <rect x="0" y="0" width="100%" height="100%" fill="url(#grid-pattern)" />

      {/* CONNECTOR LINES (Drawn behind the cubes) */}
      <g stroke="var(--illo-conn)" strokeWidth="1.5" fill="none" opacity="0.6">
        {/* Dashed lines mapping to 90°, 150°, and 30° axes */}
        <line
          x1={betNode.cx}
          y1={betNode.cy}
          x2={centerMarket.cx}
          y2={centerMarket.cy}
          strokeDasharray="4 4"
        />
        <line
          x1={iexecNode.cx}
          y1={iexecNode.cy}
          x2={centerMarket.cx}
          y2={centerMarket.cy}
          strokeDasharray="4 4"
        />
        <line
          x1={arbitrumNode.cx}
          y1={arbitrumNode.cy}
          x2={centerMarket.cx}
          y2={centerMarket.cy}
          strokeDasharray="4 4"
        />

        {/* Solid lines mapping to 210° and 330° axes */}
        <line x1={cusdcNode.cx} y1={cusdcNode.cy} x2={centerMarket.cx} y2={centerMarket.cy} />
        <line x1={attestationNode.cx} y1={attestationNode.cy} x2={centerMarket.cx} y2={centerMarket.cy} />
      </g>

      {/* NODES (Isometric Cubes) */}

      {/* 1. BET (Top floating) */}
      <Cube cx={betNode.cx} cy={betNode.cy} a={betNode.a} label="BET" id="cube-bet" topIcon={null} />

      {/* 2. iEXEC NOX (Upper Left) */}
      <Cube
        cx={iexecNode.cx}
        cy={iexecNode.cy}
        a={iexecNode.a}
        label="IEXEC NOX"
        id="cube-iexec"
        topIcon={
          <g stroke="var(--illo-stroke)" strokeWidth="1.5" fill="var(--illo-fill-t)">
            <rect x="-10" y="-10" width="20" height="20" />
            <path d="M-14,-6 L-10,-6 M-14,0 L-10,0 M-14,6 L-10,6" fill="none" />
            <path d="M10,-6 L14,-6 M10,0 L14,0 M10,6 L14,6" fill="none" />
            <path d="M-6,-14 L-6,-10 M0,-14 L0,-10 M6,-14 L6,-10" fill="none" />
            <path d="M-6,10 L-6,14 M0,10 L0,14 M6,10 L6,14" fill="none" />
          </g>
        }
      />

      {/* 3. ARBITRUM (Upper Right) */}
      <Cube
        cx={arbitrumNode.cx}
        cy={arbitrumNode.cy}
        a={arbitrumNode.a}
        label="ARBITRUM"
        id="cube-arbitrum"
        topIcon={
          <g stroke="var(--illo-stroke)" strokeWidth="1.5" fill="var(--illo-fill-t)">
            <rect x="-14" y="-14" width="16" height="16" />
            <rect x="-6" y="-6" width="16" height="16" />
            <rect x="2" y="2" width="16" height="16" />
          </g>
        }
      />

      {/* 4. MARKET (Center Dominant Block) */}
      <Cube
        cx={centerMarket.cx}
        cy={centerMarket.cy}
        a={centerMarket.a}
        label="MARKET"
        id="cube-market"
        topIcon={
          <g>
            <circle
              cx="0"
              cy="0"
              r="24"
              fill="var(--illo-fill-t)"
              stroke="var(--illo-stroke)"
              strokeWidth="2"
            />
            <text
              x="0"
              y="8"
              textAnchor="middle"
              fill="var(--illo-stroke)"
              fontFamily="sans-serif"
              fontSize="24"
              fontWeight="bold"
            >
              ?
            </text>
          </g>
        }
      />

      {/* 5. cUSDC (Lower Left) */}
      <Cube
        cx={cusdcNode.cx}
        cy={cusdcNode.cy}
        a={cusdcNode.a}
        label="CUSDC"
        id="cube-cusdc"
        topIcon={
          <g>
            <circle
              cx="0"
              cy="0"
              r="14"
              fill="var(--illo-fill-t)"
              stroke="var(--illo-stroke)"
              strokeWidth="1.5"
            />
            <text
              x="0"
              y="5"
              textAnchor="middle"
              fill="var(--illo-stroke)"
              fontFamily="sans-serif"
              fontSize="14"
              fontWeight="bold"
            >
              $
            </text>
          </g>
        }
      />

      {/* 6. ATTESTATION (Lower Right) */}
      <Cube
        cx={attestationNode.cx}
        cy={attestationNode.cy}
        a={attestationNode.a}
        label="ATTESTATION"
        id="cube-attestation"
        topIcon={
          <g>
            <polygon
              points="0,-16 5,-11 11,-11 11,-5 16,0 11,5 11,11 5,11 0,16 -5,11 -11,11 -11,5 -16,0 -11,-5 -11,-11 -5,-11"
              fill="var(--illo-fill-t)"
              stroke="var(--illo-stroke)"
              strokeWidth="1.5"
              strokeLinejoin="round"
            />
            <circle cx="0" cy="0" r="7" fill="none" stroke="var(--illo-stroke)" strokeWidth="1.5" />
          </g>
        }
      />

      {/* THE REDACTION BAR (Visual Hook overlay on BET label) */}
      <rect
        x={betNode.cx - 27}
        y={betNode.cy + betNode.a + 6}
        width="54"
        height="12"
        fill="var(--redaction)"
        transform={`rotate(-2, ${betNode.cx}, ${betNode.cy + betNode.a + 12})`}
      />
    </svg>
  );
}

export function Hero(): React.ReactElement {
  return (
    <section className="hero">
      <div className="hero-strip">
        <div className="left">
          <span className="brand">
            <span className="crest">D◆</span>
            Dark
            <svg
              width="12"
              height="4"
              viewBox="0 0 12 4"
              style={{display: "inline-block", verticalAlign: "middle", margin: "0 4px"}}
              aria-hidden="true"
            >
              <rect width="12" height="4" fill="var(--redaction)" stroke="var(--fg)" strokeWidth="0.5" />
            </svg>
            <em>Odds</em>
          </span>
          <span>
            <span className="dot" /> CLASSIFIED · INTERNAL
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
            A privacy-permissionless prediction market — anyone deploys, anyone bets, odds are public, bet
            sizes encrypted. Built on iExec Nox + Arbitrum. Selective-disclosure payouts you can show your
            accountant — or keep sealed forever.
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
                <span
                  className="redact-bar"
                  aria-label="redacted"
                  style={{height: "14px", width: "80px", border: "0.5px solid var(--ink)"}}
                />
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

            <ProtocolArchitecture />

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
