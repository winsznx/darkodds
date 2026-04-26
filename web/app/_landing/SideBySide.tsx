/**
 * Section 2 — "Same market. Seen two ways."
 *
 * Side-by-side rhetorical comparison: Polymarket-style public ledger vs.
 * DarkOdds redacted ledger. The "EXHIBIT B" stamp signals this is an
 * illustrative comparison, not a live data integration. Activity-feed addresses
 * and amounts are placeholders chosen for the visual argument; we don't pull a
 * real Polymarket feed and don't pretend to.
 */

type FeedRow = {addr: string; side: "YES" | "NO"; amount: string; rbarPx?: number};

const polymarketFeed: FeedRow[] = [
  {addr: "0xa7f3…4d21", side: "YES", amount: "$48,500.00"},
  {addr: "0xb44e…9c11", side: "NO", amount: "$12,750.00"},
  {addr: "0xc081…ee93", side: "YES", amount: "$7,820.00"},
  {addr: "0xd5d2…0a55", side: "NO", amount: "$34,000.00"},
];

const darkoddsFeed: FeedRow[] = [
  {addr: "0xa7f3…4d21", side: "YES", amount: "", rbarPx: 96},
  {addr: "0xb44e…9c11", side: "NO", amount: "", rbarPx: 78},
  {addr: "0xc081…ee93", side: "YES", amount: "", rbarPx: 64},
  {addr: "0xd5d2…0a55", side: "NO", amount: "", rbarPx: 88},
];

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
        {/* Polymarket — public ledger */}
        <div className="col">
          <span className="stamp stamp--ink case-stamp" style={{transform: "rotate(-1deg)"}}>
            PUBLIC LEDGER // POLYMARKET
          </span>
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
            {polymarketFeed.map((row) => (
              <div key={row.addr} className="fr">
                <span className="addr">{row.addr}</span>
                <span className="side">{row.side}</span>
                <span className="amt">{row.amount}</span>
              </div>
            ))}
          </div>

          <p className="feed-source">Illustrative — Polymarket-style public ledger.</p>
        </div>

        {/* DarkOdds — redacted */}
        <div className="col">
          <span className="stamp stamp--red case-stamp" style={{transform: "rotate(-1deg)"}}>
            CLASSIFIED // DARKODDS
          </span>
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
            {darkoddsFeed.map((row) => (
              <div key={row.addr} className="fr">
                <span className="addr">{row.addr}</span>
                <span className="side">{row.side}</span>
                <span className="amt">
                  <span className="rbar" style={{width: `${row.rbarPx}px`}} />
                </span>
              </div>
            ))}
          </div>

          <p className="feed-source">Encrypted on iExec Nox — visible only to the bettor.</p>
        </div>
      </div>

      <div className="compare-foot">
        <div className="pl">DIFFERENCE</div>
        <div className="pm">who can see your wager.</div>
        <div className="pr">ONLY THAT.</div>
      </div>

      <div className="sec2-pageno">02 / 09</div>
    </section>
  );
}
