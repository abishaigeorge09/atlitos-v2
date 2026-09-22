import { formatINR } from "@atlitos/theme";
import { useNotification } from "@refinedev/core";
import { Check, Eye, EyeOff, ImageOff, RefreshCw, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Badge } from "../../components/kit/Badge";
import { Button } from "../../components/kit/Button";
import { Card } from "../../components/kit/Card";
import { ConfirmDialog, type ConfirmDialogHandle } from "../../components/kit/ConfirmDialog";
import { DataTable, type DataTableColumn } from "../../components/kit/DataTable";
import { PageHeader } from "../../components/kit/PageHeader";
import { Tabs } from "../../components/kit/Tabs";
import { Mono } from "../../components/mono";
import { fetchHealth, gearApi, needsAttention, recheckProduct, type CommerceError, type HealthRow } from "./api";
import { outcomeLabel, outcomeTone, relativeDays } from "./format";
import "./gear.css";

// Catalog health (FR-49, FR-50, ADR-011 D4). Every affiliate product, worst
// first: any offer gone/blocked, then unparsed, then price_changed/
// out_of_stock, then ok. Bulk delist/list run the existing audited RPC one
// call per selected product; Re-check now calls `gear-recheck` for one
// product and reloads that row.

type LoadState = "loading" | "error" | "ready";
type FilterKey = "attention" | "delisted" | "all";

const FILTERS: Array<{ key: FilterKey; label: string }> = [
  { key: "attention", label: "Needs attention" },
  { key: "delisted", label: "Delisted" },
  { key: "all", label: "All" },
];

function errorMessage(err: unknown): string {
  const e = err as CommerceError;
  return e?.message ?? "Something went wrong. Try again.";
}

