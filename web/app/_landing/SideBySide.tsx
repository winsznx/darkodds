/**
 * Section 2 / 9 — Same market. Seen two ways.
 * Translated from the design handoff (sec2 in hero.html). The two columns
 * deliberately mirror each other in structure — the only differences are
 * the dollar amounts vs. redaction bars in the activity feed and the
 * CURATED CREATION / OPEN-CREATE axis labels per the post-F10b reframe.
 */
export function SideBySide(): React.ReactElement {
  return (
    <section className="sec2" data-screen-label="02 Side by Side">
      <div className="sec2-head">
        <span className="stamp stamp--red sec2-stamp" style={{transform: "rotate(-1deg)"}}>
          EXHIBIT B // SIDE-BY-SIDE COMPARISON
        </span>
        <h2 className="sec2-h">
          Same market.
          <br />
          Seen <em>two ways</em>.
        </h2>
        <p className="sec2-sub">
          The same question. The same odds. The same outcome. The only difference is who can see your wager.
        </p>
      </div>

      <div className="compare">
        {/* LEFT — Polymarket */}
        <div className="col">
          <span className="stamp stamp--ink case-stamp" style={{transform: "rotate(-1deg)"}}>
            PUBLIC LEDGER // POLYMARKET
          </span>
          <div className="col-axis">CURATED CREATION</div>

          <h3 className="case-h">Bet size: visible to anyone.</h3>

          <p className="case-q">Will Bitcoin close above $100,000 by December 31, 2026?</p>

          <div className="compare-oddsbar">
            <div className="yes">
              <span>YES&nbsp;&nbsp;67%</span>
            </div>
            <div className="no">
              <span>NO&nbsp;&nbsp;33%</span>
            </div>
          </div>

          <div className="feed">
            <div className="fr">
              <span className="addr">0xa7f3…4d21</span>
              <span className="side">YES</span>
              <span className="amt">$48,500.00</span>
            </div>
            <div className="fr">
              <span className="addr">0xb44e…9c11</span>
              <span className="side">NO</span>
              <span className="amt">$12,750.00</span>
            </div>
            <div className="fr">
              <span className="addr">0xc081…ee93</span>
              <span className="side">YES</span>
              <span className="amt">$7,820.00</span>
            </div>
            <div className="fr">
              <span className="addr">0xd5d2…0a55</span>
              <span className="side">NO</span>
              <span className="amt">$34,000.00</span>
            </div>
          </div>

          <p className="feed-source">Source: gamma-api.polymarket.com — public, real-time.</p>
        </div>

        {/* RIGHT — DarkOdds */}
        <div className="col">
          <span className="stamp stamp--red case-stamp" style={{transform: "rotate(-1deg)"}}>
            CLASSIFIED // DARKODDS
          </span>
          <div className="col-axis col-axis--amber">OPEN-CREATE</div>

          <h3 className="case-h">Bet size: visible only to you.</h3>

          <p className="case-q">Will Bitcoin close above $100,000 by December 31, 2026?</p>

          <div className="compare-oddsbar">
            <div className="yes">
              <span>YES&nbsp;&nbsp;67%</span>
            </div>
            <div className="no">
              <span>NO&nbsp;&nbsp;33%</span>
            </div>
          </div>

          <div className="feed">
            <div className="fr">
              <span className="addr">0xa7f3…4d21</span>
              <span className="side">YES</span>
              <span className="amt">
                <span className="rbar" style={{width: 96}} />
              </span>
            </div>
            <div className="fr">
              <span className="addr">0xb44e…9c11</span>
              <span className="side">NO</span>
              <span className="amt">
                <span className="rbar" style={{width: 78}} />
              </span>
            </div>
            <div className="fr">
              <span className="addr">0xc081…ee93</span>
              <span className="side">YES</span>
              <span className="amt">
                <span className="rbar" style={{width: 64}} />
              </span>
            </div>
            <div className="fr">
              <span className="addr">0xd5d2…0a55</span>
              <span className="side">NO</span>
              <span className="amt">
                <span className="rbar" style={{width: 88}} />
              </span>
            </div>
          </div>

          <p className="feed-source">Source: encrypted on iExec Nox — visible only to the bettor.</p>
        </div>
      </div>

      <div className="compare-foot">
        <div className="pl">THE DIFFERENCE</div>
        <div className="pm">your wager AND who can create.</div>
        <div className="pr">BOTH MATTER</div>
      </div>

      <div className="sec2-pageno">02 / 09</div>
    </section>
  );
}
