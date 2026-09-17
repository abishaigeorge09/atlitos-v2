import { AlertTriangle, ArrowLeft, Eye, EyeOff, ExternalLink, Save, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";

import { Badge, Button, Card, EmptyState } from "../../components/ui";
import { Mono } from "../../components/mono";
import {
  fetchCategories,
  fetchGearItem,
  gearApi,
  type CategoryOption,
  type CommerceError,
  type GearInput,
  type GearWithOffers,
} from "./api";
import { EMPTY_OFFER, GearForm, OfferRow, offerDraftToInput, offerDraftValid, type OfferDraft } from "./form";

// Edit one gear item, list or delist it, and manage its retailer lines. Every
// mutation is a 0120 admin RPC with its own audit_log row. Adding a retailer
// that already exists on this item updates that line in place (the
// (product, retailer) unique index), which is how a price refresh is entered.

type LoadState = "loading" | "error" | "ready" | "not_found";

function errorMessage(err: unknown): string {
  const e = err as CommerceError;
  return e?.message ?? "Something went wrong. Try again.";
}

const label: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "var(--color-text-tertiary)",
  margin: 0,
};

export function GearShow() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [item, setItem] = useState<GearWithOffers | null>(null);
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [state, setState] = useState<LoadState>("loading");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(searchParams.get("error"));
  const [notice, setNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState<OfferDraft>({ ...EMPTY_OFFER });

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
    } catch {
      setState("error");
    }
  }

  useEffect(() => {
    void load();
    fetchCategories().then(setCategories).catch(() => setCategories([]));
  }, [id]);

  async function run(action: () => Promise<unknown>, successNotice: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      setNotice(successNotice);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (state === "loading") {
    return <div style={{ fontSize: 14, color: "var(--color-text-secondary)" }}>Loading gear item...</div>;
  }
  if (state === "not_found") {
    return (
      <Card>
        <EmptyState icon={<AlertTriangle size={32} strokeWidth={1.75} />} title="Gear item not found" description="This item does not exist or was removed." />
      </Card>
    );
  }
  if (state === "error" || !item) {
    return (
      <Card>
        <EmptyState icon={<AlertTriangle size={32} strokeWidth={1.75} />} title="Could not load this item" description="Something went wrong reading this item. Try again." />
      </Card>
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

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-lg)", maxWidth: 880 }}>
      <button
        type="button"
        onClick={() => navigate("/gear")}
        style={{ display: "flex", alignItems: "center", gap: "var(--space-xs)", border: "none", background: "none", color: "var(--color-text-secondary)", fontSize: 14, cursor: "pointer", padding: 0, alignSelf: "flex-start" }}
      >
        <ArrowLeft size={16} strokeWidth={1.75} />
        Back to gear
      </button>

      {error ? (
        <Card style={{ borderColor: "var(--color-danger)", padding: "var(--space-md) var(--space-lg)" }}>
          <p style={{ fontSize: 14, color: "var(--color-danger)", margin: 0 }}>{error}</p>
        </Card>
      ) : null}
      {notice ? (
        <Card style={{ borderColor: "var(--color-success)", padding: "var(--space-md) var(--space-lg)" }}>
          <p style={{ fontSize: 14, color: "var(--color-success)", margin: 0 }}>{notice}</p>
        </Card>
      ) : null}

      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "var(--space-md)" }}>
          <div>
            <p style={label}>Gear item</p>
            <h1 style={{ fontSize: 20, fontWeight: 700, margin: "var(--space-xs) 0 0" }}>{current.title}</h1>
            <p style={{ fontSize: 13, color: "var(--color-text-secondary)", margin: "var(--space-xs) 0 0" }}>
              {current.brand ?? "No brand"}, {current.sport ?? "any sport"}. <Mono style={{ fontWeight: 600 }}>{current.offers.length}</Mono> retailer{current.offers.length === 1 ? "" : "s"}.
            </p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)" }}>
            <Badge tone={current.active ? "success" : "neutral"}>{current.active ? "listed" : "delisted"}</Badge>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() =>
                run(
                  () => gearApi.setProductActive(current.id, !current.active),
                  current.active ? "Item hidden from shoppers." : "Item visible to shoppers again.",
                )
              }
            >
              {current.active ? <EyeOff size={16} strokeWidth={1.75} /> : <Eye size={16} strokeWidth={1.75} />}
              {current.active ? "Delist" : "List"}
            </Button>
          </div>
        </div>
      </Card>

      <Card>
        <p style={{ ...label, marginBottom: "var(--space-md)" }}>Retailers, cheapest first</p>
        {current.offers.length === 0 ? (
          <p style={{ fontSize: 14, color: "var(--color-text-secondary)", margin: "0 0 var(--space-md)" }}>
            No retailer yet. Shoppers cannot buy this item until one is added.
          </p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "var(--space-md)" }}>
            <tbody>
              {current.offers.map((offer) => (
                <tr key={offer.id} style={{ borderBottom: "1px solid var(--color-border)" }}>
                  <td style={{ padding: "var(--space-sm) 0", fontSize: 14, fontWeight: 600 }}>{offer.retailer}</td>
                  <td style={{ padding: "var(--space-sm) var(--space-md)", fontSize: 14 }}>
                    <Mono>INR {Number(offer.price).toLocaleString("en-IN")}</Mono>
                  </td>
                  <td style={{ padding: "var(--space-sm) var(--space-md)" }}>
                    <Badge tone={offer.in_stock ? "success" : "warning"}>{offer.in_stock ? "in stock" : "out of stock"}</Badge>
                  </td>
                  <td style={{ padding: "var(--space-sm) var(--space-md)", fontSize: 13 }}>
                    <a href={offer.affiliate_url} target="_blank" rel="noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-xs)", color: "var(--color-accent)" }}>
                      <ExternalLink size={14} strokeWidth={1.75} />
                      Open link
                    </a>
                  </td>
                  <td style={{ padding: "var(--space-sm) 0", textAlign: "right" }}>
                    <Button
                      variant="secondary"
                      disabled={busy}
                      aria-label={`Remove ${offer.retailer}`}
                      onClick={() => run(() => gearApi.deleteOffer(offer.id), `${offer.retailer} removed.`)}
                    >
                      <Trash2 size={16} strokeWidth={1.75} />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <p style={{ ...label, marginBottom: "var(--space-sm)" }}>Add or update a retailer</p>
        <OfferRow draft={draft} onChange={setDraft} />
        <div style={{ marginTop: "var(--space-md)" }}>
          <Button disabled={busy || !offerDraftValid(draft)} onClick={addOffer}>
            <Save size={16} strokeWidth={1.75} />
            Save retailer
          </Button>
        </div>
      </Card>

      <Card>
        <p style={{ ...label, marginBottom: "var(--space-md)" }}>Product</p>
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
    </div>
  );
}
