import {http} from "wagmi";

import {createConfig} from "@privy-io/wagmi";

import {ARB_SEPOLIA_RPC_URL, chain, supportedChains} from "./chains";

/// wagmi config built for use INSIDE Privy's WagmiProvider — note the
/// `createConfig` import is from `@privy-io/wagmi` (not upstream `wagmi`),
/// which wires Privy's connector into the wagmi config behind the scenes.
/// Per @privy-io/wagmi 4.0.6 README.
export const wagmiConfig = createConfig({
  chains: supportedChains,
  transports: {
    [chain.id]: http(ARB_SEPOLIA_RPC_URL),
  },
});

/// wagmi's type augmentation. `Register['config']` makes every wagmi hook
/// (`useReadContract`, `useWriteContract`, etc.) infer args/return types from
/// our concrete config — no need to pass generics at every call site.
declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
