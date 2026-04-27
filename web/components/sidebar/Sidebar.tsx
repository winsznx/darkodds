"use client";

import {LineChart, FilePlus, Layers, ScrollText} from "lucide-react";

import {NavItem} from "./NavItem";
import {ProtocolStats} from "./ProtocolStats";

interface SidebarProps {
  open: boolean;
  onClose: () => void;
}

export function Sidebar({open, onClose}: SidebarProps): React.ReactElement {
  return (
    <>
      <aside className="sidebar" data-open={open} onClick={onClose}>
        <div className="sidebar-section">§ NAVIGATION</div>
        <nav className="sidebar-nav">
          <NavItem href="/markets" Icon={Layers} label="MARKETS" />
          <NavItem href="/portfolio" Icon={LineChart} label="PORTFOLIO" />
          <NavItem href="/audit" Icon={ScrollText} label="AUDIT" />
          <NavItem href="/create" Icon={FilePlus} label="CREATE" />
        </nav>
        <ProtocolStats />
      </aside>
      <div className="sidebar-backdrop" data-open={open} onClick={onClose} />
    </>
  );
}
