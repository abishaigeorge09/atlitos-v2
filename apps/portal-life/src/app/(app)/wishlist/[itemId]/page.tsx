import { requireVerifiedApplication } from "@/lib/empower";
import { FundingDetail } from "./funding-detail";

// Funding Progress Detail (PRD-05 FR-16, FR-17). Verified only. The client view
// scopes every read by this owner's application id and subscribes to Realtime.
export default async function FundingDetailPage({
  params,
}: {
  params: Promise<{ itemId: string }>;
}) {
  const { application } = await requireVerifiedApplication();
  const { itemId } = await params;

  return <FundingDetail itemId={itemId} upaId={application.id} />;
}
