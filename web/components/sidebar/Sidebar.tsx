"use client";

import {useEffect, useRef, useState} from "react";

import {ChevronLeft, ChevronRight, FilePlus, Layers, LineChart, Pin, ScrollText} from "lucide-react";
import {usePathname} from "next/navigation";

import {NavItem} from "./NavItem";
import {ProtocolStats} from "./ProtocolStats";
import {useSidebarMode} from "./useSidebarMode";

const PEEK_DELAY_MS = 180;
const EDGE_ZONE_PX = 8;

interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

export function Sidebar({open, onClose}: SidebarProps): React.ReactElement {
  const {collapsed, toggle, setCollapsed} = useSidebarMode();
  const [peeking, setPeeking] = useState(false);
  const asideRef = useRef<HTMLElement>(null);
  const pathname = usePathname();

  // After a nav click, the activated link keeps DOM focus on the new page —
  // which fires `focusin` on the sidebar's listener and pins peek-mode open
  // for the entire next route. Drop residual focus inside the sidebar on
  // every pathname change so the rail re-collapses cleanly.
  useEffect(() => {
    const aside = asideRef.current;
    if (!aside) return;
    const active = document.activeElement;
    if (active instanceof HTMLElement && aside.contains(active)) {
      active.blur();
    }
  }, [pathname]);

  useEffect(() => {
    if (!collapsed) return;
    const aside = asideRef.current;
    if (!aside) return;

    let timer: number | null = null;

    const cancel = (): void => {
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
    };

    // Approach detection — schedule peek when cursor is inside the rail or
    // within the edge zone. Once peeking, panel grows to 240px; we rely on
    // mouseleave below (which correctly accounts for the panel descendant)
    // to dismiss peek instead of re-checking the rect on every mousemove,
    // because the aside's rect stays at 56px even while the panel is 240px.
    const onMove = (e: MouseEvent): void => {
      const rect = aside.getBoundingClientRect();
      const inApproach =
        e.clientX <= rect.right + EDGE_ZONE_PX &&
        e.clientX >= rect.left - EDGE_ZONE_PX &&
        e.clientY >= rect.top &&
        e.clientY <= rect.bottom;
      if (inApproach) {
        if (timer === null) {
          timer = window.setTimeout(() => {
            timer = null;
            setPeeking(true);
          }, PEEK_DELAY_MS);
        }
      } else {
        cancel();
      }
    };

    const onLeave = (): void => {
      cancel();
      setPeeking(false);
    };

    const onFocusIn = (): void => {
      cancel();
      setPeeking(true);
    };
    const onFocusOut = (e: FocusEvent): void => {
      const next = e.relatedTarget;
      if (next instanceof Node && aside.contains(next)) return;
      setPeeking(false);
    };

    window.addEventListener("mousemove", onMove);
    aside.addEventListener("mouseleave", onLeave);
    aside.addEventListener("focusin", onFocusIn);
    aside.addEventListener("focusout", onFocusOut);
    return () => {
      cancel();
      window.removeEventListener("mousemove", onMove);
      aside.removeEventListener("mouseleave", onLeave);
      aside.removeEventListener("focusin", onFocusIn);
      aside.removeEventListener("focusout", onFocusOut);
    };
  }, [collapsed]);

  const showPeek = collapsed && peeking;
  const expandedForA11y = !collapsed || showPeek;

  return (
    <>
      <aside
        ref={asideRef}
        className="sidebar"
        data-open={open}
        data-collapsed={collapsed}
        data-peek={showPeek}
        role="navigation"
        aria-label="Primary"
        onClick={onClose}
      >
        <div className="sidebar-panel" id="primary-nav">
          <div className="sidebar-toolbar">
            {showPeek && (
              <button
                type="button"
                className="sidebar-pin"
                onClick={(e) => {
                  e.stopPropagation();
                  setCollapsed(false);
                }}
                aria-label="Pin sidebar open"
                title="Pin sidebar open"
              >
                <Pin size={11} />
              </button>
            )}
            <button
              type="button"
              className="sidebar-toggle"
              onClick={(e) => {
                e.stopPropagation();
                toggle();
              }}
              aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
              aria-expanded={expandedForA11y}
              aria-controls="primary-nav"
              aria-keyshortcuts="\\"
              title={collapsed ? "Expand sidebar  \\" : "Collapse sidebar  \\"}
            >
              {collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
            </button>
          </div>

          <div className="sidebar-section">§ NAVIGATION</div>
          <nav className="sidebar-nav">
            <NavItem href="/markets" Icon={Layers} label="MARKETS" />
            <NavItem href="/portfolio" Icon={LineChart} label="PORTFOLIO" />
            <NavItem href="/audit" Icon={ScrollText} label="AUDIT" />
            <NavItem href="/create" Icon={FilePlus} label="CREATE" />
          </nav>
          <ProtocolStats />
        </div>
      </aside>
      <div className="sidebar-backdrop" data-open={open} onClick={onClose} />
    </>
  );
}
