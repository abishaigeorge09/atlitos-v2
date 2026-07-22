import { requireUser, getOwnApplication } from "@/lib/empower";
import { StatusView } from "./status-view";

// Verification Status roadmap (PRD-05 FR-7, FR-8, FR-9, FR-10). Server fetches
// the applicant's own row (explicit owner filter inside getOwnApplication);
// the client view subscribes to Realtime so a staff decision lands without a
// manual refresh.
export default async function StatusPage() {
  const user = await requireUser();
  const application = await getOwnApplication(user.id);

  return <StatusView userId={user.id} initialApplication={application} />;
}
