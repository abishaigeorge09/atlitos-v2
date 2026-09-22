import { DRILL_DIFFICULTIES, SPORTS, type DrillDifficulty, type Sport } from "@atlitos/types";
import { useMemo, useState } from "react";

import { Card } from "../../components/kit/Card";
import { Field } from "../../components/kit/Field";
import { Input } from "../../components/kit/Input";
import { SaveBar } from "../../components/kit/SaveBar";
import { Select } from "../../components/kit/Select";
import { Textarea } from "../../components/kit/Textarea";
import type { DrillInput } from "./api";

// AT-133, PRD-04 FR-49/FR-50. The one drill field set, shared by Create and
// Edit so the two cannot drift. Client-side validation here is a fast first
// line only: admin_upsert_drill (0061) re-checks every rule server side, so
// a bypass of this form still cannot write a bad drill.
//
// xp_value renders through the kit's mono Input and must be a positive
// integer, mirroring the 0057 CHECK. Dirty tracking compares the live form
// to `initial` so SaveBar only appears once something actually changed.

type FormState = {
  title: string;
  description: string;
  sport: Sport;
  skillCategory: string;
  difficulty: DrillDifficulty;
  xpValue: string;
  mediaUrl: string;
};

export interface DrillFormInitial {
  title: string;
  description: string;
  sport: Sport;
  skillCategory: string;
  difficulty: DrillDifficulty;
  xpValue: number | null;
  mediaUrl: string | null;
}

const EMPTY: DrillFormInitial = {
  title: "",
  description: "",
  sport: SPORTS[0],
  skillCategory: "",
  difficulty: DRILL_DIFFICULTIES[0],
  xpValue: null,
  mediaUrl: null,
};

const FIELD_IDS = {
  title: "drill-title",
  description: "drill-description",
  skillCategory: "drill-skill-category",
  xpValue: "drill-xp-value",
} as const;

function toFormState(initial: DrillFormInitial): FormState {
  return {
    title: initial.title,
    description: initial.description,
    sport: initial.sport,
    skillCategory: initial.skillCategory,
    difficulty: initial.difficulty,
    xpValue: initial.xpValue === null ? "" : String(initial.xpValue),
    mediaUrl: initial.mediaUrl ?? "",
  };
}

interface Errors {
  title?: string;
  description?: string;
  skillCategory?: string;
  xpValue?: string;
}

export function DrillForm({
  initial = EMPTY,
  submitLabel,
  busy,
  onSubmit,
  onDiscard,
}: {
  initial?: DrillFormInitial;
  submitLabel: string;
  busy: boolean;
  onSubmit: (input: DrillInput) => void;
  onDiscard?: () => void;
}) {
  const baseline = useMemo(() => toFormState(initial), [initial]);
  const [form, setForm] = useState<FormState>(baseline);
  const [submitAttempted, setSubmitAttempted] = useState(false);

  const dirty = JSON.stringify(form) !== JSON.stringify(baseline);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  const xpNumber = Number(form.xpValue);
  const xpValid = form.xpValue.trim().length > 0 && Number.isInteger(xpNumber) && xpNumber > 0;

  const errors: Errors = {};
  if (form.title.trim().length === 0) errors.title = "Title is required.";
  if (form.description.trim().length === 0) errors.description = "Description is required.";
  if (form.skillCategory.trim().length === 0) errors.skillCategory = "Skill category is required.";
  if (!xpValid) errors.xpValue = "XP value must be a whole number greater than zero.";

  const shown = (key: keyof Errors) => (submitAttempted ? errors[key] : undefined);
  const errorCount = Object.keys(errors).length;

  function discard() {
    setForm(baseline);
    setSubmitAttempted(false);
    onDiscard?.();
  }

  function submit() {
    setSubmitAttempted(true);
    if (errorCount > 0) {
      const firstInvalidId = errors.title
        ? FIELD_IDS.title
        : errors.description
          ? FIELD_IDS.description
          : errors.skillCategory
            ? FIELD_IDS.skillCategory
            : FIELD_IDS.xpValue;
      document.getElementById(firstInvalidId)?.focus();
      return;
    }
    onSubmit({
      id: null,
      title: form.title,
      description: form.description,
      sport: form.sport,
      skillCategory: form.skillCategory,
      difficulty: form.difficulty,
      xpValue: xpNumber,
      mediaUrl: form.mediaUrl.trim().length > 0 ? form.mediaUrl.trim() : null,
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-lg)" }}>
      <Card>
        <h3 style={{ marginTop: 0, fontSize: "var(--text-md)", fontWeight: "var(--weight-semibold)" }}>Details</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
          <Field label="Title" error={shown("title")} htmlFor={FIELD_IDS.title}>
            <Input id={FIELD_IDS.title} value={form.title} onChange={(v) => set("title", v)} placeholder="Name this drill" invalid={!!shown("title")} />
          </Field>
          <Field label="Description" error={shown("description")} htmlFor={FIELD_IDS.description}>
            <Textarea
              id={FIELD_IDS.description}
              value={form.description}
              onChange={(v) => set("description", v)}
              placeholder="What the player does, and how to do it well."
            />
          </Field>
        </div>
      </Card>

      <Card>
        <h3 style={{ marginTop: 0, fontSize: "var(--text-md)", fontWeight: "var(--weight-semibold)" }}>Classification</h3>
        <div style={{ display: "flex", gap: "var(--space-md)" }}>
          <div style={{ flex: 1 }}>
            <Field label="Sport">
              <Select value={form.sport} onChange={(v) => set("sport", v as Sport)} options={SPORTS.map((s) => ({ value: s, label: s }))} />
            </Field>
          </div>
          <div style={{ flex: 1 }}>
            <Field label="Difficulty">
              <Select
                value={form.difficulty}
                onChange={(v) => set("difficulty", v as DrillDifficulty)}
                options={DRILL_DIFFICULTIES.map((d) => ({ value: d, label: d }))}
              />
            </Field>
          </div>
        </div>
        <div style={{ marginTop: "var(--space-md)" }}>
          <Field label="Skill category" error={shown("skillCategory")} htmlFor={FIELD_IDS.skillCategory}>
            <Input
              id={FIELD_IDS.skillCategory}
              value={form.skillCategory}
              onChange={(v) => set("skillCategory", v)}
              placeholder="Serve, footwork, finishing"
              invalid={!!shown("skillCategory")}
            />
          </Field>
        </div>
      </Card>

      <Card>
        <h3 style={{ marginTop: 0, fontSize: "var(--text-md)", fontWeight: "var(--weight-semibold)" }}>Reward and media</h3>
        <div style={{ display: "flex", gap: "var(--space-md)" }}>
          <div style={{ width: 160 }}>
            <Field label="XP value" error={shown("xpValue")} htmlFor={FIELD_IDS.xpValue}>
              <Input id={FIELD_IDS.xpValue} value={form.xpValue} onChange={(v) => set("xpValue", v)} placeholder="50" mono invalid={!!shown("xpValue")} />
            </Field>
          </div>
          <div style={{ flex: 1 }}>
            <Field label="Media URL, optional">
              <Input value={form.mediaUrl} onChange={(v) => set("mediaUrl", v)} placeholder="Link to a demo video or image" />
            </Field>
          </div>
        </div>
      </Card>

      <SaveBar dirty={dirty} saving={busy} errorCount={submitAttempted ? errorCount : 0} onSave={submit} onDiscard={discard} />

      {!dirty ? (
        <div>
          <button type="button" className="ak-button ak-button-primary ak-button-md" onClick={submit} disabled={busy}>
            {submitLabel}
          </button>
        </div>
      ) : null}
    </div>
  );
}
