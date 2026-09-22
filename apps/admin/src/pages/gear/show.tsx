import { formatINR } from "@atlitos/theme";
import { useNotification } from "@refinedev/core";
import { ExternalLink, EyeOff, Eye, Package, RefreshCw, Sparkles, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";

import { Badge } from "../../components/kit/Badge";
import { Button } from "../../components/kit/Button";
import { Card } from "../../components/kit/Card";
import { ConfirmDialog, type ConfirmDialogHandle } from "../../components/kit/ConfirmDialog";
import { DetailLayout } from "../../components/kit/DetailLayout";
import { Field } from "../../components/kit/Field";
import { PageHeader } from "../../components/kit/PageHeader";
import { DetailSkeleton } from "../../components/kit/Skeleton";
import { EmptyState } from "../../components/kit/EmptyState";
import { Mono } from "../../components/mono";
import { statusLabel, statusTone } from "../../lib/status";
import {
  fetchCategories,
  fetchGearItem,
  fetchLatestSuggestions,
  gearApi,
  recheckProduct,
  type CategoryOption,
  type CommerceError,
  type FetchLogSuggestion,
  type GearInput,
  type GearWithOffers,
  type HealthOfferRow,
} from "./api";
import { EMPTY_OFFER, GearForm, OfferRow, offerDraftToInput, offerDraftValid, type OfferDraft } from "./form";
import { outcomeLabel, outcomeTone, relativeDays } from "./format";
import "./gear.css";

// Edit one gear item, list or delist it, and manage its retailer lines. Every
// mutation is a 0120 admin RPC with its own audit_log row. Adding a retailer
// that already exists on this item updates that line in place (the
// (product, retailer) unique index), which is how a price refresh is entered.

type LoadState = "loading" | "error" | "ready" | "not_found";

function errorMessage(err: unknown): string {
  const e = err as CommerceError;
  return e?.message ?? "Something went wrong. Try again.";
}

export function GearShow() {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const { open } = useNotification();

  const [item, setItem] = useState<GearWithOffers | null>(null);
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [state, setState] = useState<LoadState>("loading");
  const [busy, setBusy] = useState(false);
  const [recheckingOffer, setRecheckingOffer] = useState(false);
  const [error, setError] = useState<string | null>(searchParams.get("error"));
  const [draft, setDraft] = useState<OfferDraft>({ ...EMPTY_OFFER });
  const [suggestion, setSuggestion] = useState<FetchLogSuggestion | null>(null);
  const [offerToDelete, setOfferToDelete] = useState<HealthOfferRow | null>(null);

  const deleteOfferRef = useRef<ConfirmDialogHandle>(null);
  const listStatusRef = useRef<ConfirmDialogHandle>(null);

  async function load() {
    if (!id) return;
    setState("loading");
    try {
      const row = await fetchGearItem(id);
      if (!row) {
        setState("not_found");
        return;
      }
      setItem(row);
      setState("ready");
      fetchLatestSuggestions(id)
        .then(setSuggestion)
        .catch(() => setSuggestion(null));
    } catch {
      setState("error");
    }
  }

  useEffect(() => {
    void load();
    fetchCategories().then(setCategories).catch(() => setCategories([]));
  }, [id]);

  async function runRecheck() {
    if (!id) return;
    setRecheckingOffer(true);
    setError(null);
    try {
      await recheckProduct(id);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setRecheckingOffer(false);
    }
  }

  async function run(action: () => Promise<unknown>, successMessage: string) {
    setBusy(true);
    setError(null);
    try {
      await action();
      open?.({ type: "success", message: successMessage });
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (state === "loading") {
    return (
      <div>
        <PageHeader breadcrumbs={[{ label: "Catalog", to: "/gear" }, { label: "Gear" }]} title="Loading" />
        <DetailSkeleton />
      </div>
    );
  }
  if (state === "not_found") {
    return (
      <div>
        <PageHeader breadcrumbs={[{ label: "Catalog", to: "/gear" }, { label: "Gear" }]} title="Not found" />
        <Card>
          <EmptyState title="Gear item not found" body="This item does not exist or was removed." />
        </Card>
      </div>
    );
  }
  if (state === "error" || !item) {
    return (
      <div>
        <PageHeader breadcrumbs={[{ label: "Catalog", to: "/gear" }, { label: "Gear" }]} title="Could not load" />
        <Card>
          <EmptyState title="Could not load this item" body="Something went wrong reading this item. Try again." />
        </Card>
      </div>
    );
  }

  const current = item;

  function saveProduct(input: GearInput) {
    void run(() => gearApi.upsertProduct({ ...input, id: current.id }), "Gear item saved.");
  }

  function addOffer() {
    if (!offerDraftValid(draft)) return;
    void run(async () => {
      await gearApi.upsertOffer(current.id, offerDraftToInput(draft));
      setDraft({ ...EMPTY_OFFER });
    }, "Retailer saved.");
  }

  function confirmDeleteOffer(offer: HealthOfferRow) {
    setOfferToDelete(offer);
    deleteOfferRef.current?.open();
  }

  function runDeleteOffer() {
    if (!offerToDelete) return;
    void run(() => gearApi.deleteOffer(offerToDelete.id), `${offerToDelete.retailer} removed.`).then(() => {
      deleteOfferRef.current?.close();
      setOfferToDelete(null);
    });
  }

  function runToggleActive() {
    void run(
      () => gearApi.setProductActive(current.id, !current.active),
      current.active ? "Item delisted." : "Item listed again.",
    ).then(() => listStatusRef.current?.close());
  }

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: "Catalog", to: "/gear" }, { label: "Gear", to: "/gear" }]}
        title={current.title}
        description={`${current.brand ?? "No brand"}, ${current.sport ?? "any sport"}`}
        secondaryActions={
          <Button variant="secondary" disabled={recheckingOffer} onClick={runRecheck}>
            <RefreshCw size={16} strokeWidth={1.75} />
            {recheckingOffer ? "Checking" : "Re-check now"}
          </Button>
        }
      />

      {error ? (
        <Card>
          <p style={{ color: "var(--color-danger)", fontSize: "var(--text-sm)", margin: 0 }}>{error}</p>
        </Card>
      ) : null}

      <DetailLayout
        main={
          <>
            <Card>
              <div className="ak-gear-detail-image">
                {current.image_url ? <img src={current.image_url} alt="" /> : <Package size={32} strokeWidth={1.5} />}
              </div>
              {current.description ? <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)" }}>{current.description}</p> : null}
            </Card>

            <Card>
              <h3 className="ak-gear-section-title">Offers</h3>
              {current.offers.length === 0 ? (
                <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)" }}>
                  No retailer yet. Shoppers cannot buy this item until one is added.
                </p>
              ) : (
                <table className="ak-gear-offers-table">
                  <thead>
                    <tr>
                      <th>Retailer</th>
                      <th className="ak-gear-numeric">Price</th>
                      <th>Stock</th>
                      <th>Health</th>
                      <th>Checked</th>
                      <th>Link</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {current.offers.map((offer) => (
                      <tr key={offer.id}>
                        <td>{offer.retailer}</td>
                        <td className="ak-gear-numeric">
                          <Mono>{formatINR(Number(offer.price))}</Mono>
                        </td>
                        <td>
                          <Badge tone={offer.in_stock ? "success" : "warning"}>{offer.in_stock ? "In stock" : "Out of stock"}</Badge>
                        </td>
                        <td>
                          <Badge tone={outcomeTone(offer.last_check_outcome)}>{outcomeLabel(offer.last_check_outcome)}</Badge>
                        </td>
                        <td>{relativeDays(offer.last_checked_at)}</td>
                        <td>
                          <a href={offer.affiliate_url} target="_blank" rel="noreferrer" className="ak-gear-offer-link">
                            <ExternalLink size={14} strokeWidth={1.75} />
                            Open link
                          </a>
                        </td>
                        <td style={{ textAlign: "right" }}>
                          <Button variant="secondary" disabled={busy} aria-label={`Delete ${offer.retailer}`} onClick={() => confirmDeleteOffer(offer)}>
                            <Trash2 size={16} strokeWidth={1.75} />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              <h3 className="ak-gear-section-title" style={{ marginTop: "var(--space-lg)" }}>
                Add or update a retailer
              </h3>
              <OfferRow draft={draft} onChange={setDraft} />
              <div style={{ marginTop: "var(--space-md)" }}>
                <Button disabled={busy || !offerDraftValid(draft)} onClick={addOffer}>
                  Save retailer
                </Button>
              </div>
            </Card>

            {suggestion ? (
              <Card>
                <h3 className="ak-gear-section-title" style={{ display: "flex", alignItems: "center", gap: "var(--space-xs)" }}>
                  <Sparkles size={14} strokeWidth={1.75} />
                  AI suggestion
                </h3>
                <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-xs)", marginBottom: "var(--space-md)" }}>
                  {Object.entries(suggestion.suggestion).map(([key, value]) => (
                    <p key={key} style={{ fontSize: "var(--text-sm)", margin: 0 }}>
                      <span style={{ fontWeight: 600, textTransform: "capitalize" }}>{key.replace(/([A-Z])/g, " $1").trim()}</span>: {String(value)}
                    </p>
                  ))}
                </div>
                <p style={{ fontSize: "var(--text-xs)", color: "var(--color-text-secondary)", margin: 0 }}>
                  Fetched {relativeDays(suggestion.fetchedAt)}. Suggestion only, nothing was changed.
                </p>
              </Card>
            ) : null}

            <Card>
              <h3 className="ak-gear-section-title">Edit product</h3>
              <GearForm
                key={current.updated_at}
                categories={categories}
                initial={{
                  title: current.title,
                  brand: current.brand,
                  sport: current.sport,
                  categoryId: current.category_id,
                  skillLevel: current.skill_level,
                  ageRange: current.age_range,
                  description: current.description,
                  imageUrl: current.image_url,
                }}
                submitLabel="Save gear item"
                busy={busy}
                onSubmit={saveProduct}
              />
            </Card>
          </>
        }
        side={
          <Card>
            <Field label="Status">
              <Badge tone={current.active ? "success" : "neutral"}>{current.active ? "Listed" : "Delisted"}</Badge>
            </Field>
            <div className="ak-gear-metadata-row">
              <span className="ak-gear-metadata-label">Sport</span>
              <span className="ak-gear-metadata-value">{current.sport ?? "Any"}</span>
            </div>
            <div className="ak-gear-metadata-row">
              <span className="ak-gear-metadata-label">Brand</span>
              <span className="ak-gear-metadata-value">{current.brand ?? "No brand"}</span>
            </div>
            <div className="ak-gear-metadata-row">
              <span className="ak-gear-metadata-label">Retailers</span>
              <span className="ak-gear-metadata-value">
                <Mono>{current.offers.length}</Mono>
              </span>
            </div>
            <div className="ak-gear-metadata-row">
              <span className="ak-gear-metadata-label">Health</span>
              <Badge tone={statusTone(current.health_status)}>{statusLabel(current.health_status)}</Badge>
            </div>
            <div className="ak-gear-metadata-row">
              <span className="ak-gear-metadata-label">Created</span>
              <span className="ak-gear-metadata-value">{relativeDays(current.created_at)}</span>
            </div>
            <div className="ak-gear-metadata-row">
              <span className="ak-gear-metadata-label">Updated</span>
              <span className="ak-gear-metadata-value">{relativeDays(current.updated_at)}</span>
            </div>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => listStatusRef.current?.open()}
              style={{ marginTop: "var(--space-lg)", width: "100%" }}
            >
              {current.active ? <EyeOff size={16} strokeWidth={1.75} /> : <Eye size={16} strokeWidth={1.75} />}
              {current.active ? "Delist" : "Relist"}
            </Button>
          </Card>
        }
      />

      <ConfirmDialog
        ref={deleteOfferRef}
        title="Delete this offer"
        body="This removes the offer from the product page. This cannot be undone for"
        recordName={offerToDelete ? `${offerToDelete.retailer}, ${formatINR(Number(offerToDelete.price))}` : undefined}
        confirmLabel="Delete offer"
        onConfirm={runDeleteOffer}
        loading={busy}
      />

      <ConfirmDialog
        ref={listStatusRef}
        title={current.active ? "Delist this product" : "Relist this product"}
        body={
          current.active
            ? "Shoppers will no longer see this product in the shop for"
            : "This product becomes visible to shoppers again for"
        }
        recordName={current.title}
        confirmLabel={current.active ? "Delist" : "Relist"}
        danger={current.active}
        onConfirm={runToggleActive}
        loading={busy}
      />
    </div>
  );
}
