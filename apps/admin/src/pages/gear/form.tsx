import { SPORTS, type Sport } from "@atlitos/types";
import { Plus, Save, Trash2 } from "lucide-react";
import { useState } from "react";

import { Button } from "../../components/ui";
import { Field, Input, inputStyle } from "../../components/form";
import type { CategoryOption, GearInput, OfferInput } from "./api";

// The one gear field set, shared by Create and Edit so the two cannot drift.
// Client validation is a fast first line only: the 0120 RPCs re-check every
// rule server side (title required, link must be http(s), price >= 0).
//
// Prices render through the mono Input (JetBrains Mono, tabular figures).

export interface GearFormInitial {
  title: string;
  brand: string | null;
  sport: Sport | null;
  categoryId: string | null;
  skillLevel: string | null;
  ageRange: string | null;
  description: string | null;
  imageUrl: string | null;
}

const EMPTY: GearFormInitial = {
  title: "",
  brand: null,
  sport: SPORTS[0],
  categoryId: null,
  skillLevel: null,
  ageRange: null,
  description: null,
  imageUrl: null,
};

function clean(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function GearForm({
  initial = EMPTY,
  categories,
  submitLabel,
  busy,
  onSubmit,
}: {
  initial?: GearFormInitial;
  categories: CategoryOption[];
  submitLabel: string;
  busy: boolean;
  onSubmit: (input: GearInput) => void;
}) {
  const [title, setTitle] = useState(initial.title);
  const [brand, setBrand] = useState(initial.brand ?? "");
  const [sport, setSport] = useState<string>(initial.sport ?? "");
  const [categoryId, setCategoryId] = useState(initial.categoryId ?? "");
  const [skillLevel, setSkillLevel] = useState(initial.skillLevel ?? "");
  const [ageRange, setAgeRange] = useState(initial.ageRange ?? "");
  const [description, setDescription] = useState(initial.description ?? "");
  const [imageUrl, setImageUrl] = useState(initial.imageUrl ?? "");

  const canSave = !busy && title.trim().length > 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
      <div style={{ display: "flex", gap: "var(--space-md)" }}>
        <Field label="Title" style={{ flex: 2 }}>
          <Input value={title} onChange={setTitle} placeholder="Babolat Pure Drive 2026" />
        </Field>
        <Field label="Brand" style={{ flex: 1 }}>
          <Input value={brand} onChange={setBrand} placeholder="Babolat" />
        </Field>
      </div>

      <div style={{ display: "flex", gap: "var(--space-md)" }}>
        <Field label="Sport" style={{ flex: 1 }}>
          <select value={sport} onChange={(event) => setSport(event.target.value)} style={inputStyle}>
            <option value="">Any sport</option>
            {SPORTS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Category" style={{ flex: 1 }}>
          <select value={categoryId} onChange={(event) => setCategoryId(event.target.value)} style={inputStyle}>
            <option value="">No category</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div style={{ display: "flex", gap: "var(--space-md)" }}>
        <Field label="Skill level, optional" style={{ flex: 1 }}>
          <Input value={skillLevel} onChange={setSkillLevel} placeholder="beginner, intermediate, advanced" />
        </Field>
        <Field label="Age range, optional" style={{ flex: 1 }}>
          <Input value={ageRange} onChange={setAgeRange} placeholder="adult, 10 to 14 years" />
        </Field>
      </div>

      <Field label="Description, optional">
        <textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={3}
          placeholder="What it is and who it suits."
          style={{ ...inputStyle, resize: "vertical" }}
        />
      </Field>

      <Field label="Image URL, optional">
        <Input value={imageUrl} onChange={setImageUrl} placeholder="https://..." />
      </Field>

      <div>
        <Button
          disabled={!canSave}
          onClick={() =>
            onSubmit({
              id: null,
              title: title.trim(),
              brand: clean(brand),
              sport: (sport || null) as Sport | null,
              categoryId: categoryId || null,
              skillLevel: clean(skillLevel),
              ageRange: clean(ageRange),
              description: clean(description),
              imageUrl: clean(imageUrl),
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

// ---- offers ---------------------------------------------------------------

export interface OfferDraft {
  retailer: string;
  price: string;
  affiliateUrl: string;
  inStock: boolean;
}

export const EMPTY_OFFER: OfferDraft = { retailer: "", price: "", affiliateUrl: "", inStock: true };

export function offerDraftValid(d: OfferDraft): boolean {
  const price = Number(d.price);
  return (
    d.retailer.trim().length > 0 &&
    d.price.trim().length > 0 &&
    Number.isFinite(price) &&
    price >= 0 &&
    /^https?:\/\//.test(d.affiliateUrl.trim())
  );
}

export function offerDraftToInput(d: OfferDraft): OfferInput {
  return {
    retailer: d.retailer.trim(),
    price: Number(d.price),
    affiliateUrl: d.affiliateUrl.trim(),
    inStock: d.inStock,
  };
}

/** One retailer line: retailer, price in rupees, the commission link, in stock. */
export function OfferRow({
  draft,
  onChange,
  onRemove,
}: {
  draft: OfferDraft;
  onChange: (next: OfferDraft) => void;
  onRemove?: () => void;
}) {
  return (
    <div style={{ display: "flex", gap: "var(--space-sm)", alignItems: "flex-end" }}>
      <Field label="Retailer" style={{ flex: 1 }}>
        <Input value={draft.retailer} onChange={(v) => onChange({ ...draft, retailer: v })} placeholder="Amazon" />
      </Field>
      <Field label="Price (INR)" style={{ width: 140 }}>
        <Input value={draft.price} onChange={(v) => onChange({ ...draft, price: v })} mono placeholder="15999" />
      </Field>
      <Field label="Affiliate link" style={{ flex: 2 }}>
        <Input
          value={draft.affiliateUrl}
          onChange={(v) => onChange({ ...draft, affiliateUrl: v })}
          placeholder="https://amzn.to/..."
        />
      </Field>
      <label
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-xs)",
          fontSize: 13,
          color: "var(--color-text-secondary)",
          paddingBottom: "var(--space-sm)",
          whiteSpace: "nowrap",
        }}
      >
        <input
          type="checkbox"
          checked={draft.inStock}
          onChange={(event) => onChange({ ...draft, inStock: event.target.checked })}
        />
        In stock
      </label>
      {onRemove ? (
        <Button variant="secondary" onClick={onRemove} aria-label="Remove offer" style={{ marginBottom: 1 }}>
          <Trash2 size={16} strokeWidth={1.75} />
        </Button>
      ) : null}
    </div>
  );
}

export function AddOfferButton({ onClick }: { onClick: () => void }) {
  return (
    <Button variant="secondary" onClick={onClick}>
      <Plus size={16} strokeWidth={1.75} />
      Add retailer
    </Button>
  );
}
