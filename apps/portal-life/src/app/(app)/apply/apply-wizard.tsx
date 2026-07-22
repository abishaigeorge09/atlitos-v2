"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  FileText,
  Link2,
  Loader2,
  Trash2,
  Upload,
} from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import type { UpaApplication } from "@/lib/empower";
import { sportLabel, type Sport } from "@/lib/format";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";

export type WizardMode = "new" | "resume" | "reapply";

interface Draft {
  storyHeadline: string;
  storyBody: string;
  sport: Sport | "";
  region: string;
  state: string;
  photoUrl: string | null;
  videoUrls: string[];
}

const SPORTS: Sport[] = ["football", "cricket", "badminton", "tennis"];
const DRAFT_KEY = "atlitos-life-apply-draft";

const EMPTY_DRAFT: Draft = {
  storyHeadline: "",
  storyBody: "",
  sport: "",
  region: "",
  state: "",
  photoUrl: null,
  videoUrls: [],
};

const STEPS = ["Your story", "Sport and region", "Certificates", "Match videos"] as const;

// Map the field a needs_info bounce flagged to the wizard step that fixes it.
const FIELD_TO_STEP: Record<string, number> = {
  story_headline: 0,
  story_body: 0,
  photo_url: 0,
  sport: 1,
  region: 1,
  state: 1,
  evidence: 2,
};

function isValidUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

// Turn an RPC error (raised as "CODE: message") into friendly copy.
function friendlyError(message: string): string {
  if (message.startsWith("ALREADY_APPLIED")) {
    return "You already have an active application. Check your status instead.";
  }
  if (message.startsWith("COOLDOWN")) {
    return message.replace(/^COOLDOWN:\s*/, "");
  }
  if (message.startsWith("VALIDATION")) {
    return "Please complete every required field before submitting.";
  }
  return "We could not submit your application. Please try again.";
}

