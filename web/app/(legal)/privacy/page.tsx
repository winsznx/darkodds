import Link from "next/link";

import type {Metadata} from "next";

export const metadata: Metadata = {
  title: "DarkOdds — Privacy",
  description: "What data DarkOdds collects (almost none) and what it doesn't.",
};

export default function PrivacyPage(): React.ReactElement {
  return (
    <>
      <p className="updated">Last updated: April 28, 2026</p>
      <h1>Privacy policy</h1>

      <p>
        DarkOdds is a testnet-only hackathon submission running on Arbitrum Sepolia. This document describes
        what data the application collects and what it does not. Plain English only — no dark patterns, no
        adtech.
      </p>

      <h2>What we don&apos;t collect</h2>
      <p>
        We don&apos;t collect personal information. There is no account creation, no email capture, no
        analytics tracker, no cookies for advertising, no fingerprinting, no third-party pixels. We don&apos;t
        sell or share data with anyone because we don&apos;t have data to sell or share.
      </p>

      <h2>What is public on-chain by nature</h2>
      <p>
        Wallet addresses, market addresses, transaction hashes, oracle resolutions, and the published
        plaintext pool totals (after each 60-second batch) are public on Arbitrum Sepolia. This is the nature
        of public blockchains — anyone can read the chain. DarkOdds does not control or modify what is
        recorded on-chain.
      </p>

      <h2>What stays private</h2>
      <p>
        Your individual bet size, your encrypted cUSDC balance, and your settled payout amount remain
        encrypted on iExec Nox until you choose to disclose them via a selective-disclosure attestation. The
        privacy guarantee is enforced by an Intel TDX trusted execution environment combined with on-chain ACL
        — see the &quot;How does the privacy actually work?&quot; FAQ on the homepage for the technical
        detail.
      </p>

      <h2>Third-party services</h2>
      <p>
        We use Privy for wallet authentication. When you connect a wallet, your auth flow is handled by Privy
        under their privacy policy at <a href="https://www.privy.io/privacy">privy.io/privacy</a>. We use
        ChainGPT&apos;s API on the server side when you submit a market description on /create — your prompt
        is sent to ChainGPT for parameter extraction and is not retained by DarkOdds beyond the request
        lifecycle.
      </p>

      <h2>Server-side state</h2>
      <p>
        Our /api/admin/deploy-market route maintains an in-memory per-IP rate-limit counter (1 sponsored
        deploy per IP per 60 seconds). This counter is not persisted anywhere — it lives in process memory and
        is reset on every server restart. Our /api/attestation/generate route reads claim transaction receipts
        from Arbitrum Sepolia and signs an attestation server-side; the request body and response are not
        logged or stored.
      </p>

      <h2>Local storage</h2>
      <p>
        The app stores your theme preference (light/dark) in <code>localStorage</code> under the key{" "}
        <code>darkodds-theme</code>. The Nox SDK caches authorization material in <code>localStorage</code>{" "}
        for 1 hour to avoid re-prompting for signatures on every decrypt — this material is scoped to your
        wallet and the Nox protocol contract address. Nothing else is persisted client-side.
      </p>

      <h2>Children</h2>
      <p>
        DarkOdds is not directed at users under 18 and we make no effort to identify children. Don&apos;t use
        this if you&apos;re a child.
      </p>

      <h2>Changes</h2>
      <p>
        We may update this policy as the protocol evolves. The &quot;Last updated&quot; timestamp at the top
        will reflect any change. Substantive changes will be announced via the project README on GitHub.
      </p>

      <h2>Contact</h2>
      <p>
        DarkOdds is built by Tim (winsznx) for the iExec Vibe Coding Challenge × ChainGPT, DoraHacks. For
        anything privacy-related: open an issue at{" "}
        <a href="https://github.com/winsznx/darkodds/issues">github.com/winsznx/darkodds/issues</a>.
      </p>

      <Link href="/" className="back-link">
        ← Back to DarkOdds
      </Link>
    </>
  );
}
