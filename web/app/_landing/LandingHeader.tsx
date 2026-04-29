import {ThemeToggle} from "./ThemeToggle";

/**
 * Sticky landing header lifted out of the Hero section so position:sticky
 * follows the user the entire scroll instead of releasing once the hero box
 * exits the viewport. Matches the dashboard topbar pattern: 2px ink border
 * top, 1px hairline bottom, no shadow.
 */
export function LandingHeader(): React.ReactElement {
  return (
    <div className="landing-header">
      <div className="left">
        <span className="brand">
          <span className="crest">D◆</span>
          Dark<em>Odds</em>
        </span>
        <span>
          <span className="dot" />
          CLASSIFIED · INTERNAL
        </span>
        <span>FILE NO. DK-0426 / Δ</span>
      </div>
      <div className="right">
        <span>iEXEC NOX · ARBITRUM</span>
        <ThemeToggle />
      </div>
    </div>
  );
}
