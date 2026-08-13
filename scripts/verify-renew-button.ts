// ATLITOS v2 — scripts/verify-renew-button.ts
//
// Proves the Renew button in MyGroupsCard.tsx renders for exactly the
// membership states renew_group_membership (0104) accepts, and for no others.
// It exercises the SAME two predicates the component calls, imported from
// @atlitos/api, rather than restating the rule, so it cannot drift from the
// component without failing.
//
// Why this matters: before 0104 the button rendered only for 'lapsed', a state
// a paid membership could never reach, so it was dead code. After 0104 the
// sweep produces 'expired', which is renewable, and 'lapsed', which is not
// (the seat was released, the athlete re joins under the capacity guard).
// A button that appears in order to error is worse than no button.
//
// Run from the repo root, with node_modules installed:
//
//   ./node_modules/.bin/tsc scripts/verify-renew-button.ts \
//     --outDir /tmp/renewout --module commonjs --target es2020 \
//     --moduleResolution node --skipLibCheck
//   ln -sfn "$PWD/node_modules" /tmp/renewout/node_modules
//   node /tmp/renewout/scripts/verify-renew-button.js
//
// Verified output on 2026-08-13:
//   pending  unpaid=false RenewButton=hidden
//   active   unpaid=false RenewButton=hidden
//   expired  unpaid=true  RenewButton=SHOWN
//   lapsed   unpaid=true  RenewButton=hidden
//   verify-renew-button: PASS

import {
  isMembershipRenewable,
  isMembershipUnpaid,
  type GroupMembershipStatus,
} from "../packages/api/src/use-groups";

const EXPECTED: Record<GroupMembershipStatus, boolean> = {
  pending: false,
  active: false,
  expired: true,
  lapsed: false,
};

let failures = 0;

for (const status of Object.keys(EXPECTED) as GroupMembershipStatus[]) {
  // The exact expression MyGroupsCard evaluates per row.
  const unpaid = isMembershipUnpaid(status);
  const canRenew = unpaid && isMembershipRenewable(status);

  console.log(
    `${status.padEnd(8)} unpaid=${String(unpaid).padEnd(5)} RenewButton=${canRenew ? "SHOWN" : "hidden"}`,
  );

  if (canRenew !== EXPECTED[status]) {
    console.error(
      `FAIL: ${status} renders the Renew button as ${canRenew}, expected ${EXPECTED[status]}`,
    );
    failures += 1;
  }
}

if (failures > 0) {
  // Thrown rather than process.exit so the file needs no @types/node; a throw
  // still exits non zero, which is what a CI step keys off.
  throw new Error(`verify-renew-button: FAIL, ${failures} state(s) wrong`);
}
console.log("verify-renew-button: PASS");
