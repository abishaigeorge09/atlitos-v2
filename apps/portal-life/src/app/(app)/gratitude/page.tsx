import { requireVerifiedApplication } from "@/lib/empower";
import { GratitudeView } from "./gratitude-view";

// Gratitude Posts (PRD-05 FR-19 to FR-22). Compose is available only for a
// funded or delivered item that has no post yet; the list is otherwise read
// only, with owner soft delete.
export default async function GratitudePage() {
  const { user, application } = await requireVerifiedApplication();
  return <GratitudeView upaId={application.id} userId={user.id} />;
}
