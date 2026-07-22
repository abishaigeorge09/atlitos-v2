import { redirect } from "next/navigation";

import { requireUser, getOwnApplication } from "@/lib/empower";
import { ApplyWizard, type WizardMode } from "./apply-wizard";

// Apply wizard (PRD-05 FR-1 to FR-6, FR-8). The guard: an applicant with an
// active application (submitted, under_review or verified) cannot start a
// second one (FR-6), so those land on /status. needs_info resumes into the
// flagged step; rejected or deactivated starts a fresh reapply.
export default async function ApplyPage() {
  const user = await requireUser();
  const application = await getOwnApplication(user.id);

  if (application && ["submitted", "under_review", "verified"].includes(application.status)) {
    redirect("/status");
  }

  let mode: WizardMode = "new";
  if (application?.status === "needs_info") mode = "resume";
  else if (application && ["rejected", "deactivated"].includes(application.status)) mode = "reapply";

  return (
    <ApplyWizard
      userId={user.id}
      mode={mode}
      application={mode === "resume" ? application : null}
    />
  );
}
