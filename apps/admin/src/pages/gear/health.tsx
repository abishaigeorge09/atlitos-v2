import { AlertTriangle, Check, Eye, EyeOff, HeartPulse, ImageOff, RefreshCw, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { Badge, Button, Card, EmptyState } from "../../components/ui";
import { Mono } from "../../components/mono";
import { fetchHealth, gearApi, needsAttention, recheckProduct, type CommerceError, type HealthRow } from "./api";
import { outcomeLabel, outcomeTone, relativeDays } from "./format";

// Catalog health (FR-49, FR-50, ADR-011 D4). Every affiliate product, worst
// first: any offer gone/blocked, then unparsed, then price_changed/
// out_of_stock, then ok. Bulk delist/list run the existing audited RPC one
// call per selected product; Re-check now calls `gear-recheck` for one
// product and reloads that row.

type LoadState = "loading" | "error" | "ready";
type FilterKey = "attention" | "delisted" | "all";

const FILTERS: Array<{ key: FilterKey; label: string }> = [
  { key: "attention", label: "Attention" },
  { key: "delisted", label: "Delisted" },
  { key: "all", label: "All" },
];

const cell: React.CSSProperties = { padding: "var(--space-md) var(--space-lg)", fontSize: 14 };

function errorMessage(err: unknown): string {
  const e = err as CommerceError;
  return e?.message ?? "Something went wrong. Try again.";
}

export function GearHealth() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<HealthRow[]>([]);
  const [state, setState] = useState<LoadState>("loading");
  const [filter, setFilter] = useState<FilterKey>("attention");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [recheckingId, setRecheckingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setState("loading");
    try {
      const data = await fetchHealth();
      setRows(data);
      setState("ready");
    } catch {
      setState("error");
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const filtered = useMemo(() => {
    if (filter === "all") return rows;
    if (filter === "delisted") return rows.filter((r) => !r.product.active);
    return rows.filter(needsAttention);
  }, [rows, filter]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) => (prev.size === filtered.length ? new Set() : new Set(filtered.map((r) => r.product.id))));
  }

  async function bulkSetActive(active: boolean) {
    setBusy(true);
    setError(null);
    try {
      for (const id of selected) {
        await gearApi.setProductActive(id, active);
      }
      setSelected(new Set());
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function runRecheck(productId: string) {
    setRecheckingId(productId);
    setError(null);
    try {
      await recheckProduct(productId);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setRecheckingId(null);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-lg)" }}>
      <div>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0, letterSpacing: "-0.4px" }}>Catalog health</h1>
        <p style={{ fontSize: 14, color: "var(--color-text-secondary)", margin: "var(--space-xs) 0 0" }}>
          Every affiliate product, worst first. A dead or unreadable offer needs a look before a shopper hits it.
        </p>
      </div>

      {error ? (
        <Card style={{ borderColor: "var(--color-danger)", padding: "var(--space-md) var(--space-lg)" }}>
          <p style={{ fontSize: 14, color: "var(--color-danger)", margin: 0 }}>{error}</p>
        </Card>
      ) : null}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "var(--space-md)" }}>
        <div style={{ display: "flex", gap: "var(--space-xs)" }}>
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              style={{
                padding: "var(--space-xs) var(--space-md)",
                borderRadius: "var(--radius-pill)",
                border: filter === f.key ? "1px solid var(--color-accent)" : "1px solid var(--color-border)",
                backgroundColor: filter === f.key ? "var(--color-accent-tint)" : "transparent",
                color: filter === f.key ? "var(--color-accent)" : "var(--color-text-secondary)",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              {f.label}
            </button>
          ))}
        </div>

        {selected.size > 0 ? (
          <div style={{ display: "flex", gap: "var(--space-sm)", alignItems: "center" }}>
            <span style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
              <Mono>{selected.size}</Mono> selected
            </span>
            <Button variant="secondary" disabled={busy} onClick={() => bulkSetActive(false)}>
              <EyeOff size={16} strokeWidth={1.75} />
              Delist
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => bulkSetActive(true)}>
              <Eye size={16} strokeWidth={1.75} />
              List
            </Button>
          </div>
        ) : null}
      </div>

      <Card style={{ padding: 0 }}>
        {state === "loading" ? (
          <div style={{ padding: "var(--space-2xl)", color: "var(--color-text-secondary)", fontSize: 14 }}>Loading catalog health...</div>
        ) : state === "error" ? (
          <EmptyState icon={<AlertTriangle size={32} strokeWidth={1.75} />} title="Could not load catalog health" description="Something went wrong reading health data. Try again." />
        ) : filtered.length === 0 ? (
          <EmptyState icon={<HeartPulse size={32} strokeWidth={1.75} />} title="Nothing here" description="No product matches this filter." />
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid var(--color-border)" }}>
                <th style={{ padding: "var(--space-sm) var(--space-lg)" }}>
                  <input type="checkbox" checked={selected.size === filtered.length && filtered.length > 0} onChange={toggleAll} />
                </th>
                {["Product", "Image", "Offers alive", "Cheapest", "Last outcome", "Last checked", "State", ""].map((heading) => (
                  <th
                    key={heading}
                    style={{
                      padding: "var(--space-sm) var(--space-lg)",
                      fontSize: 12,
                      fontWeight: 600,
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                      color: "var(--color-text-tertiary)",
                    }}
                  >
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => (
                <tr key={row.product.id} style={{ borderBottom: "1px solid var(--color-border)" }}>
                  <td style={{ padding: "var(--space-md) var(--space-lg)" }}>
                    <input type="checkbox" checked={selected.has(row.product.id)} onChange={() => toggle(row.product.id)} />
                  </td>
                  <td style={{ ...cell, fontWeight: 600, cursor: "pointer" }} onClick={() => navigate(`/gear/show/${row.product.id}`)}>
                    {row.product.title}
                  </td>
                  <td style={cell}>
                    {row.product.image_path || row.product.image_url ? (
                      <Check size={16} strokeWidth={1.75} color="var(--color-success)" />
                    ) : (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-xs)", color: "var(--color-text-tertiary)" }}>
                        <ImageOff size={16} strokeWidth={1.75} />
                        <X size={12} strokeWidth={2} />
                      </span>
                    )}
                  </td>
                  <td style={cell}>
                    <Mono>
                      {row.offersAlive} of {row.offersTotal}
                    </Mono>
                  </td>
                  <td style={cell}>
                    {row.cheapest ? (
                      <>
                        <Mono>
                          {row.cheapest.currency} {row.cheapest.price.toLocaleString("en-IN")}
                        </Mono>
                        <span style={{ color: "var(--color-text-tertiary)", fontSize: 12, marginLeft: "var(--space-xs)" }}>
                          {relativeDays(row.cheapest.offer.last_checked_at)}
                        </span>
                      </>
                    ) : (
                      <span style={{ color: "var(--color-text-tertiary)" }}>none in stock</span>
                    )}
                  </td>
                  <td style={cell}>
                    <Badge tone={outcomeTone(row.worstOutcome)}>{outcomeLabel(row.worstOutcome)}</Badge>
                  </td>
                  <td style={cell}>{relativeDays(row.product.health_checked_at)}</td>
                  <td style={cell}>
                    <Badge tone={row.product.active ? "success" : "neutral"}>{row.product.active ? "listed" : "delisted"}</Badge>
                  </td>
                  <td style={{ ...cell, textAlign: "right" }}>
                    <Button variant="secondary" disabled={recheckingId === row.product.id} onClick={() => runRecheck(row.product.id)}>
                      <RefreshCw size={16} strokeWidth={1.75} />
                      {recheckingId === row.product.id ? "Checking" : "Re-check now"}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
