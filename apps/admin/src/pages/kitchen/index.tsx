import { AlertTriangle, ImageOff, Link2, Package, Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { Badge } from "../../components/kit/Badge";
import { Button } from "../../components/kit/Button";
import { Card } from "../../components/kit/Card";
import { ConfirmDialog, type ConfirmDialogHandle } from "../../components/kit/ConfirmDialog";
import { DataTable, type DataTableColumn } from "../../components/kit/DataTable";
import { DetailLayout } from "../../components/kit/DetailLayout";
import { Field } from "../../components/kit/Field";
import { FilterBar } from "../../components/kit/FilterBar";
import { Input } from "../../components/kit/Input";
import { PageHeader } from "../../components/kit/PageHeader";
import { SaveBar } from "../../components/kit/SaveBar";
import { Select } from "../../components/kit/Select";
import { DetailSkeleton, TableSkeleton } from "../../components/kit/Skeleton";
import { Tabs } from "../../components/kit/Tabs";
import { Textarea } from "../../components/kit/Textarea";
import { Mono } from "../../components/mono";
import { statusLabel, statusTone } from "../../lib/status";
import { SAMPLE_GEAR_ROWS, SAMPLE_SPARSE_ROW, type SampleGearRow } from "./data";
import "./kitchen.css";
import { TokenReadout } from "./tokens";

function Section({ id, title, note, children }: { id: string; title: string; note?: string; children: ReactNode }) {
  return (
    <section id={id} className="ak-kitchen-section">
      <h2 className="ak-kitchen-section-title">{title}</h2>
      {note ? <p className="ak-kitchen-section-note">{note}</p> : null}
      <div className="ak-kitchen-section-body">{children}</div>
    </section>
  );
}

function Pair({ full, sparse }: { full: ReactNode; sparse: ReactNode }) {
  return (
    <div className="ak-kitchen-pair">
      <div className="ak-kitchen-pair-item">
        <p className="ak-kitchen-pair-label">Full</p>
        {full}
      </div>
      <div className="ak-kitchen-pair-item">
        <p className="ak-kitchen-pair-label">Sparse</p>
        {sparse}
      </div>
    </div>
  );
}

const gearColumns: DataTableColumn<SampleGearRow>[] = [
  { key: "title", header: "Product", render: (row) => (
    <div className="ak-kitchen-gear-title">
      <span>{row.title}</span>
      <span className="ak-kitchen-gear-meta">{row.brand} - {row.sport}</span>
    </div>
  ) },
  { key: "price", header: "Price", numeric: true, render: (row) => `Rs ${row.priceInr.toLocaleString("en-IN")}` },
  { key: "offers", header: "Offers", numeric: true, render: (row) => row.offerCount },
  { key: "status", header: "Status", render: (row) => <Badge tone={statusTone(row.status)}>{statusLabel(row.status)}</Badge> },
  { key: "checked", header: "Freshness", render: (row) => <span className="ak-kitchen-gear-freshness">{row.checkedAgo}</span> },
];

export function KitchenSink() {
  useEffect(() => {
    document.title = "Kitchen sink, Atlitos Admin";
  }, []);

  const [search, setSearch] = useState("");
  const [filterSport, setFilterSport] = useState("");
  const [gearTab, setGearTab] = useState("all");
  const confirmRef = useRef<ConfirmDialogHandle>(null);

  const [formTitle, setFormTitle] = useState("");
  const [formPriceTouched, setFormPriceTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const dirty = formTitle.length > 0;

  return (
    <div className="ak-kitchen">
      <p className="ak-kitchen-eyebrow">Staff reference, not part of the product</p>
      <h1 className="ak-kitchen-title">Kitchen sink</h1>
      <p className="ak-kitchen-lead">
        Every shared component, drawn from whichever tokens are live in the shell around this
        page. Data below is static sample data for layout review only.
      </p>

      <Section id="tokens" title="1. Tokens" note="Read from the document at runtime, so they cannot drift from what is applied.">
        <TokenReadout />
      </Section>

      <Section id="primitives" title="2. Primitives" note="Every primitive twice, once populated and once nearly empty.">
        <h3 className="ak-kitchen-subhead">Buttons</h3>
        <div className="ak-kitchen-row">
          <Button variant="primary">Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger">Danger</Button>
          <Button variant="primary" size="sm">Small</Button>
          <Button variant="primary" loading>Saving</Button>
          <Button variant="primary" disabled>Disabled</Button>
        </div>

        <h3 className="ak-kitchen-subhead">Badges, the full vocabulary</h3>
        <div className="ak-kitchen-row">
          <Badge tone="neutral">Neutral</Badge>
          <Badge tone="success">Success</Badge>
          <Badge tone="warning">Warning</Badge>
          <Badge tone="danger">Danger</Badge>
        </div>

        <h3 className="ak-kitchen-subhead">Form controls</h3>
        <Pair
          full={
            <Card>
              <div className="ak-kitchen-form-stack">
                <Field label="Product title" hint="Shown on the gear list and detail page.">
                  <Input value="Yonex Voltric Junior Badminton Racket" onChange={() => {}} />
                </Field>
                <Field label="Price, INR">
                  <Input value="1899" mono onChange={() => {}} />
                </Field>
                <Field label="Sport">
                  <Select value="badminton" onChange={() => {}} options={[{ value: "badminton", label: "Badminton" }]} />
                </Field>
                <Field label="Notes" error="A rejection reason is required.">
                  <Textarea value="" onChange={() => {}} placeholder="Optional internal note" />
                </Field>
              </div>
            </Card>
          }
          sparse={
            <Card>
              <div className="ak-kitchen-form-stack">
                <Field label="Product title" hint="Shown on the gear list and detail page.">
                  <Input value="" placeholder="Untitled product" onChange={() => {}} />
                </Field>
                <Field label="Price, INR">
                  <Input value="" placeholder="0" mono onChange={() => {}} />
                </Field>
              </div>
            </Card>
          }
        />

        <h3 className="ak-kitchen-subhead">Tabs</h3>
        <Tabs
          items={[
            { key: "all", label: "All", count: 8 },
            { key: "attention", label: "Needs attention", count: 2 },
          ]}
          active={gearTab}
          onChange={setGearTab}
        />
      </Section>

      <Section id="gear-list" title="3. Gear list" note="PageHeader, FilterBar, DataTable. Full, sparse, filtered empty, true empty, skeleton.">
        <p className="ak-kitchen-pair-label">Populated (8 rows)</p>
        <PageHeader
          breadcrumbs={[{ label: "Catalog" }, { label: "Gear" }]}
          title="Gear"
          description="Affiliate products shown in the shop, with the retailer offers behind each one."
          primaryAction={<Button variant="primary"><Plus size={16} strokeWidth={1.75} />Add gear</Button>}
        />
        <FilterBar
          searchValue={search}
          onSearchChange={setSearch}
          searchPlaceholder="Search gear by name"
          filters={
            <Select
              value={filterSport}
              onChange={setFilterSport}
              placeholder="All sports"
              options={[
                { value: "badminton", label: "Badminton" },
                { value: "tennis", label: "Tennis" },
                { value: "cricket", label: "Cricket" },
                { value: "football", label: "Football" },
              ]}
            />
          }
          resultCount={SAMPLE_GEAR_ROWS.length}
          resultNoun="products"
        />
        <DataTable columns={gearColumns} rows={SAMPLE_GEAR_ROWS} rowKey={(row) => row.id} rowHref={() => "#"} />

        <p className="ak-kitchen-pair-label" style={{ marginTop: "var(--space-2xl)" }}>Sparse (1 row)</p>
        <DataTable columns={gearColumns} rows={SAMPLE_SPARSE_ROW} rowKey={(row) => row.id} />

        <p className="ak-kitchen-pair-label" style={{ marginTop: "var(--space-2xl)" }}>Filtered empty</p>
        <DataTable
          columns={gearColumns}
          rows={[]}
          rowKey={(row) => row.id}
          emptyTitle="No products match this filter"
          emptyBody="Try a different sport or clear the search."
          emptyAction={<Button variant="secondary">Clear filters</Button>}
        />

        <p className="ak-kitchen-pair-label" style={{ marginTop: "var(--space-2xl)" }}>True empty</p>
        <DataTable
          columns={gearColumns}
          rows={[]}
          rowKey={(row) => row.id}
          emptyTitle="No gear yet"
          emptyBody="Add a product to start building the shop catalog."
          emptyAction={<Button variant="primary"><Plus size={16} strokeWidth={1.75} />Add gear</Button>}
        />

        <p className="ak-kitchen-pair-label" style={{ marginTop: "var(--space-2xl)" }}>Skeleton</p>
        <TableSkeleton columns={gearColumns.length} rows={5} />
      </Section>

      <Section id="gear-detail" title="4. Gear detail" note="DetailLayout, 2fr/1fr, sticky right column, single column under 1024px.">
        <p className="ak-kitchen-pair-label">Populated</p>
        <DetailLayout
          main={
            <>
              <Card>
                <h3 className="ak-kitchen-subhead" style={{ marginTop: 0 }}>Offers</h3>
                <table className="ak-kitchen-offers-table">
                  <thead>
                    <tr><th>Retailer</th><th style={{ textAlign: "right" }}>Price</th><th>Stock</th></tr>
                  </thead>
                  <tbody>
                    <tr><td>Amazon.in</td><td style={{ textAlign: "right" }}><Mono>Rs 1,899</Mono></td><td><Badge tone="success">In stock</Badge></td></tr>
                    <tr><td>Flipkart</td><td style={{ textAlign: "right" }}><Mono>Rs 1,949</Mono></td><td><Badge tone="success">In stock</Badge></td></tr>
                    <tr><td>Decathlon</td><td style={{ textAlign: "right" }}><Mono>Rs 2,099</Mono></td><td><Badge tone="warning">Out of stock</Badge></td></tr>
                  </tbody>
                </table>
              </Card>
              <Card>
                <h3 className="ak-kitchen-subhead" style={{ marginTop: 0 }}>Fetch log</h3>
                <ul className="ak-kitchen-fetch-log">
                  <li><Mono>2026-09-20 03:00</Mono> Re-checked, price unchanged</li>
                  <li><Mono>2026-09-19 03:00</Mono> Re-checked, price dropped Rs 1,999 to Rs 1,899</li>
                </ul>
              </Card>
            </>
          }
          side={
            <Card>
              <div className="ak-kitchen-image-tile">
                <Package size={32} strokeWidth={1.5} />
              </div>
              <div className="ak-kitchen-form-stack" style={{ marginTop: "var(--space-lg)" }}>
                <Field label="Status"><Badge tone="success">Ok</Badge></Field>
                <Field label="Sport"><span>Badminton</span></Field>
                <Field label="Offers"><Mono>3</Mono></Field>
              </div>
              <Button variant="secondary" style={{ marginTop: "var(--space-lg)", width: "100%" }}>Re-check now</Button>
            </Card>
          }
        />

        <p className="ak-kitchen-pair-label" style={{ marginTop: "var(--space-2xl)" }}>Sparse (no image, one offer)</p>
        <DetailLayout
          main={
            <Card>
              <h3 className="ak-kitchen-subhead" style={{ marginTop: 0 }}>Offers</h3>
              <table className="ak-kitchen-offers-table">
                <thead><tr><th>Retailer</th><th style={{ textAlign: "right" }}>Price</th><th>Stock</th></tr></thead>
                <tbody>
                  <tr><td>Amazon.in</td><td style={{ textAlign: "right" }}><Mono>Rs 2,499</Mono></td><td><Badge tone="success">In stock</Badge></td></tr>
                </tbody>
              </table>
            </Card>
          }
          side={
            <Card>
              <div className="ak-kitchen-image-tile ak-kitchen-image-tile-empty">
                <ImageOff size={32} strokeWidth={1.5} />
              </div>
              <div style={{ marginTop: "var(--space-lg)" }}>
                <Field label="Status"><Badge tone="neutral">Unchecked</Badge></Field>
              </div>
            </Card>
          }
        />

        <p className="ak-kitchen-pair-label" style={{ marginTop: "var(--space-2xl)" }}>Skeleton</p>
        <DetailSkeleton />
      </Section>

      <Section id="gear-create" title="5. Gear create" note="Sectioned form cards with a SaveBar; clean, dirty, invalid, saving. Plus Add from a link in its three outcomes.">
        <h3 className="ak-kitchen-subhead">Add from a link</h3>
        <div className="ak-kitchen-link-outcomes">
          <Card>
            <p className="ak-kitchen-pair-label">Fetched draft, prefilling the form</p>
            <Field label="Product URL"><Input value="https://www.decathlon.in/p/badminton-racket" onChange={() => {}} disabled /></Field>
            <div className="ak-kitchen-form-stack" style={{ marginTop: "var(--space-md)" }}>
              <Field label="Title"><Input value="Yonex Voltric Junior Badminton Racket" onChange={() => {}} /></Field>
              <Field label="Price, INR"><Input value="1899" mono onChange={() => {}} /></Field>
            </div>
          </Card>
          <Card>
            <p className="ak-kitchen-pair-label">Not found, partial prefill</p>
            <Field label="Product URL"><Input value="https://www.flipkart.com/p/unknown" onChange={() => {}} disabled /></Field>
            <p className="ak-kitchen-error-line" role="alert">
              <AlertTriangle size={14} strokeWidth={1.75} /> NO_PRODUCT_FOUND, could not read a price from this page. Fill in what is missing.
            </p>
            <div className="ak-kitchen-form-stack" style={{ marginTop: "var(--space-md)" }}>
              <Field label="Title" error="Title is required."><Input value="" onChange={() => {}} invalid /></Field>
              <Field label="Price, INR" error="Price is required."><Input value="" mono onChange={() => {}} invalid /></Field>
            </div>
          </Card>
          <Card>
            <p className="ak-kitchen-pair-label">Amazon, cannot be fetched</p>
            <Field label="Product URL"><Input value="https://www.amazon.in/dp/B0EXAMPLE" onChange={() => {}} disabled /></Field>
            <p className="ak-kitchen-note-line">
              <Link2 size={14} strokeWidth={1.75} /> Amazon India pages cannot be fetched automatically. Fill in the details and the
              link is kept as the offer.
            </p>
            <div className="ak-kitchen-form-stack" style={{ marginTop: "var(--space-md)" }}>
              <Field label="Title"><Input value="" placeholder="Untitled product" onChange={() => {}} /></Field>
              <Field label="Price, INR"><Input value="" placeholder="0" mono onChange={() => {}} /></Field>
            </div>
          </Card>
        </div>

        <h3 className="ak-kitchen-subhead">Save bar states</h3>
        <Card>
          <div className="ak-kitchen-form-stack">
            <Field label="Product title">
              <Input value={formTitle} onChange={setFormTitle} placeholder="Untitled product" />
            </Field>
            <Field
              label="Price, INR"
              error={formPriceTouched ? "Price is required." : undefined}
            >
              <Input value="" mono onChange={() => setFormPriceTouched(true)} invalid={formPriceTouched} />
            </Field>
          </div>
        </Card>
        <p className="ak-kitchen-pair-label" style={{ marginTop: "var(--space-md)" }}>
          Clean: no bar below. Dirty: type in the title above, the bar appears. Invalid: leave
          the price blank after touching it, Save disables. Saving: click Save.
        </p>
        <SaveBar
          dirty={dirty}
          saving={saving}
          errorCount={formPriceTouched ? 1 : 0}
          onDiscard={() => {
            setFormTitle("");
            setFormPriceTouched(false);
          }}
          onSave={() => {
            setSaving(true);
            window.setTimeout(() => setSaving(false), 1200);
          }}
        />
      </Section>

      <Section id="badges" title="6. Badge vocabulary" note="Every resource status maps to one of these four, per src/lib/status.ts.">
        <div className="ak-kitchen-row">
          {["ok", "pending", "approved", "rejected", "price_changed", "out_of_stock", "gone", "unchecked", "suspended", "active"].map((status) => (
            <Badge key={status} tone={statusTone(status)}>{statusLabel(status)}</Badge>
          ))}
        </div>
      </Section>

      <Section id="confirm" title="7. Confirm dialog" note="Native dialog, showModal, Esc closes, danger primary.">
        <Button variant="danger" onClick={() => confirmRef.current?.open()}>
          <Trash2 size={16} strokeWidth={1.75} /> Delete offer
        </Button>
        <ConfirmDialog
          ref={confirmRef}
          title="Delete this offer"
          body="This removes the offer from the product page. This cannot be undone for"
          recordName="Amazon.in, Rs 1,899"
          confirmLabel="Delete offer"
          onConfirm={() => confirmRef.current?.close()}
        />
      </Section>

      <Section id="dashboard" title="8. Dashboard KPI row" note="Four tiles, mono numbers, sample data only.">
        <div className="ak-kitchen-kpi-row">
          {[
            { label: "Pending verification", value: "6" },
            { label: "Orders this week", value: "42" },
            { label: "GMV this week", value: "Rs 4,18,900" },
            { label: "Open reports", value: "2" },
          ].map((kpi) => (
            <Card key={kpi.label} className="ak-kitchen-kpi-card">
              <span className="ak-kitchen-kpi-label">{kpi.label}</span>
              <Mono style={{ fontSize: "var(--type-numericLg-size)", fontWeight: "var(--weight-semibold)" }}>{kpi.value}</Mono>
            </Card>
          ))}
        </div>
      </Section>
    </div>
  );
}
