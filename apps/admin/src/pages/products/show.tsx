import { useNotification } from "@refinedev/core";
import type { Db } from "@atlitos/types";
import { ArrowDown, ArrowUp, Eye, EyeOff, Image, Package, Plus, Save, Star, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";

import { Badge } from "../../components/kit/Badge";
import { Button } from "../../components/kit/Button";
import { Card } from "../../components/kit/Card";
import { ConfirmDialog, type ConfirmDialogHandle } from "../../components/kit/ConfirmDialog";
import { DataTable, type DataTableColumn } from "../../components/kit/DataTable";
import { DetailLayout } from "../../components/kit/DetailLayout";
import { EmptyState } from "../../components/kit/EmptyState";
import { Field } from "../../components/kit/Field";
import { Input } from "../../components/kit/Input";
import { PageHeader } from "../../components/kit/PageHeader";
import { Select } from "../../components/kit/Select";
import { DetailSkeleton } from "../../components/kit/Skeleton";
import { Textarea } from "../../components/kit/Textarea";
import { Mono } from "../../components/mono";
import {
  catalogApi,
  fetchVariantStock,
  type AdminVariantStock,
  type CommerceError,
  type MediaInput,
} from "../commerce/api";
import { supabaseClient } from "../../providers/supabaseClient";
import "./products.css";

// AT-81, PRD-04 FR-14 through FR-19. Every mutation on this screen goes
// through an `admin_*` RPC from 0039, never a direct table write, because
// each FR requires an audit_log row a client has no grant to write.
//
// Stock is the exception worth stating twice: the variant table shows RAW
// stock and HELD reservations as two mono columns, and stock is editable
// ONLY through the adjust form, which requires a reason (FR-17).
// `admin_update_variant` deliberately cannot set stock, so there is no path
// to moving inventory without a recorded reason. Variant delete is the
// screen's one irreversible action, so it is the one gated by a kit
// ConfirmDialog naming the SKU.

type LoadState = "loading" | "error" | "ready" | "not_found";

interface CategoryRow {
  id: string;
  name: string;
}

export function ProductShow() {
  const { id } = useParams<{ id: string }>();
  const { open } = useNotification();

  const [product, setProduct] = useState<Db.ProductRow | null>(null);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [variants, setVariants] = useState<AdminVariantStock[]>([]);
  const [media, setMedia] = useState<Db.ProductMediaRow[]>([]);
  const [state, setState] = useState<LoadState>("loading");
  const [busy, setBusy] = useState(false);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [basePrice, setBasePrice] = useState("");

  const [newVariant, setNewVariant] = useState({ sku: "", size: "", color: "", price: "", stock: "" });

  const [adjusting, setAdjusting] = useState<string | null>(null);
  const [adjustStock, setAdjustStock] = useState("");
  const [adjustReason, setAdjustReason] = useState("");

  const [deleteTarget, setDeleteTarget] = useState<AdminVariantStock | null>(null);
  const deleteDialogRef = useRef<ConfirmDialogHandle>(null);

  async function load() {
    if (!id) return;
    setState("loading");
    try {
      const [{ data: productData, error: productError }, { data: categoryRows }, variantRows, { data: mediaRows }] =
        await Promise.all([
          supabaseClient
            .from("products")
            .select("id,title,description,category_id,sport,base_price,active,recommended_rank,created_at,updated_at")
            .eq("id", id)
            .maybeSingle(),
          supabaseClient.from("categories").select("id,name").order("name"),
          fetchVariantStock(id),
          supabaseClient.from("product_media").select("id,product_id,storage_path,position,is_primary").eq("product_id", id).order("position"),
        ]);

      if (productError) {
        setState("error");
        return;
      }
      if (!productData) {
        setState("not_found");
        return;
      }

      const row = productData as Db.ProductRow;
      setProduct(row);
      setTitle(row.title);
      setDescription(row.description ?? "");
      setCategoryId(row.category_id ?? "");
      setBasePrice(String(row.base_price));
      setCategories((categoryRows as CategoryRow[]) ?? []);
      setVariants(variantRows);
      setMedia((mediaRows as Db.ProductMediaRow[]) ?? []);
      setState("ready");
    } catch {
      setState("error");
    }
  }

  useEffect(() => {
    void load();
  }, [id]);

  async function run(action: () => Promise<unknown>, successMessage: string) {
    setBusy(true);
    try {
      await action();
      open?.({ type: "success", message: successMessage });
      await load();
    } catch (err) {
      const e = err as CommerceError;
      open?.({ type: "error", message: e.code ?? "Something went wrong", description: e.message });
    } finally {
      setBusy(false);
    }
  }

  function currentMediaInput(): MediaInput[] {
    return media.map((m, index) => ({ storage_path: m.storage_path, position: index, is_primary: m.is_primary }));
  }

  function moveImage(index: number, direction: -1 | 1) {
    const next = currentMediaInput();
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    const a = next[index] as MediaInput;
    const b = next[target] as MediaInput;
    next[index] = b;
    next[target] = a;
    void run(() => catalogApi.setMedia(id as string, next.map((m, i) => ({ ...m, position: i }))), "Image order updated.");
  }

  function makePrimary(index: number) {
    const next = currentMediaInput().map((m, i) => ({ ...m, is_primary: i === index }));
    void run(() => catalogApi.setMedia(id as string, next), "Primary image updated.");
  }

  function requestDeleteVariant(v: AdminVariantStock) {
    setDeleteTarget(v);
    deleteDialogRef.current?.open();
  }

  async function confirmDeleteVariant() {
    if (!deleteTarget) return;
    await run(() => catalogApi.deleteVariant(deleteTarget.product_variant_id), "Variant removed.");
    deleteDialogRef.current?.close();
    setDeleteTarget(null);
  }

  if (state === "loading") {
    return (
      <div>
        <PageHeader breadcrumbs={[{ label: "Catalog", to: "/products" }]} title="Loading product" />
        <DetailSkeleton />
      </div>
    );
  }

  if (state === "not_found" || state === "error" || !product) {
    return (
      <div>
        <PageHeader breadcrumbs={[{ label: "Catalog", to: "/products" }]} title="Product" />
        <Card>
          <EmptyState
            title={state === "not_found" ? "Product not found" : "Could not load this product"}
            body={
              state === "not_found"
                ? "This product does not exist or was removed."
                : "Something went wrong reading this product. Try again."
            }
          />
        </Card>
      </div>
    );
  }

  const rawTotal = variants.reduce((sum, v) => sum + v.raw_stock, 0);
  const heldTotal = variants.reduce((sum, v) => sum + v.held_qty, 0);

  const variantColumns: DataTableColumn<AdminVariantStock>[] = [
    { key: "sku", header: "SKU", render: (v) => <Mono style={{ fontWeight: "var(--weight-semibold)" }}>{v.sku}</Mono> },
    { key: "size", header: "Size", render: (v) => v.size ?? "Not set" },
    { key: "color", header: "Color", render: (v) => v.color ?? "Not set" },
    {
      key: "price",
      header: "Price override",
      numeric: true,
      render: (v) => (v.price_override === null ? "Base" : `Rs ${Number(v.price_override).toFixed(2)}`),
    },
    { key: "raw", header: "Raw stock", numeric: true, render: (v) => v.raw_stock },
    { key: "held", header: "Held", numeric: true, render: (v) => v.held_qty },
    { key: "available", header: "Available", numeric: true, render: (v) => v.available_stock },
    {
      key: "actions",
      header: "",
      nowrap: true,
      render: (v) => (
        <div style={{ display: "flex", gap: "var(--space-xs)" }}>
          <Button
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={() => {
              setAdjusting(v.product_variant_id);
              setAdjustStock(String(v.raw_stock));
              setAdjustReason("");
            }}
          >
            Adjust stock
          </Button>
          <Button
            variant="danger"
            size="sm"
            disabled={busy}
            aria-label={`Delete variant ${v.sku}`}
            onClick={() => requestDeleteVariant(v)}
          >
            <Trash2 size={14} strokeWidth={1.75} />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        breadcrumbs={[{ label: "Catalog", to: "/products" }]}
        title={product.title}
        secondaryActions={
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() =>
              run(
                () => catalogApi.setProductActive(product.id, !product.active),
                product.active ? "Product hidden from the shopper catalog." : "Product restored to the shopper catalog.",
              )
            }
          >
            {product.active ? <EyeOff size={16} strokeWidth={1.75} /> : <Eye size={16} strokeWidth={1.75} />}
            {product.active ? "Deactivate" : "Reactivate"}
          </Button>
        }
      />

      <DetailLayout
        main={
          <>
            <Card>
              <h3 className="ak-product-section-title">Product details</h3>
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
                <Field label="Title">
                  <Input value={title} onChange={setTitle} />
                </Field>
                <Field label="Description">
                  <Textarea value={description} onChange={setDescription} />
                </Field>
                <div style={{ display: "flex", gap: "var(--space-md)" }}>
                  <div style={{ flex: 1 }}>
                    <Field label="Category">
                      <Select value={categoryId} onChange={setCategoryId} placeholder="Select a category" options={categories.map((c) => ({ value: c.id, label: c.name }))} />
                    </Field>
                  </div>
                  <div style={{ flex: 1 }}>
                    <Field label="Base price">
                      <Input value={basePrice} onChange={setBasePrice} mono />
                    </Field>
                  </div>
                </div>
                <div>
                  <Button
                    variant="primary"
                    disabled={busy}
                    onClick={() =>
                      run(
                        () => catalogApi.updateProduct({ id: product.id, title, description, categoryId, basePrice: Number(basePrice) }),
                        "Product saved.",
                      )
                    }
                  >
                    <Save size={16} strokeWidth={1.75} />
                    Save product
                  </Button>
                </div>
              </div>
            </Card>

            <Card>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <h3 className="ak-product-section-title" style={{ margin: 0 }}>Variants and inventory</h3>
                <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)", margin: 0 }}>
                  <Mono style={{ fontWeight: "var(--weight-semibold)" }}>{rawTotal}</Mono> raw,{" "}
                  <Mono>{heldTotal}</Mono> held
                </p>
              </div>

              <div style={{ marginTop: "var(--space-md)" }}>
                {variants.length === 0 ? (
                  <EmptyState icon={<Package size={32} strokeWidth={1.75} />} title="No variants yet" body="Add a variant below so this product can be bought." />
                ) : (
                  <DataTable columns={variantColumns} rows={variants} rowKey={(v) => v.product_variant_id} />
                )}
              </div>

              {adjusting ? (
                <div className="ak-product-adjust-panel">
                  <p style={{ fontSize: "var(--text-sm)", fontWeight: "var(--weight-semibold)", margin: "0 0 var(--space-md)" }}>
                    Stock take. Enter the count actually on the shelf.
                  </p>
                  <div style={{ display: "flex", gap: "var(--space-md)", alignItems: "flex-end", flexWrap: "wrap" }}>
                    <div style={{ width: 140 }}>
                      <Field label="New count">
                        <Input value={adjustStock} onChange={setAdjustStock} mono />
                      </Field>
                    </div>
                    <div style={{ flex: 1, minWidth: 200 }}>
                      <Field label="Reason, required">
                        <Input value={adjustReason} onChange={setAdjustReason} />
                      </Field>
                    </div>
                    <Button
                      variant="primary"
                      disabled={busy || adjustReason.trim().length === 0}
                      onClick={() =>
                        run(async () => {
                          await catalogApi.adjustStock(adjusting, Number(adjustStock), adjustReason);
                          setAdjusting(null);
                        }, "Stock adjusted.")
                      }
                    >
                      Save adjustment
                    </Button>
                    <Button variant="secondary" disabled={busy} onClick={() => setAdjusting(null)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : null}

              <div className="ak-product-add-variant">
                <p style={{ fontSize: "var(--text-sm)", fontWeight: "var(--weight-semibold)", margin: "0 0 var(--space-md)" }}>Add a variant</p>
                <div style={{ display: "flex", gap: "var(--space-sm)", alignItems: "flex-end", flexWrap: "wrap" }}>
                  <div style={{ width: 160 }}>
                    <Field label="SKU">
                      <Input value={newVariant.sku} onChange={(v) => setNewVariant({ ...newVariant, sku: v })} mono />
                    </Field>
                  </div>
                  <div style={{ width: 110 }}>
                    <Field label="Size">
                      <Input value={newVariant.size} onChange={(v) => setNewVariant({ ...newVariant, size: v })} />
                    </Field>
                  </div>
                  <div style={{ width: 110 }}>
                    <Field label="Color">
                      <Input value={newVariant.color} onChange={(v) => setNewVariant({ ...newVariant, color: v })} />
                    </Field>
                  </div>
                  <div style={{ width: 130 }}>
                    <Field label="Price override">
                      <Input value={newVariant.price} onChange={(v) => setNewVariant({ ...newVariant, price: v })} mono />
                    </Field>
                  </div>
                  <div style={{ width: 130 }}>
                    <Field label="Opening stock">
                      <Input value={newVariant.stock} onChange={(v) => setNewVariant({ ...newVariant, stock: v })} mono />
                    </Field>
                  </div>
                  <Button
                    variant="primary"
                    disabled={busy || newVariant.sku.trim().length === 0}
                    onClick={() =>
                      run(async () => {
                        await catalogApi.createVariant({
                          productId: product.id,
                          sku: newVariant.sku,
                          size: newVariant.size || null,
                          color: newVariant.color || null,
                          priceOverride: newVariant.price ? Number(newVariant.price) : null,
                          stock: newVariant.stock ? Number(newVariant.stock) : 0,
                        });
                        setNewVariant({ sku: "", size: "", color: "", price: "", stock: "" });
                      }, "Variant added.")
                    }
                  >
                    <Plus size={16} strokeWidth={1.75} />
                    Add variant
                  </Button>
                </div>
              </div>
            </Card>

            <Card>
              <h3 className="ak-product-section-title">Images</h3>
              {media.length === 0 ? (
                <EmptyState icon={<Image size={32} strokeWidth={1.75} />} title="No images" body="This product has no images on file." />
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)" }}>
                  {media.map((m, index) => (
                    <div key={m.id} className="ak-product-media-row">
                      <Mono style={{ fontSize: "var(--text-sm)", color: "var(--color-text-tertiary)", width: 24 }}>{index + 1}</Mono>
                      <span className="ak-product-media-path">{m.storage_path}</span>
                      {m.is_primary ? <Badge tone="success">primary</Badge> : null}
                      <div style={{ display: "flex", gap: "var(--space-xs)", marginLeft: "auto" }}>
                        <Button variant="secondary" size="sm" disabled={busy || index === 0} onClick={() => moveImage(index, -1)}>
                          <ArrowUp size={14} strokeWidth={1.75} />
                        </Button>
                        <Button variant="secondary" size="sm" disabled={busy || index === media.length - 1} onClick={() => moveImage(index, 1)}>
                          <ArrowDown size={14} strokeWidth={1.75} />
                        </Button>
                        <Button variant="secondary" size="sm" disabled={busy || m.is_primary} onClick={() => makePrimary(index)}>
                          <Star size={14} strokeWidth={1.75} />
                          Primary
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </>
        }
        side={
          <Card>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span className="ak-product-eyebrow">State</span>
              <Badge tone={product.active ? "success" : "neutral"}>{product.active ? "active" : "inactive"}</Badge>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)", marginTop: "var(--space-md)" }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)" }}>Base price</span>
                <Mono>Rs {Number(product.base_price).toFixed(2)}</Mono>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)" }}>Variants</span>
                <Mono>{variants.length}</Mono>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)" }}>Raw stock</span>
                <Mono>{rawTotal}</Mono>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)" }}>Held</span>
                <Mono>{heldTotal}</Mono>
              </div>
            </div>
          </Card>
        }
      />

      <ConfirmDialog
        ref={deleteDialogRef}
        title="Delete this variant"
        body="This removes the variant from the product page. This cannot be undone for"
        recordName={deleteTarget?.sku}
        confirmLabel="Delete variant"
        cancelLabel="Cancel"
        danger
        loading={busy}
        onConfirm={confirmDeleteVariant}
      />
    </div>
  );
}
