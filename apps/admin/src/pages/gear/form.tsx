import { SPORTS, type Sport } from "@atlitos/types";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { Button } from "../../components/kit/Button";
import { Card } from "../../components/kit/Card";
import { Field } from "../../components/kit/Field";
import { Input } from "../../components/kit/Input";
import { SaveBar } from "../../components/kit/SaveBar";
import { Select } from "../../components/kit/Select";
import { Textarea } from "../../components/kit/Textarea";
import type { CategoryOption, GearInput, OfferInput } from "./api";
import "./gear.css";

// The one gear field set, shared by Create and Edit so the two cannot drift.
// Client validation is a fast first line only: the 0120 RPCs re-check every
// rule server side (title required, link must be http(s), price >= 0).
//
// Props and submit contract are frozen: `create.tsx` (Phase A3, not this
// track's file) depends on this exact shape.

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
  sport: null,
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
  const [titleTouched, setTitleTouched] = useState(false);

  const dirty =
    title !== initial.title ||
    brand !== (initial.brand ?? "") ||
    sport !== (initial.sport ?? "") ||
    categoryId !== (initial.categoryId ?? "") ||
    skillLevel !== (initial.skillLevel ?? "") ||
    ageRange !== (initial.ageRange ?? "") ||
    description !== (initial.description ?? "") ||
    imageUrl !== (initial.imageUrl ?? "");

  const titleError = title.trim().length === 0 ? "Title is required." : undefined;
  const errorCount = titleTouched && titleError ? 1 : 0;

  function discard() {
    setTitle(initial.title);
    setBrand(initial.brand ?? "");
    setSport(initial.sport ?? "");
    setCategoryId(initial.categoryId ?? "");
    setSkillLevel(initial.skillLevel ?? "");
    setAgeRange(initial.ageRange ?? "");
    setDescription(initial.description ?? "");
    setImageUrl(initial.imageUrl ?? "");
    setTitleTouched(false);
  }

  function save() {
    setTitleTouched(true);
    if (titleError) return;
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
    });
  }

  return (
    <div className="ak-gear-form-stack" style={{ display: "flex", flexDirection: "column", gap: "var(--space-lg)" }}>
      <Card>
        <h3 className="ak-gear-section-title">Product</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
          <div className="ak-gear-form-row">
            <Field label="Title" error={titleTouched ? titleError : undefined}>
              <div onBlur={() => setTitleTouched(true)}>
                <Input
                  value={title}
                  onChange={setTitle}
                  placeholder="Babolat Pure Drive 2026"
                  invalid={titleTouched && Boolean(titleError)}
                />
              </div>
            </Field>
            <Field label="Brand">
              <Input value={brand} onChange={setBrand} placeholder="Babolat" />
            </Field>
          </div>
        </div>
      </Card>

      <Card>
        <h3 className="ak-gear-section-title">Classification</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
          <div className="ak-gear-form-row">
            <Field label="Sport">
              <Select
                value={sport}
                onChange={setSport}
                placeholder="Any sport"
                options={SPORTS.map((s) => ({ value: s, label: s }))}
              />
            </Field>
            <Field label="Category">
              <Select
                value={categoryId}
                onChange={setCategoryId}
                placeholder="No category"
                options={categories.map((c) => ({ value: c.id, label: c.name }))}
              />
            </Field>
          </div>
          <div className="ak-gear-form-row">
            <Field label="Skill level" hint="Optional">
              <Input value={skillLevel} onChange={setSkillLevel} placeholder="Beginner, intermediate, advanced" />
            </Field>
            <Field label="Age range" hint="Optional">
              <Input value={ageRange} onChange={setAgeRange} placeholder="Adult, 10 to 14 years" />
            </Field>
          </div>
        </div>
      </Card>

      <Card>
        <h3 className="ak-gear-section-title">Description and image</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
          <Field label="Description" hint="Optional">
            <Textarea value={description} onChange={setDescription} rows={3} placeholder="What it is and who it suits." />
          </Field>
          <Field label="Image URL" hint="Optional">
            <Input value={imageUrl} onChange={setImageUrl} placeholder="https://..." />
          </Field>
        </div>
      </Card>

      <div className="ak-gear-savebar-fallback">
        <Button variant="primary" disabled={busy || Boolean(titleTouched && titleError)} onClick={save}>
          {submitLabel}
        </Button>
      </div>

      <SaveBar dirty={dirty} saving={busy} errorCount={errorCount} onSave={save} onDiscard={discard} />
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
      <Field label="Retailer">
        <Input value={draft.retailer} onChange={(v) => onChange({ ...draft, retailer: v })} placeholder="Amazon" />
      </Field>
      <Field label="Price, INR">
        <Input value={draft.price} onChange={(v) => onChange({ ...draft, price: v })} mono placeholder="15999" />
      </Field>
      <Field label="Affiliate link">
        <Input
          value={draft.affiliateUrl}
          onChange={(v) => onChange({ ...draft, affiliateUrl: v })}
          placeholder="https://amzn.to/..."
        />
      </Field>
      <label className="ak-gear-instock-label">
        <input
          type="checkbox"
          checked={draft.inStock}
          onChange={(event) => onChange({ ...draft, inStock: event.target.checked })}
        />
        In stock
      </label>
      {onRemove ? (
        <Button variant="secondary" onClick={onRemove} aria-label="Remove offer">
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
