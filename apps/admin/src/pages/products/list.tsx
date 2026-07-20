import type { Db } from "@atlitos/types";
import { AlertTriangle, Package, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { Badge, Card, EmptyState } from "../../components/ui";
import { Mono } from "../../components/mono";
import { fetchVariantStock, type AdminVariantStock } from "../commerce/api";
import { supabaseClient } from "../../providers/supabaseClient";

// AT-81, PRD-04 FR-13: every product with name, category, variant count,
// aggregate stock and active state, searchable by text and filterable by
// category.
//
// AGGREGATE STOCK IS RAW STOCK, AND THE COLUMN SAYS SO.
//
// The ticket is explicit: FR-13 shows RAW `product_variants.stock`, not
// AT-67's available figure, because an admin needs to see real inventory
// rather than inventory minus in-flight carts. So the column is headed "Raw
// stock" and a second column reports units currently HELD by checkouts in
// progress. Both come from `admin_variant_stock` (0039), which returns them as
// separate numbers precisely so this surface cannot collapse them into one
// figure that would be a lie under either reading.
//
// A single "stock" column would be wrong whichever number it carried: raw
// alone hides that some of it is spoken for, and available alone tells an
// admin doing a stock take a number that does not match the shelf.
type ProductRow = Db.ProductRow;
type LoadState = "loading" | "error" | "ready";

interface CategoryRow {
  id: string;
  name: string;
}

export function ProductsList() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeCategory = searchParams.get("category") ?? "all";
  const [search, setSearch] = useState("");

  const [products, setProducts] = useState<ProductRow[]>([]);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [stock, setStock] = useState<AdminVariantStock[]>([]);
  const [state, setState] = useState<LoadState>("loading");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setState("loading");
      try {
        const [{ data: productRows, error: productError }, { data: categoryRows }, stockRows] =
          await Promise.all([
            supabaseClient
              .from("products")
              .select(
                "id,title,description,category_id,sport,base_price,active,recommended_rank,created_at,updated_at",
              )
              .order("created_at", { ascending: false }),
            supabaseClient.from("categories").select("id,name").order("name"),
            fetchVariantStock(),
          ]);

        if (cancelled) return;
        if (productError) {
          setState("error");
          return;
        }

        setProducts((productRows as ProductRow[]) ?? []);
        setCategories((categoryRows as CategoryRow[]) ?? []);
        setStock(stockRows);
        setState("ready");
      } catch {
        if (!cancelled) setState("error");
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const categoryName = useMemo(
    () => Object.fromEntries(categories.map((c) => [c.id, c.name])),
    [categories],
  );

  // One pass over the variant rows, keyed by product, rather than a filter per
  // product per render.
  const stockByProduct = useMemo(() => {
    const map = new Map<string, { variants: number; raw: number; held: number }>();
    for (const row of stock) {
      const entry = map.get(row.product_id) ?? { variants: 0, raw: 0, held: 0 };
      entry.variants += 1;
      entry.raw += row.raw_stock;
      entry.held += row.held_qty;
      map.set(row.product_id, entry);
    }
    return map;
  }, [stock]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      const matchesCategory = activeCategory === "all" || p.category_id === activeCategory;
      const matchesSearch =
        q.length === 0 ||
        p.title.toLowerCase().includes(q) ||
        (categoryName[p.category_id ?? ""] ?? "").toLowerCase().includes(q);
      return matchesCategory && matchesSearch;
    });
  }, [products, activeCategory, search, categoryName]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-lg)" }}>
      <div>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0, letterSpacing: "-0.4px" }}>Catalog</h1>
        <p style={{ fontSize: 14, color: "var(--color-text-secondary)", margin: "var(--space-xs) 0 0" }}>
          Every gear product, its variants, and what is really on the shelf.
        </p>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "var(--space-md)" }}>
        <div style={{ display: "flex", gap: "var(--space-xs)", borderBottom: "1px solid var(--color-border)", overflowX: "auto" }}>
          {[{ id: "all", name: "All" }, ...categories].map((tab) => {
            const isActive = tab.id === activeCategory;
            const count =
              tab.id === "all"
                ? products.length
                : products.filter((p) => p.category_id === tab.id).length;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setSearchParams(tab.id === "all" ? {} : { category: tab.id })}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--space-xs)",
                  padding: "var(--space-sm) var(--space-lg)",
                  border: "none",
                  borderBottom: isActive ? "2px solid var(--color-accent)" : "2px solid transparent",
                  backgroundColor: "transparent",
                  color: isActive ? "var(--color-accent)" : "var(--color-text-secondary)",
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                {tab.name}
                <Mono
                  style={{
                    fontSize: 12,
                    padding: "0 6px",
                    borderRadius: "var(--radius-pill)",
                    backgroundColor: "var(--color-surface-muted)",
                    color: "var(--color-text-secondary)",
                  }}
                >
                  {count}
                </Mono>
              </button>
            );
          })}
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-sm)",
            padding: "var(--space-sm) var(--space-md)",
            borderRadius: "var(--radius-sm)",
            border: "1px solid var(--color-border)",
            backgroundColor: "var(--color-surface-muted)",
            width: 280,
            flexShrink: 0,
          }}
        >
          <Search size={16} strokeWidth={1.75} color="var(--color-text-tertiary)" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by product or category"
            style={{
              border: "none",
              outline: "none",
              backgroundColor: "transparent",
              fontSize: 14,
              color: "var(--color-text)",
              width: "100%",
            }}
          />
        </div>
      </div>

      <Card style={{ padding: 0 }}>
        {state === "loading" ? (
          <div style={{ padding: "var(--space-2xl)", color: "var(--color-text-secondary)", fontSize: 14 }}>
            Loading catalog...
          </div>
        ) : state === "error" ? (
          <EmptyState
            icon={<AlertTriangle size={32} strokeWidth={1.75} />}
            title="Could not load the catalog"
            description="Something went wrong reading products. Try again."
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<Package size={32} strokeWidth={1.75} />}
            title="No products found"
            description="No products match this category and search."
          />
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid var(--color-border)" }}>
                {["Product", "Category", "Variants", "Raw stock", "Held", "Base price", "State"].map((heading) => (
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
              {filtered.map((product) => {
                const agg = stockByProduct.get(product.id) ?? { variants: 0, raw: 0, held: 0 };
                return (
                  <tr
                    key={product.id}
                    onClick={() => navigate(`/products/show/${product.id}`)}
                    style={{ borderBottom: "1px solid var(--color-border)", cursor: "pointer" }}
                  >
                    <td style={{ padding: "var(--space-md) var(--space-lg)", fontSize: 14, fontWeight: 600 }}>
                      {product.title}
                    </td>
                    <td style={{ padding: "var(--space-md) var(--space-lg)", fontSize: 14, color: "var(--color-text-secondary)" }}>
                      {categoryName[product.category_id ?? ""] ?? "Uncategorised"}
                    </td>
                    <td style={{ padding: "var(--space-md) var(--space-lg)" }}>
                      <Mono style={{ fontSize: 13 }}>{agg.variants}</Mono>
                    </td>
                    <td style={{ padding: "var(--space-md) var(--space-lg)" }}>
                      <Mono style={{ fontSize: 13, fontWeight: 600 }}>{agg.raw}</Mono>
                    </td>
                    <td style={{ padding: "var(--space-md) var(--space-lg)" }}>
                      <Mono
                        style={{
                          fontSize: 13,
                          color: agg.held > 0 ? "var(--color-warning)" : "var(--color-text-tertiary)",
                        }}
                      >
                        {agg.held}
                      </Mono>
                    </td>
                    <td style={{ padding: "var(--space-md) var(--space-lg)" }}>
                      <Mono style={{ fontSize: 13 }}>Rs {Number(product.base_price).toFixed(2)}</Mono>
                    </td>
                    <td style={{ padding: "var(--space-md) var(--space-lg)" }}>
                      <Badge tone={product.active ? "success" : "neutral"}>
                        {product.active ? "active" : "inactive"}
                      </Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      <p style={{ fontSize: 13, color: "var(--color-text-secondary)", margin: 0 }}>
        Raw stock is the count on the shelf. Held is units reserved by a checkout in progress, still
        counted in raw stock because they have not been sold yet.
      </p>
    </div>
  );
}
