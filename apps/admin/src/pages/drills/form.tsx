import { DRILL_DIFFICULTIES, SPORTS, type DrillDifficulty, type Sport } from "@atlitos/types";
import { Save } from "lucide-react";
import { useState } from "react";

import { Button } from "../../components/ui";
import { Field, Input, inputStyle } from "../../components/form";
import type { DrillInput } from "./api";

// AT-133, PRD-04 FR-49/FR-50. The one drill field set, shared by the Create and
// Edit screens so the two cannot drift. Client-side validation here is a fast
// first line only: admin_upsert_drill (0061) re-checks every rule server side,
// so a bypass of this form still cannot write a bad drill.
//
// xp_value renders through the mono Input (JetBrains Mono, tabular figures per
// CLAUDE.md) and must be a positive integer, mirroring the 0057 CHECK.

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

export function DrillForm({
  initial = EMPTY,
  submitLabel,
  busy,
  onSubmit,
}: {
  initial?: DrillFormInitial;
  submitLabel: string;
  busy: boolean;
  onSubmit: (input: DrillInput) => void;
}) {
  const [form, setForm] = useState<FormState>({
    title: initial.title,
    description: initial.description,
    sport: initial.sport,
    skillCategory: initial.skillCategory,
    difficulty: initial.difficulty,
    xpValue: initial.xpValue === null ? "" : String(initial.xpValue),
    mediaUrl: initial.mediaUrl ?? "",
  });

  const xpNumber = Number(form.xpValue);
  const xpValid = form.xpValue.trim().length > 0 && Number.isInteger(xpNumber) && xpNumber > 0;
  const canSave =
    !busy &&
    form.title.trim().length > 0 &&
    form.description.trim().length > 0 &&
    form.skillCategory.trim().length > 0 &&
    xpValid;

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
      <Field label="Title">
        <Input value={form.title} onChange={(v) => set("title", v)} placeholder="Name this drill" />
      </Field>

      <Field label="Description">
        <textarea
          value={form.description}
          onChange={(event) => set("description", event.target.value)}
          rows={4}
          placeholder="What the player does, and how to do it well."
          style={{ ...inputStyle, resize: "vertical" }}
        />
      </Field>

      <div style={{ display: "flex", gap: "var(--space-md)" }}>
        <Field label="Sport" style={{ flex: 1 }}>
          <select
            value={form.sport}
            onChange={(event) => set("sport", event.target.value as Sport)}
            style={inputStyle}
          >
            {SPORTS.map((sport) => (
              <option key={sport} value={sport}>
                {sport}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Difficulty" style={{ flex: 1 }}>
          <select
            value={form.difficulty}
            onChange={(event) => set("difficulty", event.target.value as DrillDifficulty)}
            style={inputStyle}
          >
            {DRILL_DIFFICULTIES.map((difficulty) => (
              <option key={difficulty} value={difficulty}>
                {difficulty}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div style={{ display: "flex", gap: "var(--space-md)" }}>
        <Field label="Skill category" style={{ flex: 1 }}>
          <Input
            value={form.skillCategory}
            onChange={(v) => set("skillCategory", v)}
            placeholder="Serve, footwork, finishing"
          />
        </Field>

        <Field label="XP value" style={{ width: 160 }}>
          <Input value={form.xpValue} onChange={(v) => set("xpValue", v)} mono placeholder="50" />
        </Field>
      </div>

      <Field label="Media URL, optional">
        <Input
          value={form.mediaUrl}
          onChange={(v) => set("mediaUrl", v)}
          placeholder="Link to a demo video or image"
        />
      </Field>

      {form.xpValue.trim().length > 0 && !xpValid ? (
        <p style={{ fontSize: 13, color: "var(--color-danger)", margin: 0 }}>
          XP value must be a whole number greater than zero.
        </p>
      ) : null}

      <div>
        <Button
          disabled={!canSave}
          onClick={() =>
            onSubmit({
              id: null,
              title: form.title,
              description: form.description,
              sport: form.sport,
              skillCategory: form.skillCategory,
              difficulty: form.difficulty,
              xpValue: xpNumber,
              mediaUrl: form.mediaUrl.trim().length > 0 ? form.mediaUrl.trim() : null,
            })
          }
        >
          <Save size={16} strokeWidth={1.75} />
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}
