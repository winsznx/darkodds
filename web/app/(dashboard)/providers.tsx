"use client";

import {useState} from "react";

import {PrivyProvider} from "@privy-io/react-auth";
import {WagmiProvider} from "@privy-io/wagmi";
import {QueryClient, QueryClientProvider} from "@tanstack/react-query";

import {chain, supportedChains} from "@/lib/chains";
import {useTheme} from "@/lib/use-theme";
import {wagmiConfig} from "@/lib/wagmi";

/// Provider order per @privy-io/wagmi 4.0.6 README:
///   PrivyProvider → QueryClientProvider → WagmiProvider
/// (Privy puts QueryClient OUTSIDE wagmi, not the wagmi-stand-alone order.)
///
/// The "use client" boundary is at this file. Everything inside is React DOM
/// territory; the dashboard layout that mounts this Providers tree is also a
/// client component because it uses hooks for the topbar/sidebar.
export function Providers({children}: {children: React.ReactNode}): React.ReactElement {
  const theme = useTheme();
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID ?? "";
  // QueryClient pinned in component state so it survives StrictMode double-mounts
  // without re-creating itself per render.
  const [queryClient] = useState(() => new QueryClient());

  if (!appId) {
    return (
      <div style={{padding: 32, fontFamily: "var(--font-mono)", color: "var(--redacted-red)"}}>
        NEXT_PUBLIC_PRIVY_APP_ID missing in env. Add it to web/.env.local and reload.
      </div>
    );
  }

  return (
    <PrivyProvider
      appId={appId}
      config={{
        supportedChains: [...supportedChains],
        defaultChain: chain,
        embeddedWallets: {
          ethereum: {
            // Auto-provision an embedded wallet for users who log in via email
            // / Google / Twitter / etc. without a connected external wallet.
            // Judges and demo viewers see no seed-phrase friction.
            createOnLogin: "users-without-wallets",
          },
        },
        loginMethods: ["email", "google", "twitter", "wallet"],
        appearance: {
          // Sync Privy's modal palette with the dossier theme.
          theme: theme === "dark" ? "dark" : "light",
          accentColor: "#A82820", // --redacted-red
          // 512×512 crest served by app/icon-512/route.ts. The path is
          // relative so it resolves against whichever origin the modal
          // mounts under (production darkodds.site, preview, or local).
          logo: "/icon-512",
          showWalletLoginFirst: false,
          walletChainType: "ethereum-only",
        },
        // Embedded-wallet creation is "off-chain" until the user signs their
        // first tx; we don't pre-fund.
      }}
    >
      <QueryClientProvider client={queryClient}>
        <WagmiProvider config={wagmiConfig}>{children}</WagmiProvider>
      </QueryClientProvider>
    </PrivyProvider>
  );
}
