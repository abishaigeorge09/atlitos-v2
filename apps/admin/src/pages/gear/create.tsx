import { ArrowLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { Card } from "../../components/ui";
import { fetchCategories, gearApi, type CategoryOption, type CommerceError, type GearInput } from "./api";
import { AddOfferButton, EMPTY_OFFER, GearForm, OfferRow, offerDraftToInput, offerDraftValid, type OfferDraft } from "./form";

// Create one gear item and its retailer offers in one screen. The product is
// written first (admin_upsert_affiliate_product), then each offer
// (admin_upsert_product_offer). A gear item with no offer has nothing to
// compare and nothing to click out to, so at least one valid retailer line is
// required before Save enables. If an offer fails after the product landed,
// we still navigate to the product so the entered rows are not lost; the
// error shows on the Edit screen.

function errorMessage(err: unknown): string {
  const e = err as CommerceError;
  return e?.message ?? "Something went wrong. Try again.";
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

      <Card>
        <p style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--color-text-tertiary)", margin: "0 0 var(--space-md)" }}>
          Retailers
        </p>
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
        <p style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--color-text-tertiary)", margin: "0 0 var(--space-md)" }}>
          Product
        </p>
        <GearForm categories={categories} submitLabel="Create gear item" busy={busy || !offersValid} onSubmit={submit} />
      </Card>
    </div>
  );
}
