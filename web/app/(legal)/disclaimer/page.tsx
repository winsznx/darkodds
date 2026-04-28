import Link from "next/link";

export const metadata = {
  title: "Disclaimer — DarkOdds",
  description: "Risk disclaimer for the DarkOdds testnet hackathon submission.",
};

export default function DisclaimerPage(): React.ReactElement {
  return (
    <article>
      <p className="updated">Last updated: April 28, 2026</p>
      <h1>Disclaimer</h1>

      <p>
        DarkOdds is a hackathon submission built for the iExec Vibe Coding Challenge × ChainGPT. It is not a
        regulated financial product. It is not an exchange, broker-dealer, futures commission merchant,
        designated contract market, or money services business. It is a research artifact deployed to a public
        testnet to demonstrate privacy-permissionless prediction markets.
      </p>

      <h2>Not investment advice</h2>
      <p>
        Nothing on this site, in the contracts, in the documentation, or in the attestations is investment
        advice, financial advice, trading advice, or a solicitation to buy or sell any security, derivative,
        swap, commodity interest, or other financial instrument. The odds, probabilities, and resolution
        outcomes shown are protocol output, not predictions of fact and not guidance to act on.
      </p>

      <h2>Not available where local law restricts prediction markets</h2>
      <p>
        Prediction markets and event contracts are restricted, regulated, or prohibited in many jurisdictions.
        Users are solely responsible for verifying that their interaction with DarkOdds complies with the laws
        of their place of residence, citizenship, and access.
      </p>

      <p>Examples of restricted contexts include, without limitation:</p>
      <ul>
        <li>
          The United States, where event contracts and binary-option-style prediction markets fall under CFTC
          jurisdiction and have been the subject of enforcement action against unlicensed operators.
        </li>
        <li>
          Sanctioned jurisdictions and parties listed by the U.S. Office of Foreign Assets Control (OFAC), or
          by equivalent authorities in the user&apos;s jurisdiction.
        </li>
        <li>
          Any jurisdiction listed in the published terms of service of operating prediction market venues (for
          example Polymarket&apos;s restricted-jurisdictions list).
        </li>
        <li>
          Jurisdictions where gambling, wagering, or contracts for difference are prohibited or require
          licensure that DarkOdds does not hold.
        </li>
      </ul>

      <h2>No geo-restriction is enforced on testnet</h2>
      <p>
        This testnet build does not implement IP geofencing, KYC, or jurisdictional gating. DarkOdds runs on
        Arbitrum Sepolia using non-redeemable test tokens (cUSDC). By connecting a wallet and interacting with
        the contracts, you self-certify that doing so is lawful in your jurisdiction and that you accept full
        responsibility for your own compliance.
      </p>

      <h2>Permissionless creation</h2>
      <p>
        During the open-create window, anyone can deploy a market with any question. The operators of this
        site do not pre-screen, endorse, or curate user-created markets. The existence of a market on DarkOdds
        is not a representation that the question is well formed, that the resolution source is reliable, or
        that the outcome will be settled accurately.
      </p>

      <h2>Testnet risk</h2>
      <p>
        The contracts have been audited by ChainGPT and Slither and 178 of 180 Foundry tests pass, but no
        audit eliminates risk. Smart contract bugs, oracle failures, TEE attestation anomalies, sequencer
        downtime, key compromise, and other unforeseen failures may cause loss of test funds, incorrect
        resolution, or temporary unavailability. Test funds have no monetary value. Do not send mainnet assets
        to any address shown on this site.
      </p>

      <h2>No fiduciary or advisory relationship</h2>
      <p>
        Interaction with DarkOdds does not create a broker, advisor, fiduciary, or custodial relationship
        between you and any party associated with this project. You are solely responsible for the keys you
        control, the transactions you sign, and the markets you choose to participate in.
      </p>

      <h2>Forward-looking statements</h2>
      <p>
        Statements about future protocol versions, mainnet plans, governance transitions, or feature roadmaps
        are subject to change without notice. Nothing on this site constitutes a commitment to ship, list, or
        operate any particular feature.
      </p>

      <h2>Self-certification</h2>
      <p>
        By interacting with DarkOdds you confirm that you have read this disclaimer, that you accept the risks
        described in our Terms, and that your participation is lawful in every jurisdiction whose laws apply
        to you.
      </p>

      <p className="back-link">
        <Link href="/">Back to DarkOdds →</Link>
      </p>
    </article>
  );
}
