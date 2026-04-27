"use client";

import Link from "next/link";
import {usePathname} from "next/navigation";

import type {LucideIcon} from "lucide-react";

interface NavItemProps {
  href: string;
  Icon: LucideIcon;
  label: string;
  badge?: string;
}

export function NavItem({href, Icon, label, badge}: NavItemProps): React.ReactElement {
  const pathname = usePathname();
  const active = pathname === href || pathname?.startsWith(`${href}/`);
  return (
    <Link href={href} className="navitem" data-active={active} prefetch>
      <span className="icon">
        <Icon size={16} />
      </span>
      <span className="lbl">{label}</span>
      {badge && <span className="badge">{badge}</span>}
    </Link>
  );
}
