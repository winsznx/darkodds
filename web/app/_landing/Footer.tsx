import Link from "next/link";

/**
 * Section 8 / 9 — Closing footer (END OF DOSSIER · 09/09).
 * Translated from sec8 in hero.html. Three columns: Protocol/Governance ·
 * External links · Italic statement + byline. Ends with "END OF DOSSIER ·
 * 09/09" between two ink hairlines.
 */
const SAFE_URL = "https://app.safe.global/?safe=arb-sep:0x042a49628f8A107C476B01bE8edEbB38110FA332";

export function Footer(): React.ReactElement {
  return (
    <section className="sec8" data-screen-label="08 Footer">
      <div className="sec8-top-stamp-wrap">
        <span className="stamp stamp--ink" style={{transform: "rotate(-1deg)"}}>
          DARKODDS // CASE FILE CLOSED
        </span>
      </div>
      <div className="sec8-top-rule" />

      <div className="sec8-cols">
        {/* LEFT — IDENTIFIERS */}
        <div className="sec8-col">
          <div className="sec8-block">
            <div className="sec8-label">PROTOCOL</div>
            <ul className="sec8-list">
              <li>DarkOdds v1</li>
              <li>
                Arbitrum Sepolia <span className="k">(chainId 421614)</span>
              </li>
              <li>Built on iExec Nox</li>
              <li>
                <Link href="/create">Create your own →</Link>
              </li>
            </ul>
          </div>
          <div className="sec8-block">
            <div className="sec8-label">GOVERNANCE</div>
            <ul className="sec8-list">
              <li>
                Safe (2-of-3): <span className="k">0x042a…A332</span>{" "}
                <span className="k">(multisig hardening preserved)</span>
              </li>
              <li>
                Threshold: <span className="k">2 of 3</span>
              </li>
              <li>
                Current state: <span className="k">see topbar badge</span>
              </li>
            </ul>
          </div>
        </div>

        {/* MIDDLE — EXTERNAL */}
        <div className="sec8-col">
          <div className="sec8-block">
            <div className="sec8-label">EXTERNAL</div>
            <ul className="sec8-list">
              <li>
                <span className="k">GitHub:&nbsp;</span>
                <a href="https://github.com/winsznx/darkodds" target="_blank" rel="noopener noreferrer">
                  github.com/winsznx/darkodds
                </a>
              </li>
              <li>
                <span className="k">Arbiscan:&nbsp;</span>
                <a href="https://sepolia.arbiscan.io" target="_blank" rel="noopener noreferrer">
                  sepolia.arbiscan.io
                </a>
              </li>
              <li>
                <span className="k">Safe UI:&nbsp;</span>
                <a href={SAFE_URL} target="_blank" rel="noopener noreferrer">
                  app.safe.global/…
                </a>
              </li>
              <li>
                <span className="k">iExec Nox:&nbsp;</span>
                <a href="https://docs.iex.ec" target="_blank" rel="noopener noreferrer">
                  docs.iex.ec
                </a>
              </li>
              <li>
                <span className="k">Contracts:&nbsp;</span>
                <a
                  href="https://github.com/winsznx/darkodds/blob/main/KNOWN_LIMITATIONS.md"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  KNOWN_LIMITATIONS.md
                </a>
              </li>
            </ul>
          </div>
          <div className="sec8-block">
            <div className="sec8-label">LEGAL</div>
            <ul className="sec8-list">
              <li>
                <Link href="/privacy">Privacy</Link>
              </li>
              <li>
                <Link href="/terms">Terms</Link>
              </li>
              <li>
                <Link href="/disclaimer">Disclaimer</Link>
              </li>
            </ul>
          </div>
        </div>

        {/* RIGHT — STATEMENT */}
        <div className="sec8-col">
          <p className="sec8-statement">
            &ldquo;Privacy permissionless prediction markets. Built for the iExec Vibe Coding Challenge ×
            ChainGPT. Live on Arbitrum Sepolia.&rdquo;
          </p>
          <p className="sec8-byline">Built by Tim. Submission: April 28, 2026.</p>
        </div>
      </div>

      <div className="sec8-bottom-rule" />
      <div className="sec8-end">
        END OF DOSSIER<span className="dot">·</span>09 / 09
      </div>
    </section>
  );
}
