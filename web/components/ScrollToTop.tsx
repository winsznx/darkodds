"use client";

import {useEffect} from "react";

import {usePathname} from "next/navigation";

/**
 * Resets window scroll to (0, 0) on every pathname change. Mounted inside
 * route-group layouts ((dashboard), (legal)) so client navigations
 * deterministically open at the top of the new route. Returns null — no
 * markup, just the side effect.
 */
export function ScrollToTop(): null {
  const pathname = usePathname();
  useEffect(() => {
    window.scrollTo({top: 0, behavior: "instant"});
  }, [pathname]);
  return null;
}
