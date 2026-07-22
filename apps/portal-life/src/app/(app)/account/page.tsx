import { requireUser, getOwnApplication } from "@/lib/empower";
import { AccountView } from "./account-view";

// Account Settings (PRD-05 FR-25, FR-26, FR-27). Reachable in any state. Story
// fields are shown read only: after verification the schema locks direct edits
// (0049 grants no client update on upa_applications), so story changes go
// through support. A verified UPA can deactivate their profile here.
export default async function AccountPage() {
  const user = await requireUser();
  const application = await getOwnApplication(user.id);
  return <AccountView email={user.email ?? "Signed in"} application={application} />;
}
