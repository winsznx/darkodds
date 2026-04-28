/**
 * Section 4 / 9 — Stack & Standards.
 * Translated from sec4 in hero.html. Two appendix blocks: A.1 the technology
 * stack table, A.2 the standards stance with four cards. The OPEN-CREATE
 * card was added in the post-F10b reframe.
 */
export function StackStandards(): React.ReactElement {
  return (
    <section className="sec4" data-screen-label="04 Stack and Standards">
      <div className="sec4-head">
        <span className="stamp stamp--ink" style={{transform: "rotate(-1deg)", alignSelf: "flex-start"}}>
          APPENDIX A // STACK & STANDARDS
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
          <div className="stack-row">
            <div className="stack-role">Confidential Compute</div>
            <div className="stack-name">iExec Nox</div>
            <div className="stack-desc">
              Intel TDX TEE on Arbitrum, ERC-7984 substrate, on-chain handle ACL.
            </div>
          </div>
          <div className="stack-row">
            <div className="stack-role">Settlement Layer</div>
            <div className="stack-name">Arbitrum Sepolia</div>
            <div className="stack-desc">
              L2 with Chainlink integration path for production oracle resolution.
            </div>
          </div>
          <div className="stack-row">
            <div className="stack-role">Smart Contract Tooling</div>
            <div className="stack-name">ChainGPT Auditor</div>
            <div className="stack-desc">
              LLM-pattern audit pass on all 10 contracts. Findings filed in KNOWN_LIMITATIONS.
            </div>
          </div>
          <div className="stack-row">
            <div className="stack-role">Wallet</div>
            <div className="stack-name">Privy</div>
            <div className="stack-desc">
              Email + social login, embedded wallet, no seed-phrase friction at onboarding.
            </div>
          </div>
        </div>

        <p className="stack-foot">
          Static analysis: Slither 0.11.5 (clean). Audited contracts: 10. Multisig governance: 2-of-3 Safe.
          Tests: 178/180.
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
                DarkOdds applies the iExec Vibe Coding Challenge thesis — privacy-preserving financial
                primitives with compliance and confidentiality — to permissionless prediction markets.
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
            <div className="scard">
              <div className="row1">ERC-7984</div>
              <div className="row2">
                <span className="sq fill" />
                IMPLEMENTED
              </div>
              <div className="row3">Confidential ERC-20 wire-shape via Nox-native cUSDC.</div>
            </div>
            <div className="scard">
              <div className="row1">OPEN-CREATE</div>
              <div className="row2">
                <span className="sq fill" />
                IMPLEMENTED
              </div>
              <div className="row3">
                Anyone can deploy markets via /create. ChainGPT structures the prompt; the protocol settles.
              </div>
            </div>
            <div className="scard">
              <div className="row1">ERC-3643</div>
              <div className="row2">
                <span className="sq empty" />
                OUT OF SCOPE
              </div>
              <div className="row3">
                Permissioned RWA tokens. Doesn&apos;t fit prediction-market primitive.
              </div>
            </div>
            <div className="scard">
              <div className="row1">ERC-7540</div>
              <div className="row2">
                <span className="sq empty" />
                OUT OF SCOPE
              </div>
              <div className="row3">Async tokenized vaults. Different domain.</div>
            </div>
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
