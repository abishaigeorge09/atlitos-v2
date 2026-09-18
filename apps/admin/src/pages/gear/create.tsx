import { ArrowLeft, ImageOff, Link2, Loader2, Save } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { Badge, Button, Card } from "../../components/ui";
import { Field, Input, inputStyle } from "../../components/form";
import {
  fetchCategories,
  gearApi,
  ingestFetch,
  ingestSave,
  type CategoryOption,
  type CommerceError,
  type GearInput,
  type IngestDraft,
} from "./api";
import { AddOfferButton, EMPTY_OFFER, GearForm, OfferRow, offerDraftToInput, offerDraftValid, type OfferDraft } from "./form";

// Create one gear item and its retailer offers in one screen. The product is
// written first (admin_upsert_affiliate_product), then each offer
// (admin_upsert_product_offer). A gear item with no offer has nothing to
// compare and nothing to click out to, so at least one valid retailer line is
// required before Save enables. If an offer fails after the product landed,
// we still navigate to the product so the entered rows are not lost; the
// error shows on the Edit screen.
//
// "Add from a link" (FR-44, FR-45, FR-47, ADR-011 D3) sits above the manual
// form. Fetch never writes anything, not even the image copy; the draft is
// reviewable and editable before Save calls `gear-ingest` again with the
// (possibly edited) draft, which is the one place the catalogue write and the
// image copy happen, under the admin's own JWT.

function errorMessage(err: unknown): string {
  const e = err as CommerceError;
  return e?.message ?? "Something went wrong. Try again.";
}

const sectionLabel: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "var(--color-text-tertiary)",
  margin: "0 0 var(--space-md)",
};

