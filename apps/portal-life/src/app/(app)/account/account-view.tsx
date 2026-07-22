"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, LogOut, Mail, ShieldAlert } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import type { UpaApplication } from "@/lib/empower";
import { sportLabel } from "@/lib/format";
import { PageHeader } from "@/components/page-header";
import { StatusPill, upaStatusPill } from "@/components/status-pill";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function AccountView({
  email,
  application,
}: {
  email: string;
  application: UpaApplication | null;
}) {
  const router = useRouter();
  const [deactivateOpen, setDeactivateOpen] = useState(false);

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/signin");
    router.refresh();
  }

  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader
        eyebrow="Account"
        title="Your account"
        description="Your sign in and profile details."
      />

      <Card>
        <CardContent className="flex flex-col gap-4 p-6">
          <div className="flex flex-col gap-1.5">
            <Label>Email</Label>
            <span className="flex items-center gap-2 text-sm text-foreground">
              <Mail className="size-4 text-muted-foreground" strokeWidth={1.75} />
              {email}
            </span>
          </div>
          <div>
            <Button variant="outline" onClick={signOut}>
              <LogOut className="size-4" strokeWidth={1.75} />
              Sign out
            </Button>
          </div>
        </CardContent>
      </Card>

      {application ? (
        <Card>
          <CardContent className="flex flex-col gap-4 p-6">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-foreground">Your profile</span>
              <StatusPill {...upaStatusPill(application.status)} />
            </div>
            <dl className="grid gap-3 sm:grid-cols-2">
              <Field label="Headline" value={application.story_headline} />
              <Field label="Sport" value={sportLabel(application.sport)} />
              <Field label="Region" value={application.region} />
              <Field label="State" value={application.state} />
            </dl>
            <p className="text-xs text-muted-foreground">
              To change your story after verification, contact support so we can keep your funded
              wishlist safe.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {application?.status === "verified" ? (
        <Card className="border-destructive/30">
          <CardContent className="flex flex-col gap-3 p-6">
            <span className="flex items-center gap-1.5 text-sm font-semibold text-destructive">
              <ShieldAlert className="size-4" strokeWidth={1.75} />
              Deactivate profile
            </span>
            <p className="text-sm text-muted-foreground">
              Deactivating removes your profile from sponsors. Your wishlist stops receiving
              funding. This cannot be undone from here.
            </p>
            <div>
              <Button variant="destructive" onClick={() => setDeactivateOpen(true)}>
                Deactivate my profile
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <DeactivateDialog
        open={deactivateOpen}
        onOpenChange={setDeactivateOpen}
        applicationId={application?.id ?? null}
      />
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm text-foreground">{value}</dd>
    </div>
  );
}

function DeactivateDialog({
  open,
  onOpenChange,
  applicationId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  applicationId: string | null;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    if (!applicationId) return;
    setSubmitting(true);
    setError(null);
    const supabase = createClient();
    // verified -> deactivated via the owner gated RPC (0050); the client never
    // writes the status column.
    const { error: rpcError } = await supabase.rpc("deactivate_upa_application", {
      p_application_id: applicationId,
    });
    setSubmitting(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    onOpenChange(false);
    router.push("/status");
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Deactivate your profile</DialogTitle>
          <DialogDescription>
            Sponsors will no longer see your profile or fund your wishlist. This cannot be undone
            from here.
          </DialogDescription>
        </DialogHeader>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Keep my profile
          </Button>
          <Button variant="destructive" onClick={confirm} disabled={submitting}>
            {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
            Deactivate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
