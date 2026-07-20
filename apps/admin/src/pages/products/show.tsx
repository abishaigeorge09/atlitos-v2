import type { Db } from "@atlitos/types";
import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Eye,
  EyeOff,
  Image,
  Package,
  Plus,
  Save,
  Star,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { Badge, Button, Card, EmptyState } from "../../components/ui";
import { Mono } from "../../components/mono";
import { Field, Input, inputStyle } from "../../components/form";
import {
  catalogApi,
  fetchVariantStock,
  type AdminVariantStock,
  type CommerceError,
  type MediaInput,
} from "../commerce/api";
import { supabaseClient } from "../../providers/supabaseClient";

// AT-81, PRD-04 FR-14 through FR-19. Every mutation on this screen goes
// through an `admin_*` RPC from 0039, never a direct table write, because each
// FR requires an audit_log row that a client has no grant to write.
//
// Stock is the exception worth stating twice: the variant table below shows
// RAW stock and HELD reservations as two columns, and stock is editable ONLY
// through the adjust form, which requires a reason (FR-17). `admin_update_variant`
// deliberately cannot set stock, so there is no path to moving inventory
// without a recorded reason.

type LoadState = "loading" | "error" | "ready" | "not_found";

interface CategoryRow {
  id: string;
  name: string;
}

function errorMessage(err: unknown): string {
  const e = err as CommerceError;
  return e?.message ?? "Something went wrong. Try again.";
}

