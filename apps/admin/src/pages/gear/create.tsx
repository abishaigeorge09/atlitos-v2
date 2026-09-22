import { Link2, Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { Badge } from "../../components/kit/Badge";
import { Button } from "../../components/kit/Button";
import { Card } from "../../components/kit/Card";
import { Field } from "../../components/kit/Field";
import { Input } from "../../components/kit/Input";
import { PageHeader } from "../../components/kit/PageHeader";
import {
  fetchCategories,
  gearApi,
  ingestFetch,
  type CategoryOption,
  type CommerceError,
  type GearInput,
  type IngestError,
} from "./api";
import { AddOfferButton, EMPTY_OFFER, GearForm, OfferRow, offerDraftToInput, offerDraftValid, type GearFormInitial, type OfferDraft } from "./form";
import { ingestGuidance, keepsUrlAsOffer } from "./ingest-guidance";
import "./gear.css";

// ONE screen, ONE form. "Add from a link" is a prefill source for the form
// below, never a second form with its own Save. Before A3 there were two: the
// link panel had its own fields and its own save button, so a refused fetch
// threw the work away and the admin retyped everything into the form
// underneath. The founder's words: "the link does not really add in".
//
// Fetch writes nothing (FR-44). What comes back, whether a full draft or the
// partial one attached to a 422, fills the form, and the pasted URL becomes
// the first retailer offer's link. Every refusal shows its code, one line of
// guidance from ingest-guidance.ts, and leaves the form ready.

function errorMessage(err: unknown): string {
  const e = err as CommerceError;
  return e?.message ?? "Something went wrong. Try again.";
}

interface PrefillState {
  initial: GearFormInitial;
  /** Bumped on every prefill so GearForm remounts with the new values. */
  nonce: number;
}

const BLANK: GearFormInitial = {
  title: "",
  brand: null,
  sport: null,
  categoryId: null,
  skillLevel: null,
  ageRange: null,
  description: null,
  imageUrl: null,
};

interface Refusal {
  code: string;
  message: string;
  guidance: string;
  upstreamStatus: number | null;
}

export function GearCreate() {
  const navigate = useNavigate();
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [offers, setOffers] = useState<OfferDraft[]>([{ ...EMPTY_OFFER }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [url, setUrl] = useState("");
  const [fetching, setFetching] = useState(false);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [fetched, setFetched] = useState<{ retailerName: string | null; warnings: string[] } | null>(null);
  const [prefill, setPrefill] = useState<PrefillState>({ initial: BLANK, nonce: 0 });

  useEffect(() => {
    fetchCategories().then(setCategories).catch(() => setCategories([]));
  }, []);

  const offersValid = offers.length > 0 && offers.every(offerDraftValid);
  const canFetch = /^https?:\/\//.test(url.trim()) && !fetching;

  /** Retailer name for the offer row, from the programme key or the hostname. */
  const retailerFromUrl = useMemo(() => {
    try {
      return new URL(url.trim()).hostname.replace(/^www\./, "");
    } catch {
      return "";
    }
  }, [url]);

  function applyPrefill(draft: {
    title?: string;
    brand?: string | null;
    description?: string | null;
    imageUrl?: string | null;
    price?: number | null;
    inStock?: boolean | null;
    canonicalUrl?: string | null;
  }, retailerName: string | null) {
    setPrefill((prev) => ({
      nonce: prev.nonce + 1,
      initial: {
        ...BLANK,
        title: draft.title ?? "",
        brand: draft.brand ?? null,
        description: draft.description ?? null,
        imageUrl: draft.imageUrl ?? null,
      },
    }));
    // The pasted link is the offer link, always: it is what a shopper clicks.
    const offerUrl = url.trim();
    setOffers((prev) => {
      const rest = prev.slice(1).filter((o) => o.retailer.trim() || o.price.trim() || o.affiliateUrl.trim());
      return [
        {
          retailer: retailerName ?? retailerFromUrl,
          price: draft.price === null || draft.price === undefined ? "" : String(draft.price),
          affiliateUrl: offerUrl,
          inStock: draft.inStock ?? true,
        },
        ...rest,
      ];
    });
  }

  async function runFetch() {
    setFetching(true);
    setRefusal(null);
    setFetched(null);
    setError(null);
    try {
      const result = await ingestFetch(url.trim());
      applyPrefill(result.draft, result.retailerDisplay);
      setFetched({ retailerName: result.retailerDisplay, warnings: result.warnings });
    } catch (err) {
      const e = err as IngestError;
      const code = e?.code ?? "INTERNAL";
      const { guidance } = ingestGuidance(code);
      setRefusal({ code, message: errorMessage(err), guidance, upstreamStatus: e?.upstreamStatus ?? null });
      // FR-47: whatever was readable still fills the form, and for the codes
      // where the link is a valid offer, the URL lands in the offer row.
      if (e?.partialDraft || keepsUrlAsOffer(code)) {
        applyPrefill(e?.partialDraft ?? {}, e?.retailerDisplay ?? null);
      }
    } finally {
      setFetching(false);
    }
  }

  async function submit(input: GearInput) {
    if (!offersValid) {
      setError("Add at least one retailer with a price and an http or https link.");
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
    <div className="ak-gear-create">
      <PageHeader
        breadcrumbs={[{ label: "Catalog", to: "/gear" }, { label: "Gear", to: "/gear" }, { label: "Add gear" }]}
        title="Add gear"
        description="One product, priced per retailer. Shoppers see the cheapest in stock offer first and leave to the retailer to buy."
      />

      <Card>
        <h3 className="ak-gear-section-title">Start from a link</h3>
        <p className="ak-gear-section-note">
          Paste a product page. We read what we can and fill the form below. Nothing is saved until you press save.
        </p>
        <div className="ak-gear-link-row">
          <Field label="Product page URL">
            <Input value={url} onChange={setUrl} placeholder="https://www.decathlon.in/p/..." />
          </Field>
          <Button variant="secondary" disabled={!canFetch} onClick={runFetch} loading={fetching}>
            {fetching ? <Loader2 size={16} strokeWidth={1.75} /> : <Link2 size={16} strokeWidth={1.75} />}
            {fetching ? "Reading" : "Read the page"}
          </Button>
        </div>

        {fetched ? (
          <div className="ak-gear-ingest-result">
            <Badge tone="success">Filled in below</Badge>
            {fetched.retailerName ? <Badge tone="neutral">{fetched.retailerName}</Badge> : null}
            {fetched.warnings.map((w) => (
              <Badge key={w} tone="warning">
                {w}
              </Badge>
            ))}
          </div>
        ) : null}

        {refusal ? (
          <div className="ak-gear-ingest-refusal" role="status">
            <div className="ak-gear-ingest-result">
              <Badge tone="warning">{refusal.code}</Badge>
              {refusal.upstreamStatus ? <Badge tone="neutral">{`HTTP ${refusal.upstreamStatus}`}</Badge> : null}
            </div>
            <p className="ak-gear-ingest-message">{refusal.message}</p>
            <p className="ak-gear-section-note">{refusal.guidance}</p>
          </div>
        ) : null}
      </Card>

      {error ? (
        <Card className="ak-gear-error-card">
          <p className="ak-gear-ingest-message">{error}</p>
        </Card>
      ) : null}

      <Card>
        <h3 className="ak-gear-section-title">Retailers</h3>
        <div className="ak-gear-offers">
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
          <p className="ak-gear-section-note">
            Each retailer needs a name, a price of zero or more, and a link starting with http or https.
          </p>
        ) : null}
      </Card>

      <GearForm
        key={prefill.nonce}
        initial={prefill.initial}
        categories={categories}
        submitLabel="Create gear item"
        busy={busy || !offersValid}
        onSubmit={submit}
      />
    </div>
  );
}
