/**
 * Category pill — the small mono-cap badge above the question on every
 * market card. DarkOdds-native gets a literal "PRIVATE" in redacted-red.
 * Polymarket-mirror gets the domain-tag-filtered category in ink.
 *
 * Filtering through DOMAIN_TAGS is what keeps editorial meta-tags
 * ("Trending", "Featured", "Carousel") out of the pills — they exist on
 * the wire but don't answer "what topic is this market about?".
 */
export function CategoryPill({
  label,
  variant,
}: {
  label: string;
  variant: "private" | "public";
}): React.ReactElement {
  return (
    <span className={`mc-cat-pill mc-cat-pill--${variant}`} data-test="category-pill">
      {label.toUpperCase()}
    </span>
  );
}
