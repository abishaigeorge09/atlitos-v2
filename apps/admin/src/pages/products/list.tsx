import type { Db } from "@atlitos/types";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { Badge } from "../../components/kit/Badge";
import { DataTable, type DataTableColumn } from "../../components/kit/DataTable";
import { FilterBar } from "../../components/kit/FilterBar";
import { PageHeader } from "../../components/kit/PageHeader";
import { Tabs } from "../../components/kit/Tabs";
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
// progress. Both come from `admin_variant_stock` (0039), which returns them
// as separate numbers precisely so this surface cannot collapse them into
// one figure that would be a lie under either reading.
type ProductRow = Db.ProductRow;
type LoadState = "loading" | "error" | "ready";

interface CategoryRow {
  id: string;
  name: string;
}

export function ProductsList() {
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
        const [{ data: productRows, error: productError }, { data: categoryRows }, stockRows] = await Promise.all([
          supabaseClient
            .from("products")
            .select("id,title,description,category_id,sport,base_price,active,recommended_rank,created_at,updated_at")
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

  const categoryName = useMemo(() => Object.fromEntries(categories.map((c) => [c.id, c.name])), [categories]);

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

  const tabbed = useMemo(
    () => products.filter((p) => activeCategory === "all" || p.category_id === activeCategory),
    [products, activeCategory],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return tabbed;
    return tabbed.filter(
      (p) => p.title.toLowerCase().includes(q) || (categoryName[p.category_id ?? ""] ?? "").toLowerCase().includes(q),
    );
  }, [tabbed, search, categoryName]);

  const columns: DataTableColumn<ProductRow>[] = [
    { key: "title", header: "Product", render: (p) => p.title },
    { key: "category", header: "Category", render: (p) => categoryName[p.category_id ?? ""] ?? "Uncategorised" },
    { key: "variants", header: "Variants", numeric: true, render: (p) => stockByProduct.get(p.id)?.variants ?? 0 },
    { key: "raw", header: "Raw stock", numeric: true, render: (p) => stockByProduct.get(p.id)?.raw ?? 0 },
    { key: "held", header: "Held", numeric: true, render: (p) => stockByProduct.get(p.id)?.held ?? 0 },
    { key: "price", header: "Base price", numeric: true, render: (p) => `Rs ${Number(p.base_price).toFixed(2)}` },
    {
      key: "state",
      header: "State",
      render: (p) => <Badge tone={p.active ? "success" : "neutral"}>{p.active ? "active" : "inactive"}</Badge>,
    },
  ];

  return (
    <div>
      <PageHeader breadcrumbs={[{ label: "Catalog" }]} title="Catalog" description="Every gear product, its variants, and what is really on the shelf." />

      <Tabs
        items={[
          { key: "all", label: "All", count: products.length },
          ...categories.map((c) => ({ key: c.id, label: c.name, count: products.filter((p) => p.category_id === c.id).length })),
        ]}
        active={activeCategory}
        onChange={(key) => setSearchParams(key === "all" ? {} : { category: key })}
      />

      <FilterBar
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search by product or category"
        resultCount={filtered.length}
        resultNoun={filtered.length === 1 ? "product" : "products"}
      />

      <DataTable
        columns={columns}
        rows={filtered}
        rowKey={(row) => row.id}
        rowHref={(row) => `/products/show/${row.id}`}
        loading={state === "loading"}
        emptyTitle={state === "error" ? "Could not load the catalog" : "No products found"}
        emptyBody={
          state === "error"
            ? "Something went wrong reading products. Try again."
            : "No products match this category and search."
        }
      />

      <p style={{ fontSize: "var(--text-sm)", color: "var(--color-text-secondary)", marginTop: "var(--space-md)" }}>
        Raw stock is the count on the shelf. Held is units reserved by a checkout in progress, still counted in
        raw stock because they have not been sold yet.
      </p>
    </div>
  );
}