export function ProductShow() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [product, setProduct] = useState<Db.ProductRow | null>(null);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [variants, setVariants] = useState<AdminVariantStock[]>([]);
  const [media, setMedia] = useState<Db.ProductMediaRow[]>([]);
  const [state, setState] = useState<LoadState>("loading");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Product edit form (FR-15)
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [basePrice, setBasePrice] = useState("");

  // New variant form (FR-16)
  const [newVariant, setNewVariant] = useState({ sku: "", size: "", color: "", price: "", stock: "" });

  // Stock adjust form (FR-17). Keyed by variant so only one is open at a time.
  const [adjusting, setAdjusting] = useState<string | null>(null);
  const [adjustStock, setAdjustStock] = useState("");
  const [adjustReason, setAdjustReason] = useState("");

  async function load() {
    if (!id) return;
    setState("loading");
    try {
      const [{ data: productData, error: productError }, { data: categoryRows }, variantRows, { data: mediaRows }] =
        await Promise.all([
          supabaseClient
            .from("products")
            .select(
              "id,title,description,category_id,sport,base_price,active,recommended_rank,created_at,updated_at",
            )
            .eq("id", id)
            .maybeSingle(),
          supabaseClient.from("categories").select("id,name").order("name"),
          fetchVariantStock(id),
          supabaseClient
            .from("product_media")
            .select("id,product_id,storage_path,position,is_primary")
            .eq("product_id", id)
            .order("position"),
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

  function currentMediaInput(): MediaInput[] {
    return media.map((m, index) => ({
      storage_path: m.storage_path,
      position: index,
      is_primary: m.is_primary,
    }));
  }

  // FR-19. Reorder and primary designation are both list operations, so they
  // rebuild the whole list and hand it to admin_set_product_media in one call,
  // which is also what keeps the one-primary partial unique index satisfied at
  // every commit.
  function moveImage(index: number, direction: -1 | 1) {
    const next = currentMediaInput();
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    const a = next[index] as MediaInput;
    const b = next[target] as MediaInput;
    next[index] = b;
    next[target] = a;
    void run(
      () => catalogApi.setMedia(id as string, next.map((m, i) => ({ ...m, position: i }))),
      "Image order updated.",
    );
  }

  function makePrimary(index: number) {
    const next = currentMediaInput().map((m, i) => ({ ...m, is_primary: i === index }));
    void run(() => catalogApi.setMedia(id as string, next), "Primary image updated.");
  }

  if (state === "loading") {
    return <div style={{ fontSize: 14, color: "var(--color-text-secondary)" }}>Loading product...</div>;
  }

  if (state === "not_found") {
    return (
      <Card>
        <EmptyState
          icon={<AlertTriangle size={32} strokeWidth={1.75} />}
          title="Product not found"
          description="This product does not exist or was removed."
        />
      </Card>
    );
  }

  if (state === "error" || !product) {
    return (
      <Card>
        <EmptyState
          icon={<AlertTriangle size={32} strokeWidth={1.75} />}
          title="Could not load this product"
          description="Something went wrong reading this product. Try again."
        />
      </Card>
    );
  }

  const rawTotal = variants.reduce((sum, v) => sum + v.raw_stock, 0);
  const heldTotal = variants.reduce((sum, v) => sum + v.held_qty, 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-lg)", maxWidth: 880 }}>
      <button
        type="button"
        onClick={() => navigate("/products")}
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
        Back to catalog
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

      {/* FR-15 product edit, FR-18 activation */}
      <Card>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "var(--space-md)" }}>
          <div>
            <p
              style={{
                fontSize: 12,
                fontWeight: 600,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: "var(--color-text-tertiary)",
                margin: 0,
              }}
            >
              Product
            </p>
            <h1 style={{ fontSize: 20, fontWeight: 700, margin: "var(--space-xs) 0 0" }}>{product.title}</h1>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)" }}>
            <Badge tone={product.active ? "success" : "neutral"}>
              {product.active ? "active" : "inactive"}
            </Badge>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() =>
                run(
                  () => catalogApi.setProductActive(product.id, !product.active),
                  product.active
                    ? "Product hidden from the shopper catalog."
                    : "Product restored to the shopper catalog.",
                )
              }
            >
              {product.active ? <EyeOff size={16} strokeWidth={1.75} /> : <Eye size={16} strokeWidth={1.75} />}
              {product.active ? "Deactivate" : "Reactivate"}
            </Button>
          </div>
        </div>

        <div
          style={{
            marginTop: "var(--space-lg)",
            paddingTop: "var(--space-lg)",
            borderTop: "1px solid var(--color-border)",
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-md)",
          }}
        >
          <Field label="Title">
            <Input value={title} onChange={setTitle} />
          </Field>
          <Field label="Description">
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={3}
              style={{ ...inputStyle, resize: "vertical" }}
            />
          </Field>
          <div style={{ display: "flex", gap: "var(--space-md)" }}>
            <Field label="Category" style={{ flex: 1 }}>
              <select
                value={categoryId}
                onChange={(event) => setCategoryId(event.target.value)}
                style={inputStyle}
              >
                <option value="">Select a category</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Base price" style={{ flex: 1 }}>
              <Input value={basePrice} onChange={setBasePrice} mono />
            </Field>
          </div>
          <div>
            <Button
              disabled={busy}
              onClick={() =>
                run(
                  () =>
                    catalogApi.updateProduct({
                      id: product.id,
                      title,
                      description,
                      categoryId,
                      basePrice: Number(basePrice),
                    }),
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

      {/* FR-16, FR-17 variants and stock */}
      <Card style={{ padding: 0 }}>
        <div
          style={{
            padding: "var(--space-lg)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
          }}
        >
          <p
            style={{
              fontSize: 12,
              fontWeight: 600,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--color-text-tertiary)",
              margin: 0,
            }}
          >
            Variants and inventory
          </p>
          <p style={{ fontSize: 13, color: "var(--color-text-secondary)", margin: 0 }}>
            <Mono style={{ fontWeight: 600 }}>{rawTotal}</Mono> raw,{" "}
            <Mono style={{ color: heldTotal > 0 ? "var(--color-warning)" : undefined }}>{heldTotal}</Mono> held
          </p>
        </div>

        {variants.length === 0 ? (
          <EmptyState
            icon={<Package size={32} strokeWidth={1.75} />}
            title="No variants yet"
            description="Add a variant below so this product can be bought."
          />
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid var(--color-border)" }}>
                {["SKU", "Size", "Color", "Price override", "Raw stock", "Held", "Available", ""].map((heading) => (
                  <th
                    key={heading}
                    style={{
                      padding: "var(--space-sm) var(--space-lg)",
                      fontSize: 12,
                      fontWeight: 600,
                      textTransform: "uppercase",
                      letterSpacing: "0.04em",
                      color: "var(--color-text-tertiary)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {variants.map((v) => (
                <tr key={v.product_variant_id} style={{ borderBottom: "1px solid var(--color-border)" }}>
                  <td style={{ padding: "var(--space-md) var(--space-lg)" }}>
                    <Mono style={{ fontSize: 13, fontWeight: 600 }}>{v.sku}</Mono>
                  </td>
                  <td style={{ padding: "var(--space-md) var(--space-lg)", fontSize: 14, color: "var(--color-text-secondary)" }}>
                    {v.size ?? "Not set"}
                  </td>
                  <td style={{ padding: "var(--space-md) var(--space-lg)", fontSize: 14, color: "var(--color-text-secondary)" }}>
                    {v.color ?? "Not set"}
                  </td>
                  <td style={{ padding: "var(--space-md) var(--space-lg)" }}>
                    <Mono style={{ fontSize: 13 }}>
                      {v.price_override === null ? "Base" : `Rs ${Number(v.price_override).toFixed(2)}`}
                    </Mono>
                  </td>
                  <td style={{ padding: "var(--space-md) var(--space-lg)" }}>
                    <Mono style={{ fontSize: 13, fontWeight: 600 }}>{v.raw_stock}</Mono>
                  </td>
                  <td style={{ padding: "var(--space-md) var(--space-lg)" }}>
                    <Mono
                      style={{
                        fontSize: 13,
                        color: v.held_qty > 0 ? "var(--color-warning)" : "var(--color-text-tertiary)",
                      }}
                    >
                      {v.held_qty}
                    </Mono>
                  </td>
                  <td style={{ padding: "var(--space-md) var(--space-lg)" }}>
                    <Mono style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>{v.available_stock}</Mono>
                  </td>
                  <td style={{ padding: "var(--space-md) var(--space-lg)", whiteSpace: "nowrap" }}>
                    <div style={{ display: "flex", gap: "var(--space-xs)" }}>
                      <Button
                        variant="secondary"
                        disabled={busy}
                        style={{ padding: "var(--space-xs) var(--space-sm)", fontSize: 13 }}
                        onClick={() => {
                          setAdjusting(v.product_variant_id);
                          setAdjustStock(String(v.raw_stock));
                          setAdjustReason("");
                        }}
                      >
                        Adjust stock
                      </Button>
                      <Button
                        variant="destructive"
                        disabled={busy}
                        style={{ padding: "var(--space-xs) var(--space-sm)", fontSize: 13 }}
                        onClick={() =>
                          run(() => catalogApi.deleteVariant(v.product_variant_id), "Variant removed.")
                        }
                      >
                        <Trash2 size={14} strokeWidth={1.75} />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* FR-17: the reason is required, and the form says so. */}
        {adjusting ? (
          <div style={{ padding: "var(--space-lg)", borderTop: "1px solid var(--color-border)", backgroundColor: "var(--color-surface-muted)" }}>
            <p style={{ fontSize: 13, fontWeight: 600, margin: "0 0 var(--space-md)" }}>
              Stock take. Enter the count actually on the shelf.
            </p>
            <div style={{ display: "flex", gap: "var(--space-md)", alignItems: "flex-end" }}>
              <Field label="New count" style={{ width: 140 }}>
                <Input value={adjustStock} onChange={setAdjustStock} mono />
              </Field>
              <Field label="Reason, required" style={{ flex: 1 }}>
                <Input value={adjustReason} onChange={setAdjustReason} />
              </Field>
              <Button
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

        {/* FR-16 add variant */}
        <div style={{ padding: "var(--space-lg)", borderTop: "1px solid var(--color-border)" }}>
          <p style={{ fontSize: 13, fontWeight: 600, margin: "0 0 var(--space-md)" }}>Add a variant</p>
          <div style={{ display: "flex", gap: "var(--space-sm)", alignItems: "flex-end", flexWrap: "wrap" }}>
            <Field label="SKU" style={{ width: 160 }}>
              <Input value={newVariant.sku} onChange={(v) => setNewVariant({ ...newVariant, sku: v })} mono />
            </Field>
            <Field label="Size" style={{ width: 110 }}>
              <Input value={newVariant.size} onChange={(v) => setNewVariant({ ...newVariant, size: v })} />
            </Field>
            <Field label="Color" style={{ width: 110 }}>
              <Input value={newVariant.color} onChange={(v) => setNewVariant({ ...newVariant, color: v })} />
            </Field>
            <Field label="Price override" style={{ width: 130 }}>
              <Input value={newVariant.price} onChange={(v) => setNewVariant({ ...newVariant, price: v })} mono />
            </Field>
            <Field label="Opening stock" style={{ width: 130 }}>
              <Input value={newVariant.stock} onChange={(v) => setNewVariant({ ...newVariant, stock: v })} mono />
            </Field>
            <Button
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

      {/* FR-19 media */}
      <Card style={{ padding: 0 }}>
        <div style={{ padding: "var(--space-lg)" }}>
          <p
            style={{
              fontSize: 12,
              fontWeight: 600,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--color-text-tertiary)",
              margin: 0,
            }}
          >
            Images
          </p>
        </div>
        {media.length === 0 ? (
          <EmptyState
            icon={<Image size={32} strokeWidth={1.75} />}
            title="No images"
            description="This product has no images on file."
          />
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <tbody>
              {media.map((m, index) => (
                <tr key={m.id} style={{ borderTop: "1px solid var(--color-border)" }}>
                  <td style={{ padding: "var(--space-md) var(--space-lg)", width: 60 }}>
                    <Mono style={{ fontSize: 13, color: "var(--color-text-tertiary)" }}>{index + 1}</Mono>
                  </td>
                  <td style={{ padding: "var(--space-md) 0", fontSize: 14 }}>{m.storage_path}</td>
                  <td style={{ padding: "var(--space-md) var(--space-lg)", width: 110 }}>
                    {m.is_primary ? <Badge tone="success">primary</Badge> : null}
                  </td>
                  <td style={{ padding: "var(--space-md) var(--space-lg)", width: 220, whiteSpace: "nowrap" }}>
                    <div style={{ display: "flex", gap: "var(--space-xs)" }}>
                      <Button
                        variant="secondary"
                        disabled={busy || index === 0}
                        style={{ padding: "var(--space-xs) var(--space-sm)" }}
                        onClick={() => moveImage(index, -1)}
                      >
                        <ArrowUp size={14} strokeWidth={1.75} />
                      </Button>
                      <Button
                        variant="secondary"
                        disabled={busy || index === media.length - 1}
                        style={{ padding: "var(--space-xs) var(--space-sm)" }}
                        onClick={() => moveImage(index, 1)}
                      >
                        <ArrowDown size={14} strokeWidth={1.75} />
                      </Button>
                      <Button
                        variant="secondary"
                        disabled={busy || m.is_primary}
                        style={{ padding: "var(--space-xs) var(--space-sm)", fontSize: 13 }}
                        onClick={() => makePrimary(index)}
                      >
                        <Star size={14} strokeWidth={1.75} />
                        Primary
                      </Button>
                    </div>
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
