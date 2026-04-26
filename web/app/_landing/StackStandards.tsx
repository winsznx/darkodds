/**
 * Section 4 — Stack & Standards.
 *
 * Two appendix blocks: technology stack table + standards stance.
 * Numbers are real from the F4.5/F5/F5-followup phases. Stack-foot reflects
 * actual project state (Slither 0.11.5, 10 contracts, Safe 2-of-3, 159/159).
 */

type StackRow = {role: string; name: string; desc: string};

const stackRows: StackRow[] = [
  {
    role: "Confidential Compute",
    name: "iExec Nox",
    desc: "Intel TDX TEE on Arbitrum, ERC-7984 substrate, on-chain handle ACL.",
  },
  {
    role: "Settlement Layer",
    name: "Arbitrum Sepolia",
    desc: "L2 with Chainlink integration path for production oracle resolution.",
  },
  {
    role: "Smart Contract Tooling",
    name: "ChainGPT Auditor",
    desc: "LLM-pattern audit pass on all 10 contracts. Findings filed in KNOWN_LIMITATIONS.",
  },
  {
    role: "Wallet",
    name: "Privy",
    desc: "Email + social login, embedded wallet, no seed-phrase friction at onboarding.",
  },
];

type StandardCard = {erc: string; status: "IMPLEMENTED" | "OUT OF SCOPE"; desc: string};

const standardCards: StandardCard[] = [
  {erc: "ERC-7984", status: "IMPLEMENTED", desc: "Confidential ERC-20 wire-shape via Nox-native cUSDC."},
  {
    erc: "ERC-3643",
    status: "OUT OF SCOPE",
    desc: "Permissioned RWA tokens. Doesn't fit prediction-market primitive.",
  },
  {erc: "ERC-7540", status: "OUT OF SCOPE", desc: "Async tokenized vaults. Different domain."},
];

export function StackStandards(): React.ReactElement {
  return (
    <section className="sec4" data-screen-label="04 Stack and Standards">
      <div className="sec4-head">
        <span className="stamp stamp--ink" style={{transform: "rotate(-1deg)", alignSelf: "flex-start"}}>
          APPENDIX A // STACK &amp; STANDARDS
        </span>
        <h2 className="sec4-h">
          Built on substrate.
          <br />
          Not <em>vibes</em>.
        </h2>
        <p className="sec4-sub">
          The thesis of the iExec Vibe Coding Challenge applied to prediction markets — privacy-preserving
          financial primitives where compliance and confidentiality coexist. Below, the substrate this is
          built on, and the standards stance.
        </p>
      </div>

      {/* 4A — TECHNOLOGY STACK */}
      <div className="ap-block">
        <div className="ap-label">APPENDIX A.1 — TECHNOLOGY STACK</div>
        <div className="stack-tbl">
          {stackRows.map((row) => (
            <div key={row.role} className="stack-row">
              <div className="stack-role">{row.role}</div>
              <div className="stack-name">{row.name}</div>
              <div className="stack-desc">{row.desc}</div>
            </div>
          ))}
        </div>
        <p className="stack-foot">
          Static analysis: Slither 0.11.5 (clean). Audited contracts: 10. Multisig governance: 2-of-3 Safe.
          Tests: 159/159.
        </p>
      </div>

      {/* 4B — STANDARDS STANCE */}
      <div className="ap-block">
        <div className="ap-label">APPENDIX A.2 — STANDARDS STANCE</div>
        <div className="stance">
          <div className="stance-l">
            <h3 className="stance-h">A deliberate scope call.</h3>
            <div className="stance-body">
              <p>
                DarkOdds applies the iExec Vibe Coding Challenge&apos;s Confidential DeFi &amp; RWA thesis —
                privacy-preserving financial primitives with compliance and confidentiality — to prediction
                markets.
              </p>
              <p>
                ERC-7984 is implemented in full, function-shape compliant via a Nox-native ConfidentialUSDC.
                ERC-3643 (permissioned RWA tokens) and ERC-7540 (async vaults) don&apos;t fit a
                prediction-market primitive natively; forcing them in would be checkbox-cargo, not
                engineering.
              </p>
              <p>
                Selective-disclosure attestations provide the compliance surface the track calls for, in the
                shape that matches our domain. Confidentiality without opacity. Compliance without
                surveillance.
              </p>
            </div>
          </div>

          <div className="stance-r">
            {standardCards.map((card) => (
              <div key={card.erc} className="scard">
                <div className="row1">{card.erc}</div>
                <div className="row2">
                  <span className={`sq ${card.status === "IMPLEMENTED" ? "fill" : "empty"}`} />
                  {card.status}
                </div>
                <div className="row3">{card.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="sec4-foot">
        <div className="pl">POSITION</div>
        <div className="pm">we built what fits.</div>
        <div className="pr">NOT WHAT CHECKS BOXES.</div>
      </div>

      <div className="sec4-pageno">04 / 09</div>
    </section>
  );
}
