"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { validatePayoutMethod, type PayoutMethodType, type SavePayoutMethodInput } from "@atlitos/types";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

/**
 * Payout details for one venue (migration 0130,
 * docs/PLAN-PAYOUTS-CLICKS-SEARCH.md Track 1).
 *
 * Razorpay Route is closed to ELSHEPH, so Atlitos pays venues by NEFT or UPI
 * and needs to know where. The portal never touches `payout_methods`, which
 * has no client grant: it calls `upsert_my_payout_method`, which checks the
 * caller is this venue's partner (staff are refused, this binds where money
 * goes). Changing saved details sends them back to review.
 */

type FieldErrors = Partial<Record<keyof SavePayoutMethodInput | "confirmAccountNumber", string>>;

interface PayoutDetailsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  venueId: string;
  hasExisting: boolean;
  initialHolder: string;
  initialMethod: PayoutMethodType;
  onSaved: () => void;
}

export function PayoutDetailsDialog({
  open,
  onOpenChange,
  venueId,
  hasExisting,
  initialHolder,
  initialMethod,
  onSaved,
}: PayoutDetailsDialogProps) {
  const [methodType, setMethodType] = useState<PayoutMethodType>(initialMethod);
  const [holder, setHolder] = useState(initialHolder);
  const [accountNumber, setAccountNumber] = useState("");
  const [confirmAccountNumber, setConfirmAccountNumber] = useState("");
  const [ifsc, setIfsc] = useState("");
  const [vpa, setVpa] = useState("");
  const [pan, setPan] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setMethodType(initialMethod);
    setHolder(initialHolder);
    setAccountNumber("");
    setConfirmAccountNumber("");
    setIfsc("");
    setVpa("");
    setPan("");
    setErrors({});
    setSaveError(null);
  }, [open, initialHolder, initialMethod]);

  async function save() {
    const input: SavePayoutMethodInput = {
      methodType,
      accountHolderName: holder,
      accountNumber: methodType === "bank_account" ? accountNumber : undefined,
      ifsc: methodType === "bank_account" ? ifsc : undefined,
      vpa: methodType === "upi" ? vpa : undefined,
      pan,
    };
    const found: FieldErrors = validatePayoutMethod(input);
    if (methodType === "bank_account" && accountNumber.replace(/\s/g, "") !== confirmAccountNumber.replace(/\s/g, "")) {
      found.confirmAccountNumber = "The two account numbers do not match.";
    }
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setSaving(true);
    setSaveError(null);
    const supabase = createClient();
    const { error } = await supabase.rpc("upsert_my_payout_method", {
      p_owner_type: "court_partner",
      p_venue_id: venueId,
      p_method_type: methodType,
      p_account_holder_name: holder,
      p_account_number: methodType === "bank_account" ? accountNumber : undefined,
      p_ifsc: methodType === "bank_account" ? ifsc : undefined,
      p_vpa: methodType === "upi" ? vpa : undefined,
      p_pan: pan.trim() ? pan : undefined,
    });
    setSaving(false);
    if (error) {
      setSaveError(error.message.replace(/^[A-Z_]+:\s*/, ""));
      return;
    }
    onOpenChange(false);
    onSaved();
  }

  const field = (id: string, label: string, control: React.ReactNode, err?: string, hint?: string) => (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {control}
      {err ? (
        <p id={`${id}-error`} className="text-xs text-destructive">
          {err}
        </p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{hasExisting ? "Change payout details" : "Add payout details"}</DialogTitle>
          <DialogDescription>
            Atlitos sends this venue&apos;s earnings here by NEFT or UPI. We check new details with a Rs 1 test deposit before the first payout.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div role="radiogroup" aria-label="How should we pay you" className="flex gap-2">
            {(["bank_account", "upi"] as const).map((m) => (
              <Button
                key={m}
                type="button"
                role="radio"
                aria-checked={methodType === m}
                variant={methodType === m ? "default" : "outline"}
                size="sm"
                onClick={() => setMethodType(m)}
              >
                {m === "bank_account" ? "Bank account" : "UPI"}
              </Button>
            ))}
          </div>

          {field(
            "payout-holder",
            "Name on the account",
            <Input id="payout-holder" value={holder} onChange={(e) => setHolder(e.target.value)} autoComplete="name" aria-invalid={!!errors.accountHolderName} />,
            errors.accountHolderName,
          )}

          {methodType === "bank_account" ? (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                {field(
                  "payout-account",
                  "Account number",
                  <Input id="payout-account" inputMode="numeric" autoComplete="off" value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} aria-invalid={!!errors.accountNumber} />,
                  errors.accountNumber,
                )}
                {field(
                  "payout-account-confirm",
                  "Account number again",
                  <Input id="payout-account-confirm" inputMode="numeric" autoComplete="off" value={confirmAccountNumber} onChange={(e) => setConfirmAccountNumber(e.target.value)} aria-invalid={!!errors.confirmAccountNumber} />,
                  errors.confirmAccountNumber,
                )}
              </div>
              {field(
                "payout-ifsc",
                "IFSC",
                <Input id="payout-ifsc" value={ifsc} onChange={(e) => setIfsc(e.target.value.toUpperCase())} placeholder="HDFC0001234" maxLength={11} aria-invalid={!!errors.ifsc} />,
                errors.ifsc,
              )}
            </>
          ) : (
            field(
              "payout-vpa",
              "UPI ID",
              <Input id="payout-vpa" value={vpa} onChange={(e) => setVpa(e.target.value.toLowerCase())} placeholder="venue@okaxis" aria-invalid={!!errors.vpa} />,
              errors.vpa,
            )
          )}

          {field(
            "payout-pan",
            "PAN, for tax records",
            <Input id="payout-pan" value={pan} onChange={(e) => setPan(e.target.value.toUpperCase())} placeholder="ABCDE1234F" maxLength={10} aria-invalid={!!errors.pan} />,
            errors.pan,
            "Optional for now.",
          )}

          {hasExisting ? (
            <p className="rounded-lg border border-border bg-muted px-3 py-2 text-xs text-muted-foreground">
              Saving new details pauses payouts until we verify them again.
            </p>
          ) : null}

          {saveError ? <p className="text-sm text-destructive">{saveError}</p> : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={() => void save()} disabled={saving}>
            {saving ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            Save details
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
