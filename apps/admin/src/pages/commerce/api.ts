import { supabaseClient } from "../../providers/supabaseClient";

// AT-81 / AT-82. The one place apps/admin talks to the commerce back end, so
// the surfaces below cannot each invent their own call shape.
//
// TWO MECHANISMS, AND THE SPLIT IS NOT ARBITRARY:
//
//   * Catalog mutations go through the `admin_*` RPCs in
//     0039_admin_commerce_rpcs.sql. Each one does the row change AND its
//     audit_log row in a single transaction, which a client cannot do itself
//     because audit_log carries no authenticated write grant at all.
//   * The order lifecycle goes through the `admin-order-advance` EDGE
//     FUNCTION, because 0035's `order_transition` is granted to service_role
//     only and is unreachable from any client JWT by design.
//
// Nothing here writes an order status or a money value by table update, which
// is PRD-04 FR-26. There is no service role key in this bundle (FR-2); every
// call carries the signed in admin's own JWT.

/**
 * Postgres RPCs in this codebase raise `CODE: message` (0039, 0035, ...).
 * Edge functions return `{ error: { code, message } }`. Both are reduced to a
 * single shape here so a surface can show the real refusal instead of a
 * generic failure, which is what AT-82 means by "surfaced to the admin as a
 * real error rather than swallowed".
 */
export interface CommerceError {
  code: string;
  message: string;
}

export function parseRpcError(message: string): CommerceError {
  const match = message.match(/^([A-Z_]+):\s*(.*)$/);
  if (match) {
    return { code: match[1] as string, message: match[2] as string };
  }
  return { code: "INTERNAL", message };
}

/** One admin-facing line of inventory truth. See `admin_variant_stock`. */
export interface AdminVariantStock {
  product_variant_id: string;
  product_id: string;
  sku: string;
  size: string | null;
  color: string | null;
  price_override: number | null;
  /** Units Atlitos physically has. THE admin number. */
  raw_stock: number;
  /** Units spoken for by a checkout in progress, not yet sold. */
  held_qty: number;
  /** raw_stock minus held_qty. Context only, never presented as inventory. */
  available_stock: number;
}

export async function fetchVariantStock(productId?: string): Promise<AdminVariantStock[]> {
  const { data, error } = await supabaseClient.rpc("admin_variant_stock", {
    p_product_id: productId ?? null,
  });
  if (error) throw parseRpcError(error.message);
  return (data as AdminVariantStock[]) ?? [];
}

async function callRpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabaseClient.rpc(fn, args);
  if (error) throw parseRpcError(error.message);
  return data as T;
}

export interface MediaInput {
  storage_path: string;
  position: number;
  is_primary: boolean;
}

export const catalogApi = {
  createProduct: (input: {
    title: string;
    description: string;
    categoryId: string;
    basePrice: number;
    media: MediaInput[];
  }) =>
    callRpc("admin_create_product", {
      p_title: input.title,
      p_description: input.description,
      p_category_id: input.categoryId,
      p_base_price: input.basePrice,
      p_media: input.media,
    }),

  updateProduct: (input: {
    id: string;
    title: string;
    description: string;
    categoryId: string;
    basePrice: number;
  }) =>
    callRpc("admin_update_product", {
      p_id: input.id,
      p_title: input.title,
      p_description: input.description,
      p_category_id: input.categoryId,
      p_base_price: input.basePrice,
    }),

  setProductActive: (id: string, active: boolean) =>
    callRpc("admin_set_product_active", { p_id: id, p_active: active }),

  createVariant: (input: {
    productId: string;
    sku: string;
    size: string | null;
    color: string | null;
    priceOverride: number | null;
    stock: number;
  }) =>
    callRpc("admin_create_variant", {
      p_product_id: input.productId,
      p_sku: input.sku,
      p_size: input.size,
      p_color: input.color,
      p_price_override: input.priceOverride,
      p_stock: input.stock,
    }),

  updateVariant: (input: {
    id: string;
    sku: string;
    size: string | null;
    color: string | null;
    priceOverride: number | null;
  }) =>
    callRpc("admin_update_variant", {
      p_id: input.id,
      p_sku: input.sku,
      p_size: input.size,
      p_color: input.color,
      p_price_override: input.priceOverride,
    }),

  deleteVariant: (id: string) => callRpc("admin_delete_variant", { p_id: id }),

  /** FR-17. The reason is required by the RPC too, not only by the form. */
  adjustStock: (id: string, newStock: number, reason: string) =>
    callRpc("admin_adjust_variant_stock", {
      p_id: id,
      p_new_stock: newStock,
      p_reason: reason,
    }),

  setMedia: (productId: string, media: MediaInput[]) =>
    callRpc("admin_set_product_media", { p_product_id: productId, p_media: media }),
};

/**
 * AT-82 / gate clause 2. Drives one lifecycle step through the edge function.
 *
 * Deliberately does NOT decide whether the step is legal. `order_transition`
 * owns the machine and raises INVALID_TRANSITION; duplicating that rule here
 * would give it a second definition free to drift from the first, and would
 * mean a rejected skip was this file's opinion rather than the database's
 * guarantee. The UI calls this and shows whatever comes back.
 */
export async function advanceOrder(input: {
  orderId: string;
  toStatus: string;
  location: string | null;
  note: string | null;
}): Promise<{ status: string; order_number: string }> {
  const { data, error } = await supabaseClient.functions.invoke("admin-order-advance", {
    body: {
      order_id: input.orderId,
      to_status: input.toStatus,
      location: input.location,
      note: input.note,
    },
  });

  if (error) {
    // supabase-js surfaces a non 2xx as FunctionsHttpError and keeps the body
    // on `context`. Without reading it the admin would see "Edge Function
    // returned a non-2xx status code" instead of INVALID_TRANSITION, which is
    // exactly the swallowing AT-82 forbids.
    const context = (error as { context?: Response }).context;
    if (context && typeof context.json === "function") {
      try {
        const body = (await context.json()) as { error?: CommerceError };
        if (body?.error?.code) throw body.error;
      } catch (parsed) {
        if (parsed && typeof parsed === "object" && "code" in parsed) throw parsed;
      }
    }
    throw { code: "INTERNAL", message: error.message } satisfies CommerceError;
  }

  return data as { status: string; order_number: string };
}
