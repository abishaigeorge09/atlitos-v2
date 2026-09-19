import { supabaseClient } from "../../providers/supabaseClient";

// PRD-04 FR-36, FR-37. The one place apps/admin talks to the suspend/
// reinstate back end, same posture as pages/commerce/api.ts: no direct
// `.update()` against `users.status` from this bundle (that column is
// admin-locked by the 0065 trigger and the FR-36 flow always needs the
// GoTrue ban alongside the row write), everything goes through the
// `admin-user-suspend` edge function (PHASE-4-STATUS.md CT-B).

export interface UserActionError {
  code: string;
  message: string;
}

export interface SuspendResult {
  user_id: string;
  status: "active" | "suspended";
}

async function callSuspendFn(input: {
  userId: string;
  action: "suspend" | "reinstate";
  reason: string | null;
}): Promise<SuspendResult> {
  const { data, error } = await supabaseClient.functions.invoke("admin-user-suspend", {
    body: {
      user_id: input.userId,
      action: input.action,
      reason: input.reason,
    },
  });

  if (error) {
    // Mirrors advanceOrder's error unwrap (commerce/api.ts): a non-2xx from
    // supabase-js is a FunctionsHttpError whose body carries { error: {
    // code, message } }. Reading it is the difference between the admin
    // seeing VALIDATION/"an admin cannot suspend their own account" and
    // seeing a generic "Edge Function returned a non-2xx status code".
    const context = (error as { context?: Response }).context;
    if (context && typeof context.json === "function") {
      try {
        const body = (await context.json()) as { error?: UserActionError };
        if (body?.error?.code) throw body.error;
      } catch (parsed) {
        if (parsed && typeof parsed === "object" && "code" in parsed) throw parsed;
      }
    }
    throw { code: "INTERNAL", message: error.message } satisfies UserActionError;
  }

  return data as SuspendResult;
}

export const usersApi = {
  suspend: (userId: string, reason: string) => callSuspendFn({ userId, action: "suspend", reason }),
  reinstate: (userId: string, reason: string | null) => callSuspendFn({ userId, action: "reinstate", reason }),
};