export function ApplyWizard({
  userId,
  mode,
  application,
}: {
  userId: string;
  mode: WizardMode;
  application: UpaApplication | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [draft, setDraft] = useState<Draft>(() => {
    if (mode === "resume" && application) {
      return {
        storyHeadline: application.story_headline,
        storyBody: application.story_body,
        sport: application.sport,
        region: application.region,
        state: application.state,
        photoUrl: application.photo_url,
        videoUrls: [],
      };
    }
    return EMPTY_DRAFT;
  });
  const [certFiles, setCertFiles] = useState<File[]>([]);
  const [step, setStep] = useState(0);
  const [stepError, setStepError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const hydrated = useRef(false);

  // Draft autosave (PRD-05 FR-1): restore text answers on reload for a fresh
  // or reapply flow. Resume prefills from the server row instead, and starts
  // on the flagged step.
  useEffect(() => {
    if (mode === "resume") {
      const flagged = application?.needs_info_field ?? searchParams.get("field");
      if (flagged && FIELD_TO_STEP[flagged] !== undefined) {
        setStep(FIELD_TO_STEP[flagged]);
      }
      hydrated.current = true;
      return;
    }
    try {
      const saved = localStorage.getItem(DRAFT_KEY);
      if (saved) setDraft({ ...EMPTY_DRAFT, ...(JSON.parse(saved) as Partial<Draft>) });
    } catch {
      // ignore malformed draft
    }
    hydrated.current = true;
  }, [mode, application, searchParams]);

  useEffect(() => {
    if (!hydrated.current || mode === "resume") return;
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch {
      // storage full or unavailable, non fatal
    }
  }, [draft, mode]);

  const set = useCallback(<K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }, []);

  const validVideoUrls = draft.videoUrls.map((u) => u.trim()).filter((u) => u && isValidUrl(u));
  const hasEvidence = certFiles.length > 0 || validVideoUrls.length > 0;

  function validateStep(index: number): string | null {
    if (index === 0) {
      if (!draft.storyHeadline.trim()) return "A story headline is required.";
      if (!draft.storyBody.trim()) return "Tell us your story before continuing.";
    }
    if (index === 1) {
      if (!draft.sport) return "Choose your sport.";
      if (!draft.region.trim()) return "Add your city or region.";
      if (!draft.state.trim()) return "Add your state.";
    }
    return null;
  }

  function next() {
    const err = validateStep(step);
    if (err) {
      setStepError(err);
      return;
    }
    setStepError(null);
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }

  function back() {
    setStepError(null);
    setStep((s) => Math.max(s - 1, 0));
  }

  async function handlePhoto(file: File) {
    setUploadingPhoto(true);
    const supabase = createClient();
    // upa-photos is a public bucket; the insert policy requires the first path
    // segment to be the caller's own id, so scope the path to userId.
    const path = `${userId}/${crypto.randomUUID()}-${file.name.replace(/[^\w.-]/g, "_")}`;
    const { error } = await supabase.storage.from("upa-photos").upload(path, file, { upsert: true });
    if (!error) {
      const { data } = supabase.storage.from("upa-photos").getPublicUrl(path);
      set("photoUrl", data.publicUrl);
    }
    setUploadingPhoto(false);
  }

  async function submit() {
    for (let i = 0; i <= 1; i += 1) {
      const err = validateStep(i);
      if (err) {
        setStep(i);
        setStepError(err);
        return;
      }
    }
    if (!hasEvidence) {
      setStep(2);
      setStepError("Add at least one certificate or match video.");
      return;
    }

    setSubmitting(true);
    setSubmitError(null);
    const supabase = createClient();
    const payload = {
      storyHeadline: draft.storyHeadline.trim(),
      storyBody: draft.storyBody.trim(),
      sport: draft.sport,
      region: draft.region.trim(),
      state: draft.state.trim(),
      photoUrl: draft.photoUrl,
    };

    try {
      let appId: string | undefined;
      if (mode === "resume" && application) {
        const { data, error } = await supabase.rpc("resubmit_upa_application", {
          p_application_id: application.id,
          p_payload: payload,
        });
        if (error) throw error;
        appId = (data as { id: string } | null)?.id;
      } else if (mode === "reapply") {
        const { data, error } = await supabase.rpc("reapply_upa_application", { p_payload: payload });
        if (error) throw error;
        appId = (data as { id: string } | null)?.id;
      } else {
        const { data, error } = await supabase.rpc("submit_upa_application", { p_payload: payload });
        if (error) throw error;
        appId = (data as { id: string } | null)?.id;
      }
      if (!appId) throw new Error("VALIDATION: no application id returned");

      // Attach evidence directly (upa_evidence_insert_own policy authorizes the
      // owner). Video links are external URLs; certificates upload to the
      // private per application folder in upa-evidence.
      for (const url of validVideoUrls) {
        await supabase.from("upa_evidence").insert({
          application_id: appId,
          kind: "video_link",
          url,
        });
      }
      for (const file of certFiles) {
        const path = `${appId}/${crypto.randomUUID()}-${file.name.replace(/[^\w.-]/g, "_")}`;
        const uploaded = await supabase.storage.from("upa-evidence").upload(path, file);
        if (uploaded.error) throw uploaded.error;
        await supabase.from("upa_evidence").insert({
          application_id: appId,
          kind: "certificate",
          storage_path: path,
        });
      }

      try {
        localStorage.removeItem(DRAFT_KEY);
      } catch {
        // ignore
      }
      router.push("/status");
      router.refresh();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setSubmitError(friendlyError(message));
      setSubmitting(false);
    }
  }

  const title =
    mode === "resume"
      ? "Update your application"
      : mode === "reapply"
        ? "Reapply for support"
        : "Apply for support";

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6">
      <PageHeader
        eyebrow={`Step ${step + 1} of ${STEPS.length}`}
        title={title}
        description={STEPS[step]}
      />

      <div className="flex gap-1.5">
        {STEPS.map((label, index) => (
          <div
            key={label}
            className={
              index <= step ? "h-1 flex-1 rounded-full bg-primary" : "h-1 flex-1 rounded-full bg-secondary"
            }
          />
        ))}
      </div>

      <Card>
        <CardContent className="flex flex-col gap-5 p-6">
          {step === 0 ? (
            <>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="headline">Story headline</Label>
                <Input
                  id="headline"
                  value={draft.storyHeadline}
                  maxLength={120}
                  onChange={(e) => set("storyHeadline", e.target.value)}
                  placeholder="Developing grassroots cricket for underprivileged girls"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="body">Your story</Label>
                <Textarea
                  id="body"
                  className="min-h-40"
                  value={draft.storyBody}
                  onChange={(e) => set("storyBody", e.target.value)}
                  placeholder="Who you are, what you play, and what support would change for you."
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="photo">Profile photo</Label>
                <div className="flex items-center gap-3">
                  {draft.photoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={draft.photoUrl}
                      alt="Your profile"
                      className="size-14 rounded-lg object-cover"
                    />
                  ) : (
                    <div className="flex size-14 items-center justify-center rounded-lg bg-secondary text-muted-foreground">
                      <Upload className="size-5" strokeWidth={1.75} />
                    </div>
                  )}
                  <Input
                    id="photo"
                    type="file"
                    accept="image/*"
                    disabled={uploadingPhoto}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handlePhoto(file);
                    }}
                    className="max-w-xs"
                  />
                  {uploadingPhoto ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : null}
                </div>
                <p className="text-xs text-muted-foreground">Optional. A clear photo helps sponsors connect.</p>
              </div>
            </>
          ) : null}

          {step === 1 ? (
            <>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="sport">Sport</Label>
                <Select
                  id="sport"
                  value={draft.sport}
                  onChange={(e) => set("sport", e.target.value as Sport)}
                >
                  <option value="" disabled>
                    Choose your sport
                  </option>
                  {SPORTS.map((s) => (
                    <option key={s} value={s}>
                      {sportLabel(s)}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="region">City or region</Label>
                <Input
                  id="region"
                  value={draft.region}
                  onChange={(e) => set("region", e.target.value)}
                  placeholder="Mumbai"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="state">State</Label>
                <Input
                  id="state"
                  value={draft.state}
                  onChange={(e) => set("state", e.target.value)}
                  placeholder="Maharashtra"
                />
              </div>
            </>
          ) : null}

          {step === 2 ? (
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="certs">Certificates or ID proof</Label>
                <Input
                  id="certs"
                  type="file"
                  accept="image/*,application/pdf"
                  multiple
                  onChange={(e) => {
                    const files = Array.from(e.target.files ?? []);
                    if (files.length) setCertFiles((prev) => [...prev, ...files]);
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  Images or PDF. Stored privately and only seen by our verification team.
                </p>
              </div>
              {certFiles.length ? (
                <ul className="flex flex-col gap-2">
                  {certFiles.map((file, index) => (
                    <li
                      key={`${file.name}-${index}`}
                      className="flex items-center justify-between rounded-lg border border-border bg-secondary px-3 py-2"
                    >
                      <span className="flex min-w-0 items-center gap-2 text-sm text-foreground">
                        <FileText className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
                        <span className="truncate">{file.name}</span>
                      </span>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Remove file"
                        onClick={() => setCertFiles((prev) => prev.filter((_, i) => i !== index))}
                      >
                        <Trash2 className="size-4" strokeWidth={1.75} />
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          {step === 3 ? (
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <Label>Match video links</Label>
                <p className="text-xs text-muted-foreground">
                  Paste links to match footage or highlights. We do not upload video, only the link.
                </p>
              </div>
              {draft.videoUrls.map((url, index) => {
                const invalid = url.trim().length > 0 && !isValidUrl(url);
                return (
                  <div key={index} className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <Link2
                        className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
                        strokeWidth={1.75}
                      />
                      <Input
                        value={url}
                        aria-invalid={invalid}
                        onChange={(e) =>
                          set(
                            "videoUrls",
                            draft.videoUrls.map((u, i) => (i === index ? e.target.value : u)),
                          )
                        }
                        placeholder="https://youtube.com/watch?v=..."
                        className="pl-8"
                      />
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Remove link"
                      onClick={() =>
                        set(
                          "videoUrls",
                          draft.videoUrls.filter((_, i) => i !== index),
                        )
                      }
                    >
                      <Trash2 className="size-4" strokeWidth={1.75} />
                    </Button>
                  </div>
                );
              })}
              <div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => set("videoUrls", [...draft.videoUrls, ""])}
                >
                  Add a link
                </Button>
              </div>
              <div className="mt-2 rounded-lg border border-border bg-secondary/50 px-3 py-2.5">
                <p className="text-xs text-muted-foreground">
                  Evidence so far:{" "}
                  <span className="font-mono tabular-nums text-foreground">{certFiles.length}</span>{" "}
                  {certFiles.length === 1 ? "file" : "files"} and{" "}
                  <span className="font-mono tabular-nums text-foreground">{validVideoUrls.length}</span>{" "}
                  {validVideoUrls.length === 1 ? "link" : "links"}. At least one is required.
                </p>
              </div>
            </div>
          ) : null}

          {stepError ? (
            <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {stepError}
            </p>
          ) : null}
          {submitError ? (
            <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {submitError}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={back} disabled={step === 0 || submitting}>
          <ArrowLeft className="size-4" strokeWidth={1.75} />
          Back
        </Button>
        {step < STEPS.length - 1 ? (
          <Button onClick={next}>
            Continue
            <ArrowRight className="size-4" strokeWidth={1.75} />
          </Button>
        ) : (
          <Button onClick={submit} disabled={submitting || !hasEvidence}>
            {submitting ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" strokeWidth={1.75} />}
            {mode === "resume" ? "Resubmit application" : "Submit application"}
          </Button>
        )}
      </div>
    </div>
  );
}
