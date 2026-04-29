/**
 * Persistent "CREATED BY YOU" badge — case-file-row pill in the
 * declassified-amber color, rhyming with the OPEN-CREATE governance
 * state badge in the topbar. Different signal from the redacted-red
 * CLASSIFIED stamp (which means private/encrypted) — amber here means
 * "permissionless protocol mode, you participated in this."
 *
 * Visibility is decided by the parent (MarketsLayout merges localStorage
 * + server-ledger sources). This component just renders the visual.
 */
export function CreatedByYouBadge(): React.ReactElement {
  return (
    <span className="mc-mine-badge" data-test="created-by-you">
      CREATED BY YOU
    </span>
  );
}