export function GearHealth() {
  const { open } = useNotification();
  const [rows, setRows] = useState<HealthRow[]>([]);
  const [state, setState] = useState<LoadState>("loading");
  const [filter, setFilter] = useState<FilterKey>("attention");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [recheckingId, setRecheckingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bulkActive, setBulkActive] = useState(false);

  const bulkRef = useRef<ConfirmDialogHandle>(null);

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

  const kpis = useMemo(() => {
    const attention = rows.filter(needsAttention).length;
    const delisted = rows.filter((r) => !r.product.active).length;
    const noOffers = rows.filter((r) => r.offersTotal === 0).length;
    return { total: rows.length, attention, delisted, noOffers };
  }, [rows]);

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

  function confirmBulk(active: boolean) {
    setBulkActive(active);
    bulkRef.current?.open();
  }

  async function runBulk() {
    setBusy(true);
    setError(null);
    try {
      for (const id of selected) {
        await gearApi.setProductActive(id, bulkActive);
      }
      open?.({ type: "success", message: `${selected.size} offer${selected.size === 1 ? "" : "s"} ${bulkActive ? "listed" : "delisted"}.` });
      setSelected(new Set());
      bulkRef.current?.close();
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

  const columns: DataTableColumn<HealthRow>[] = [
    {
      key: "select",
      header: "",
      width: "40px",
      render: (row) => (
        <input
          type="checkbox"
          checked={selected.has(row.product.id)}
          onChange={() => toggle(row.product.id)}
          onClick={(event) => event.stopPropagation()}
          aria-label={`Select ${row.product.title}`}
        />
      ),
    },
    { key: "title", header: "Product", render: (row) => row.product.title },
    {
      key: "image",
      header: "Image",
      render: (row) =>
        row.product.image_path || row.product.image_url ? (
          <Check size={16} strokeWidth={1.75} color="var(--color-success)" />
        ) : (
          <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-xs)", color: "var(--color-text-tertiary)" }}>
            <ImageOff size={16} strokeWidth={1.75} />
            <X size={12} strokeWidth={2} />
          </span>
        ),
    },
    {
      key: "offers",
      header: "Offers alive",
      numeric: true,
      render: (row) => `${row.offersAlive} of ${row.offersTotal}`,
    },
    {
      key: "cheapest",
      header: "Cheapest",
      numeric: true,
      render: (row) => (row.cheapest ? formatINR(row.cheapest.price) : "None in stock"),
    },
    {
      key: "outcome",
      header: "Last outcome",
      render: (row) => <Badge tone={outcomeTone(row.worstOutcome)}>{outcomeLabel(row.worstOutcome)}</Badge>,
    },
    { key: "checked", header: "Checked", render: (row) => relativeDays(row.product.health_checked_at) },
    {
      key: "state",
      header: "State",
      render: (row) => <Badge tone={row.product.active ? "success" : "neutral"}>{row.product.active ? "Listed" : "Delisted"}</Badge>,
    },
    {
      key: "recheck",
      header: "",
      render: (row) => (
        <Button
          variant="secondary"
          disabled={recheckingId === row.product.id}
          onClick={(event) => {
            event.stopPropagation();
            void runRecheck(row.product.id);
          }}
        >
          <RefreshCw size={16} strokeWidth={1.75} />
          {recheckingId === row.product.id ? "Checking" : "Re-check"}
        </Button>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: "Catalog", to: "/gear" }, { label: "Catalog health" }]}
        title="Catalog health"
        description="Every affiliate product, worst first. A dead or unreadable offer needs a look before a shopper hits it."
      />

      {error ? (
        <Card>
          <p style={{ color: "var(--color-danger)", fontSize: "var(--text-sm)", margin: 0 }}>{error}</p>
        </Card>
      ) : null}

      <div className="ak-gear-kpi-row">
        <Card className="ak-gear-kpi-card">
          <span className="ak-gear-kpi-label">Total products</span>
          <Mono style={{ fontSize: "var(--type-numericLg-size)", fontWeight: 600 }}>{kpis.total}</Mono>
        </Card>
        <Card className="ak-gear-kpi-card">
          <span className="ak-gear-kpi-label">Needs attention</span>
          <Mono style={{ fontSize: "var(--type-numericLg-size)", fontWeight: 600 }}>{kpis.attention}</Mono>
        </Card>
        <Card className="ak-gear-kpi-card">
          <span className="ak-gear-kpi-label">Delisted</span>
          <Mono style={{ fontSize: "var(--type-numericLg-size)", fontWeight: 600 }}>{kpis.delisted}</Mono>
        </Card>
        <Card className="ak-gear-kpi-card">
          <span className="ak-gear-kpi-label">No offers</span>
          <Mono style={{ fontSize: "var(--type-numericLg-size)", fontWeight: 600 }}>{kpis.noOffers}</Mono>
        </Card>
      </div>

      <Tabs items={FILTERS.map((f) => ({ key: f.key, label: f.label }))} active={filter} onChange={(key) => setFilter(key as FilterKey)} />

      <div className="ak-gear-health-toolbar">
        <label className="ak-gear-instock-label">
          <input
            type="checkbox"
            checked={selected.size === filtered.length && filtered.length > 0}
            onChange={toggleAll}
          />
          Select all
        </label>
        {selected.size > 0 ? (
          <div style={{ display: "flex", gap: "var(--space-sm)", alignItems: "center" }}>
            <span style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)" }}>
              <Mono>{selected.size}</Mono> selected
            </span>
            <Button variant="secondary" disabled={busy} onClick={() => confirmBulk(false)}>
              <EyeOff size={16} strokeWidth={1.75} />
              Delist
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => confirmBulk(true)}>
              <Eye size={16} strokeWidth={1.75} />
              List
            </Button>
          </div>
        ) : null}
      </div>

      <DataTable
        columns={columns}
        rows={filtered}
        rowKey={(row) => row.product.id}
        rowHref={(row) => `/gear/show/${row.product.id}`}
        loading={state === "loading"}
        emptyTitle={state === "error" ? "Could not load catalog health" : "Nothing here"}
        emptyBody={state === "error" ? "Something went wrong reading health data. Try again." : "No product matches this filter."}
      />

      <ConfirmDialog
        ref={bulkRef}
        title={bulkActive ? "List these offers" : "Delist these offers"}
        body={bulkActive ? "These offers become visible to shoppers again for" : "These offers are hidden from shoppers for"}
        recordName={`${selected.size} offer${selected.size === 1 ? "" : "s"}`}
        confirmLabel={bulkActive ? "List" : "Delist"}
        danger={!bulkActive}
        onConfirm={() => void runBulk()}
        loading={busy}
      />
    </div>
  );
}
