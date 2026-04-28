import Link from "next/link";

/**
 * Section 5 / 9 — Live markets. Real bets. Right now.
 * Translated from sec5 in hero.html. Three case-file cards reference real
 * deployed market ids (#14, #15, #19). Card #19 carries the OPEN-CREATE
 * subline since it was sponsored-deployed during F10b verify.
 */
export function LiveMarkets(): React.ReactElement {
  return (
    <section className="sec5" data-screen-label="05 Live Markets">
      <div className="sec5-head">
        <span className="stamp stamp--ink" style={{transform: "rotate(-1deg)", alignSelf: "flex-start"}}>
          EXHIBIT C // ACTIVE CASE FILES
        </span>
        <h2 className="sec5-h">
          Live markets.
          <br />
          Real bets. <em>Right now.</em>
        </h2>
        <p className="sec5-sub">
          Three operational case files. Real markets, real cUSDC, real Arbitrum Sepolia. Bet sizes are
          encrypted on Nox. Outcomes resolve via on-chain oracle adapters. Anyone can create more.
        </p>
      </div>

      <div className="cases-wrap">
        <div className="cases">
          {/* CASE FILE 14 */}
          <div className="case">
            <div className="case-meta">
              <span>CASE FILE 14</span>
              <span className="sep">·</span>
              <span className="open">OPEN</span>
              <span className="sep">·</span>
              <span>iEXEC NOX</span>
            </div>
            <h3 className="case-q">Will BTC close above $100,000 by end of 2026?</h3>

            <div className="case-odds">
              <div className="yes" style={{flexBasis: "50%"}}>
                <span>YES&nbsp;&nbsp;50%</span>
              </div>
              <div className="no" style={{flexBasis: "50%"}}>
                <span>NO&nbsp;&nbsp;50%</span>
              </div>
            </div>

            <div className="case-row">
              <span className="k">Pool Total</span>
              <span className="v">
                <span className="rbar" style={{width: 96}} />
                &nbsp;cUSDC
              </span>
            </div>
            <div className="case-row">
              <span className="k">Bettors</span>
              <span className="v">1</span>
            </div>
            <div className="case-row">
              <span className="k">Resolves By</span>
              <span className="v date">Dec 31, 2026</span>
            </div>

            <Link href="/markets/14" className="case-cta">
              VIEW &amp; BET&nbsp;&nbsp;→
            </Link>
          </div>

          {/* CASE FILE 15 */}
          <div className="case">
            <div className="case-meta">
              <span>CASE FILE 15</span>
              <span className="sep">·</span>
              <span className="open">OPEN</span>
              <span className="sep">·</span>
              <span>iEXEC NOX</span>
            </div>
            <h3 className="case-q">Will the next iExec mainnet announcement happen before June 15, 2026?</h3>

            <div className="case-odds">
              <div className="yes" style={{flexBasis: "58%"}}>
                <span>YES&nbsp;&nbsp;58%</span>
              </div>
              <div className="no" style={{flexBasis: "42%"}}>
                <span>NO&nbsp;&nbsp;42%</span>
              </div>
            </div>

            <div className="case-row">
              <span className="k">Pool Total</span>
              <span className="v">
                <span className="rbar" style={{width: 64}} />
                &nbsp;cUSDC
              </span>
            </div>
            <div className="case-row">
              <span className="k">Bettors</span>
              <span className="v">4</span>
            </div>
            <div className="case-row">
              <span className="k">Resolves By</span>
              <span className="v date">Jun 15, 2026</span>
            </div>

            <Link href="/markets/15" className="case-cta">
              VIEW &amp; BET&nbsp;&nbsp;→
            </Link>
          </div>

          {/* CASE FILE 19 */}
          <div className="case">
            <div className="case-meta">
              <span>CASE FILE 19</span>
              <span className="sep">·</span>
              <span className="open">OPEN</span>
              <span className="sep">·</span>
              <span>iEXEC NOX</span>
            </div>
            <div className="case-subline">OPEN-CREATE · SPONSORED</div>
            <h3 className="case-q">Will F10b verification ship clean by April 28?</h3>

            <div className="case-odds">
              <div className="yes" style={{flexBasis: "100%"}}>
                <span>YES&nbsp;&nbsp;100%</span>
              </div>
              <div className="no" style={{flexBasis: "0%"}}>
                <span>NO&nbsp;&nbsp;0%</span>
              </div>
            </div>

            <div className="case-row">
              <span className="k">Pool Total</span>
              <span className="v">
                <span className="rbar" style={{width: 80}} />
                &nbsp;cUSDC
              </span>
            </div>
            <div className="case-row">
              <span className="k">Bettors</span>
              <span className="v">1</span>
            </div>
            <div className="case-row">
              <span className="k">Resolves By</span>
              <span className="v date">Apr 29, 2026</span>
            </div>

            <Link href="/markets/19" className="case-cta">
              VIEW &amp; BET&nbsp;&nbsp;→
            </Link>
          </div>
        </div>

        <div className="sec5-foot">
          <div className="pl">STATUS</div>
          <div className="pm">the contracts are live. so are the markets.</div>
          <Link href="/markets" className="pr">
            VIEW ALL&nbsp;&nbsp;→
          </Link>
        </div>
      </div>

      <div className="sec5-pageno">05 / 09</div>
    </section>
  );
}
