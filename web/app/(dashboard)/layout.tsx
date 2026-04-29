import "./dashboard.css";

import {ScrollToTop} from "@/components/ScrollToTop";

import {Providers} from "./providers";
import {Shell} from "./Shell";

/// (dashboard) route group — Privy + wagmi + react-query providers wrap ONLY
/// these routes; the public landing page (`app/page.tsx`) stays a server
/// component with no client-side bundle weight.
export default function DashboardLayout({children}: {children: React.ReactNode}): React.ReactElement {
  return (
    <Providers>
      <ScrollToTop />
      <Shell>{children}</Shell>
    </Providers>
  );
}