function AddFromLink({ onSaved }: { onSaved: (productId: string) => void }) {
  const [url, setUrl] = useState("");
  const [fetching, setFetching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [retailerKey, setRetailerKey] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [draft, setDraft] = useState<IngestDraft | null>(null);

  const canFetch = /^https?:\/\//.test(url.trim()) && !fetching;

  async function runFetch() {
    setFetching(true);
    setFetchError(null);
    setDraft(null);
    try {
      const result = await ingestFetch(url.trim());
      setDraft(result.draft);
      setRetailerKey(result.retailerKey);
      setWarnings(result.warnings);
    } catch (err) {
      setFetchError(errorMessage(err));
    } finally {
      setFetching(false);
    }
  }

  async function runSave() {
    if (!draft) return;
    setSaving(true);
    setSaveError(null);
    try {
      const result = await ingestSave(url.trim(), draft);
      onSaved(result.productId);
    } catch (err) {
      setSaveError(errorMessage(err));
      setSaving(false);
    }
  }

  function updateDraft<K extends keyof IngestDraft>(key: K, value: IngestDraft[K]) {
    setDraft((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  return (
    <Card>
      <p style={sectionLabel}>Add from a link</p>
      <p style={{ fontSize: 14, color: "var(--color-text-secondary)", margin: "0 0 var(--space-md)" }}>
        Paste a product page from a supported retailer. Fetch reads the page, nothing is saved until you review it.
      </p>

      <div style={{ display: "flex", gap: "var(--space-sm)", alignItems: "flex-end" }}>
        <Field label="Product page URL" style={{ flex: 1 }}>
          <Input value={url} onChange={setUrl} placeholder="https://www.amazon.in/dp/..." />
        </Field>
        <Button disabled={!canFetch} onClick={runFetch}>
          {fetching ? (
            <Loader2 size={16} strokeWidth={1.75} style={{ animation: "gear-ingest-spin 0.8s linear infinite" }} />
          ) : (
            <Link2 size={16} strokeWidth={1.75} />
          )}
          {fetching ? "Fetching" : "Fetch"}
        </Button>
      </div>
      <style>{"@keyframes gear-ingest-spin { to { transform: rotate(360deg); } }"}</style>

      {fetchError ? (
        <p style={{ fontSize: 14, color: "var(--color-danger)", margin: "var(--space-md) 0 0" }}>{fetchError}</p>
      ) : null}

      {draft ? (
        <div style={{ marginTop: "var(--space-lg)", display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
          <div style={{ display: "flex", gap: "var(--space-md)", alignItems: "flex-start" }}>
            <div
              style={{
                width: 96,
                height: 96,
                flexShrink: 0,
                borderRadius: "var(--radius-md)",
                border: "1px solid var(--color-border)",
                backgroundColor: "var(--color-surface-muted)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                overflow: "hidden",
              }}
            >
              {draft.imageUrl ? (
                <img src={draft.imageUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              ) : (
                <ImageOff size={24} strokeWidth={1.75} color="var(--color-text-tertiary)" />
              )}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", gap: "var(--space-sm)", alignItems: "center", marginBottom: "var(--space-sm)" }}>
                <Badge tone="neutral">{retailerKey ?? "unknown retailer"}</Badge>
                {warnings.map((w) => (
                  <Badge key={w} tone="warning">
                    {w}
                  </Badge>
                ))}
              </div>
              {draft.canonicalUrl ? (
                <p style={{ fontSize: 13, color: "var(--color-text-secondary)", margin: 0, wordBreak: "break-all" }}>{draft.canonicalUrl}</p>
              ) : null}
            </div>
          </div>

          <div style={{ display: "flex", gap: "var(--space-md)" }}>
            <Field label="Title" style={{ flex: 2 }}>
              <Input value={draft.title} onChange={(v) => updateDraft("title", v)} />
            </Field>
            <Field label="Brand" style={{ flex: 1 }}>
              <Input value={draft.brand ?? ""} onChange={(v) => updateDraft("brand", v || null)} />
            </Field>
          </div>

          <div style={{ display: "flex", gap: "var(--space-md)", alignItems: "flex-end" }}>
            <Field label="Price" style={{ width: 160 }}>
              <Input mono value={draft.price === null ? "" : String(draft.price)} onChange={(v) => updateDraft("price", v.trim() === "" ? null : Number(v))} />
            </Field>
            <Field label="Currency" style={{ width: 100 }}>
              <Input value={draft.currency ?? "INR"} onChange={(v) => updateDraft("currency", v || null)} />
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
                checked={draft.inStock ?? true}
                onChange={(event) => updateDraft("inStock", event.target.checked)}
              />
              In stock
            </label>
          </div>

          <Field label="Description, optional">
            <textarea
              value={draft.description ?? ""}
              onChange={(event) => updateDraft("description", event.target.value || null)}
              rows={3}
              style={{ ...inputStyle, resize: "vertical" }}
            />
          </Field>

          {saveError ? <p style={{ fontSize: 14, color: "var(--color-danger)", margin: 0 }}>{saveError}</p> : null}

          <div>
            <Button disabled={saving || draft.title.trim().length === 0} onClick={runSave}>
              <Save size={16} strokeWidth={1.75} />
              {saving ? "Saving" : "Save gear item"}
            </Button>
          </div>
        </div>
      ) : null}
    </Card>
  );
}

export function GearCreate() {
  const navigate = useNavigate();
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [offers, setOffers] = useState<OfferDraft[]>([{ ...EMPTY_OFFER }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchCategories().then(setCategories).catch(() => setCategories([]));
  }, []);

  const offersValid = offers.length > 0 && offers.every(offerDraftValid);

  async function submit(input: GearInput) {
    if (!offersValid) {
      setError("Add at least one retailer with a price and an http(s) link.");
      return;
    }
    setBusy(true);
    setError(null);
    let productId: string | null = null;
    try {
      const created = await gearApi.upsertProduct({ ...input, id: null });
      productId = created.id;
      for (const draft of offers) {
        await gearApi.upsertOffer(created.id, offerDraftToInput(draft));
      }
      navigate(`/gear/show/${created.id}`);
    } catch (err) {
      if (productId) {
        navigate(`/gear/show/${productId}?error=${encodeURIComponent(errorMessage(err))}`);
        return;
      }
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  function updateOffer(index: number, next: OfferDraft) {
    setOffers((prev) => prev.map((o, i) => (i === index ? next : o)));
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-lg)", maxWidth: 880 }}>
      <button
        type="button"
        onClick={() => navigate("/gear")}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-xs)",
          border: "none",
          background: "none",
          color: "var(--color-text-secondary)",
          fontSize: 14,
          cursor: "pointer",
          padding: 0,
          alignSelf: "flex-start",
        }}
      >
        <ArrowLeft size={16} strokeWidth={1.75} />
        Back to gear
      </button>

      <div>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0, letterSpacing: "-0.4px" }}>New gear item</h1>
        <p style={{ fontSize: 14, color: "var(--color-text-secondary)", margin: "var(--space-xs) 0 0" }}>
          One product, priced per retailer. Shoppers see the cheapest in stock offer first and leave to the retailer to buy.
        </p>
      </div>

      {error ? (
        <Card style={{ borderColor: "var(--color-danger)", padding: "var(--space-md) var(--space-lg)" }}>
          <p style={{ fontSize: 14, color: "var(--color-danger)", margin: 0 }}>{error}</p>
        </Card>
      ) : null}

      <AddFromLink onSaved={(productId) => navigate(`/gear/show/${productId}`)} />

      <h2 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>Or enter it by hand</h2>

      <Card>
        <p style={sectionLabel}>Retailers</p>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
          {offers.map((draft, index) => (
            <OfferRow
              key={index}
              draft={draft}
              onChange={(next) => updateOffer(index, next)}
              onRemove={offers.length > 1 ? () => setOffers((prev) => prev.filter((_, i) => i !== index)) : undefined}
            />
          ))}
          <div>
            <AddOfferButton onClick={() => setOffers((prev) => [...prev, { ...EMPTY_OFFER }])} />
          </div>
        </div>
        {!offersValid ? (
          <p style={{ fontSize: 13, color: "var(--color-text-secondary)", margin: "var(--space-md) 0 0" }}>
            Each retailer needs a name, a price of zero or more, and a link starting with http:// or https://.
          </p>
        ) : null}
      </Card>

      <Card>
        <p style={sectionLabel}>Product</p>
        <GearForm categories={categories} submitLabel="Create gear item" busy={busy || !offersValid} onSubmit={submit} />
      </Card>
    </div>
  );
}
