import type {Metadata} from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "DarkOdds — Public market. Private wager.",
  description:
    "A confidential prediction market on Arbitrum Sepolia. Public outcomes, public odds, hidden bet sizes. Built on iExec Nox.",
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
