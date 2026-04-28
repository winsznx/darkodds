/**
 * Section 7 / 9 — FAQ.
 * Translated from sec7 in hero.html. Seven Q rows divided by hairlines.
 * READ THE CODE band → GitHub.
 */
export function FAQ(): React.ReactElement {
  return (
    <section className="sec7" data-screen-label="07 FAQ">
      <div className="sec7-head">
        <span className="stamp stamp--ink" style={{transform: "rotate(-1deg)", alignSelf: "flex-start"}}>
          EXHIBIT E // FREQUENTLY ASKED
        </span>
        <h2 className="sec7-h">Questions worth asking.</h2>
        <p className="sec7-sub">From people who didn&apos;t read the contracts.</p>
      </div>

      <div className="faq-list">
        <div className="faq-item">
          <div className="faq-num">Q / 01</div>
          <div className="faq-body">
            <h3 className="faq-q">What&apos;s hidden? What&apos;s public?</h3>
            <p className="faq-a">
              <strong>Public:</strong> outcomes, odds, market addresses, transaction hashes, bettor counts,
              and pool totals (after each 60-second batch publish). <strong>Hidden:</strong> your individual
              bet size, your wallet&apos;s encrypted balance, and your payout amount — until you choose to
              disclose it.
            </p>
          </div>
        </div>

        <div className="faq-item">
          <div className="faq-num">Q / 02</div>
          <div className="faq-body">
            <h3 className="faq-q">Who can create a market on DarkOdds?</h3>
            <p className="faq-a">
              Anyone, during the open-create window. Connect a wallet, click <code>/create</code>, describe
              your market in plain English, ChainGPT structures the parameters, deploy on-chain.
              Permissionless by design — the governance state badge in the topbar shows the current mode
              (open-create vs governance-curated). Both are legitimate protocol modes.
            </p>
          </div>
        </div>

        <div className="faq-item">
          <div className="faq-num">Q / 03</div>
          <div className="faq-body">
            <h3 className="faq-q">How does the privacy actually work?</h3>
            <p className="faq-a">
              Bets are encrypted handles on iExec Nox (Intel TDX TEE on Arbitrum). The TEE decrypts inside the
              enclave to compute proportional payouts, then re-encrypts the result. FHE-equivalent privacy
              guarantee, TEE attestation trust model, proportional pari-mutuel actually works (FHE division is
              brutal — TEE plaintext compute is the wedge).
            </p>
          </div>
        </div>

        <div className="faq-item">
          <div className="faq-num">Q / 04</div>
          <div className="faq-body">
            <h3 className="faq-q">Is this just Polymarket with a redaction bar?</h3>
            <p className="faq-a">
              Polymarket is fully public AND curated. DarkOdds is private AND permissionless. Two axes,
              opposite stances. Same odds and outcomes, your wager hidden, anyone can deploy a new market.
            </p>
          </div>
        </div>

        <div className="faq-item">
          <div className="faq-num">Q / 05</div>
          <div className="faq-body">
            <h3 className="faq-q">What about resolution? Can the admin cheat?</h3>
            <p className="faq-a">
              Three oracle adapters: <code>AdminOracle</code> (commit-reveal multisig),{" "}
              <code>ChainlinkPriceOracle</code> (with mandatory L2 sequencer uptime check), and{" "}
              <code>PreResolvedOracle</code> (markets resolved before deployment). Resolution flows through
              whichever adapter the market is wired to. Two independent audits — ChainGPT (LLM
              pattern-matched) and Slither (dataflow). All HIGH findings remediated. Reports in{" "}
              <code>KNOWN_LIMITATIONS.md</code>.
            </p>
          </div>
        </div>

        <div className="faq-item">
          <div className="faq-num">Q / 06</div>
          <div className="faq-body">
            <h3 className="faq-q">Permissionless markets sound risky. What about duplicates?</h3>
            <p className="faq-a">
              Yes — anyone can deploy &ldquo;Will Arsenal win the Premier League?&rdquo; multiple times.
              Markets self-correct: liquidity flows to the most-trusted one. Centralized platforms avoid
              duplicates by fiat but miss the experimentation. Permissionless-with-emergent-coordination beats
              permissioned-by-fiat over time.
            </p>
          </div>
        </div>

        <div className="faq-item">
          <div className="faq-num">Q / 07</div>
          <div className="faq-body">
            <h3 className="faq-q">Is this audited?</h3>
            <p className="faq-a">
              Yes — by two independent sources. 178/180 Foundry tests pass. ChainGPT Smart Contract Auditor on
              all 10 contracts (refresh dated April 28, 2026). Slither static analysis clean. All HIGH
              findings remediated. Multisig governance via 2-of-3 Safe (architecturally preserved through
              operational delegation for the open-create window). Reports in <code>KNOWN_LIMITATIONS.md</code>{" "}
              and <code>contracts/audits/</code>.
            </p>
          </div>
        </div>
      </div>

      <div className="sec7-foot">
        <div className="pl">ANSWERS</div>
        <div className="pm">honestly given.</div>
        <a
          href="https://github.com/winsznx/darkodds"
          className="pr"
          target="_blank"
          rel="noopener noreferrer"
        >
          READ THE CODE&nbsp;&nbsp;→
        </a>
      </div>

      <div className="sec7-pageno">07 / 09</div>
    </section>
  );
}
