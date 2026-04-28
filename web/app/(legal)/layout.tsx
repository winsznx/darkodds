import "./legal.css";

/**
 * Layout for /privacy, /terms, /disclaimer. Plain prose, NOT dossier
 * styled — visual contrast with the marketing site is intentional. These
 * pages should read like a regulator's document, not a poster.
 */
export default function LegalLayout({children}: {children: React.ReactNode}): React.ReactElement {
  return <main className="legal-shell">{children}</main>;
}
