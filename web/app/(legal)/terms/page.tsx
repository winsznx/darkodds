import Link from "next/link";

import type {Metadata} from "next";

export const metadata: Metadata = {
  title: "DarkOdds — Terms of use",
  description: "Testnet-only build. Use AS IS. MIT license. Read this before betting test funds.",
};

export default function TermsPage(): React.ReactElement {
  return (
    <>
      <p className="updated">Last updated: April 28, 2026</p>
      <h1>Terms of use</h1>

      <p>
        These terms govern use of the DarkOdds application at <code>localhost:3000</code> or any deployment
        thereof. By interacting with the application or its smart contracts you accept these terms. If you
        don&apos;t accept them, don&apos;t use the application.
      </p>

      <h2>Testnet only</h2>
      <p>
        DarkOdds is a hackathon submission running on Arbitrum Sepolia testnet. The TestUSDC token has no
        real-world value and exists only to demonstrate the protocol. Do not send real funds to any address in
        this project. Sepolia ETH is faucet-claimable and worthless. Test funds only.
      </p>

      <h2>AS IS, no warranty</h2>
      <p>
        The DarkOdds smart contracts and frontend are provided AS IS, without warranty of any kind, express or
        implied, including but not limited to the warranties of merchantability, fitness for a particular
        purpose, and non-infringement. The authors and contributors are not liable for any claim, damages, or
        other liability arising from your use of the application.
      </p>

      <h2>MIT license</h2>
      <p>
        Source code is open under the MIT License — see the{" "}
        <a
          href="https://github.com/winsznx/darkodds/blob/main/LICENSE"
          target="_blank"
          rel="noopener noreferrer"
        >
          LICENSE
        </a>{" "}
        file in the repository. You may use, copy, modify, merge, publish, distribute, sublicense, and sell
        copies subject to the standard MIT terms. Attribution is appreciated but not legally required by the
        license.
      </p>

      <h2>Risk acknowledgement</h2>
      <p>By using DarkOdds you acknowledge that:</p>
      <ul>
        <li>Prediction markets carry the risk of total loss of staked funds.</li>
        <li>Smart contracts may have unknown bugs despite the audits we&apos;ve performed.</li>
        <li>
          Oracle resolution may fail, be delayed, or return an outcome you disagree with. Resolution flows
          through the oracle adapter wired to each market — review it before betting.
        </li>
        <li>Settlement may be delayed by L2 congestion, oracle latency, or TEE compute time.</li>
        <li>The Nox SDK is in beta and may have undiscovered issues.</li>
      </ul>

      <h2>Permissionless creation — no editorial control</h2>
      <p>
        During the open-create window (see the GOVERNANCE STATE badge in the topbar), anyone with an Arbitrum
        Sepolia wallet can deploy a market on any topic via /create. The DarkOdds operators reserve no
        editorial control over user-created markets during this window. Markets may be created with offensive,
        illegal, factually invalid, or technically unresolvable criteria. By interacting with any user-created
        market you accept this risk; the only filter is liquidity (markets that no one trusts attract no
        betting).
      </p>
      <p>
        When the registry is in the governance-curated phase, market creation requires a 2-of-3 Safe co-sign.
        The mode switch is visible on every page in the topbar badge.
      </p>

      <h2>Sponsored deployment</h2>
      <p>
        During the open-create window, the /api/admin/deploy-market route signs market-creation transactions
        server-side with the deployer EOA when the connected wallet is not the registry owner. This is a
        demonstration affordance — judges and visitors should be able to deploy a market without first
        acquiring registry ownership. Sponsored transactions still pay gas; that gas is on us. Limit: one
        sponsored deploy per IP per 60 seconds.
      </p>

      <h2>No financial advice</h2>
      <p>
        Nothing in DarkOdds — markets, odds, attestations, FAQ entries — is investment advice. The protocol
        does not predict outcomes; it aggregates wagers from users who do. The accuracy of any market depends
        on the participants&apos; collective judgment, not on the protocol.
      </p>

      <h2>Termination</h2>
      <p>
        The hackathon submission deadline ends the active development window. The contracts will remain on
        Arbitrum Sepolia indefinitely (we don&apos;t control the chain), but the frontend may go offline, the
        sponsored-deployment route may be disabled, and the multisig may resume registry ownership at any time
        post-judging. None of these affect funds already in markets — claims and refunds remain callable
        directly via Etherscan-style interfaces against the on-chain contracts.
      </p>

      <h2>Severability</h2>
      <p>
        If any provision of these terms is found unenforceable, the remaining provisions remain in effect.
        These terms are governed by the laws of the jurisdiction the user resides in to the extent applicable;
        nothing here is intended to override mandatory consumer protection rights you may have.
      </p>

      <Link href="/" className="back-link">
        ← Back to DarkOdds
      </Link>
    </>
  );
}
