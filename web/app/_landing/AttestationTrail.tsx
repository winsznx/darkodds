import Link from "next/link";

/**
 * Section 6 / 9 — Attestation Trail (Selective-Disclosure).
 * Translated from sec6 in hero.html. 60/40 split — three numbered steps
 * left, sample JSON attestation card right with a redaction bar inside the
 * payout string.
 */
export function AttestationTrail(): React.ReactElement {
  return (
    <section className="sec6" data-screen-label="06 Attestation Trail">
      <div className="sec6-head">
        <span className="stamp stamp--ink" style={{transform: "rotate(-1deg)", alignSelf: "flex-start"}}>
          EXHIBIT D // SELECTIVE-DISCLOSURE
        </span>
        <h2 className="sec6-h">
          Show your accountant.
          <br />
          Or <em>don&apos;t</em>.
        </h2>
        <p className="sec6-sub">
          After you claim, generate a TEE-signed attestation. Recipient-bound by default — only the address
          you specify can verify it. Bearer mode is explicit opt-in. Markets stay permissionless; disclosure
          stays selective.
        </p>
      </div>

      <div className="att-grid">
        {/* LEFT — three steps */}
        <div className="l">
          <div className="att-row">
            <div className="att-step-num">STEP 01</div>
            <h3 className="att-step-title">Sign.</h3>
            <p className="att-step-body">
              After your claim, the TEE handler signs an attestation containing: your address, market ID,
              outcome, payout amount, optional recipient, nonce, and TDX measurement. All inside the enclave,
              signed by the measurement-bound key.
            </p>
          </div>
          <div className="att-row">
            <div className="att-step-num">STEP 02</div>
            <h3 className="att-step-title">Download.</h3>
            <p className="att-step-body">
              Click &ldquo;Generate audit attestation&rdquo; on /portfolio. JSON file downloads —
              recipient-bound to whomever you specify. Recipient is permanent in the signed payload —
              re-sharing breaks the signature.
            </p>
          </div>
          <div className="att-row">
            <div className="att-step-num">STEP 03</div>
            <h3 className="att-step-title">Verify.</h3>
            <p className="att-step-body">
              Recipient pastes the JSON into /audit. ClaimVerifier on chain checks the TDX measurement matches
              our pinned anchor and the signer matches the deployed attestation key. Returns VALID or INVALID.
              Read-only.
            </p>
          </div>
        </div>

        {/* RIGHT — sample attestation */}
        <div className="r">
          <span className="stamp stamp--red att-sample-stamp" style={{transform: "rotate(-1.5deg)"}}>
            ATTESTATION // SAMPLE
          </span>
          <pre className="att-json">
            <span className="c">{"// signed inside enclave"}</span>
            {"\n{\n  "}
            <span className="k">{'"version"'}</span>
            {":         "}
            <span className="s">{'"1.0"'}</span>
            {",\n  "}
            <span className="k">{'"user"'}</span>
            {":            "}
            <span className="s">{'"0xF979…1ab5"'}</span>
            {",\n  "}
            <span className="k">{'"marketId"'}</span>
            {":        14,\n  "}
            <span className="k">{'"marketQuestion"'}</span>
            {":  "}
            <span className="s">{'"Will BTC close'}</span>
            {"\n                     "}
            <span className="s">{"above $100,000 by"}</span>
            {"\n                     "}
            <span className="s">{'end of 2026?"'}</span>
            {",\n  "}
            <span className="k">{'"outcome"'}</span>
            {":         "}
            <span className="s">{'"NO"'}</span>
            {",\n  "}
            <span className="k">{'"payoutAmount"'}</span>
            {":    "}
            <span className="s">{'"'}</span>
            <span className="rbar" />
            <span className="s">{' cUSDC"'}</span>
            {",\n  "}
            <span className="k">{'"recipient"'}</span>
            {":       "}
            <span className="s">{'"0xACCOUNTANT…"'}</span>
            {",\n  "}
            <span className="k">{'"nonce"'}</span>
            {":           "}
            <span className="s">{'"0x…"'}</span>
            {",\n  "}
            <span className="k">{'"tdxMeasurement"'}</span>
            {":  "}
            <span className="s">{'"0x…"'}</span>
            {",\n  "}
            <span className="k">{'"signature"'}</span>
            {":       "}
            <span className="s">{'"0x…"'}</span>
            {"\n}"}
          </pre>
          <p className="att-note">
            Display note: the JSON contains plaintext. The redaction bar reinforces that the payout was
            confidential before disclosure — not after.
          </p>
        </div>
      </div>

      <div className="sec6-foot">
        <div className="pl">COMPLIANCE</div>
        <div className="pm">without surveillance.</div>
        <Link href="/audit" className="pr">
          TRY VERIFY&nbsp;&nbsp;→
        </Link>
      </div>

      <div className="sec6-pageno">06 / 09</div>
    </section>
  );
}
