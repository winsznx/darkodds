import {PagePlaceholder} from "../_PagePlaceholder";

export default function AuditPage(): React.ReactElement {
  return (
    <PagePlaceholder
      num="F10"
      title="Audit trail."
      emphasis="Selective."
      comingIn="PHASE F10"
      description="Generate signed selective-disclosure attestations for any settled claim. Recipient-bound or bearer-mode. Verify on-chain via ClaimVerifier. Downloadable JSON proof an auditor can re-validate."
    />
  );
}
