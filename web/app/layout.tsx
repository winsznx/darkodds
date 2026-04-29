import type {Metadata} from "next";

import "./globals.css";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://darkodds.site";

export const metadata: Metadata = {
  metadataBase: new URL(APP_URL),
  title: {
    default: "DarkOdds — Privacy Permissionless Prediction Markets",
    template: "%s · DarkOdds",
  },
  description:
    "Public market. Private wager. Permissionless creation. Built on iExec Nox + Arbitrum. Selective-disclosure attestations.",
  applicationName: "DarkOdds",
  authors: [{name: "Tim", url: "https://github.com/winsznx"}],
  keywords: [
    "prediction markets",
    "privacy",
    "iExec",
    "Nox",
    "Arbitrum",
    "TEE",
    "TDX",
    "ChainGPT",
    "selective disclosure",
    "ERC-7984",
  ],
  openGraph: {
    type: "website",
    url: APP_URL,
    siteName: "DarkOdds",
    title: "DarkOdds — Privacy Permissionless Prediction Markets",
    description:
      "Public market. Private wager. Permissionless creation. Built on iExec Nox + Arbitrum. Selective-disclosure attestations.",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    site: "@iEx_ec",
    creator: "@winsznx",
    title: "DarkOdds — Privacy Permissionless Prediction Markets",
    description:
      "Public market. Private wager. Permissionless creation. Built on iExec Nox + Arbitrum. Selective-disclosure attestations.",
  },
  robots: {index: true, follow: true},
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased" data-theme="light" suppressHydrationWarning>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
