// ATLITOS v2 — apps/portal-life/src/lib/image-url.ts
//
// SCALE-MEDIA M-6, portal-life half. The mobile half lives in
// packages/api/src/image-url.ts and is the canonical explanation of the
// mechanism and the cost model. Read that file first.
//
// WHY THIS IS A COPY RATHER THAN AN IMPORT. `@atlitos/api` ships as raw
// TypeScript source ("no build step until an app bundler needs one") and no
// portal depends on it: mobile is its only consumer, and no next.config.ts in
// this repo sets `transpilePackages`. Pulling an untranspiled workspace source
// package into a Next build for the sake of a twenty line URL rewrite trades a
// small duplication for a build risk in three apps, so the duplication wins.
// If a portal ever takes a real `@atlitos/api` dependency, delete this file and
// import `sizedImageUrl` from there instead.
//
// portal-court does NOT need this: it holds bucket paths, so it passes
// `transform` straight to `getPublicUrl`. portal-life holds already-resolved
// full URLs, because the apply wizard and the gratitude composer both store
// `getPublicUrl(...).data.publicUrl` verbatim into `photo_url`, which is why a
// rewrite is the shape that fits here.

const OBJECT_PUBLIC_SEGMENT = "/storage/v1/object/public/";
const RENDER_PUBLIC_SEGMENT = "/storage/v1/render/image/public/";

export interface SizedImageOptions {
  /** Painted width in device pixels: the CSS size times the device pixel ratio. */
  width: number;
  /** Painted height in device pixels. Defaults to `width` (square crop). */
  height?: number;
  resize?: "cover" | "contain" | "fill";
  quality?: number;
}

/**
 * Return `url` rewritten to Supabase's image transformation endpoint at the
 * requested size, or unchanged when it cannot safely be rewritten: empty, an
 * already-transformed URL, or any URL that is not a Supabase public object URL,
 * which covers the absolute fixture URLs on other hosts that `upa_applications`
 * still carries in production.
 */
export function sizedImageUrl(
  url: string | null | undefined,
  options: SizedImageOptions,
): string | undefined {
  if (!url) return undefined;
  if (url.includes(RENDER_PUBLIC_SEGMENT)) return url;
  if (!url.includes(OBJECT_PUBLIC_SEGMENT)) return url;

  const width = Math.max(1, Math.round(options.width));
  const height = Math.max(1, Math.round(options.height ?? options.width));
  const quality = Math.min(100, Math.max(20, Math.round(options.quality ?? 70)));
  const resize = options.resize ?? "cover";

  const [base, existingQuery] = url.split("?");
  if (!base) return url;

  const params = new URLSearchParams(existingQuery ?? "");
  params.set("width", String(width));
  params.set("height", String(height));
  params.set("resize", resize);
  params.set("quality", String(quality));

  return `${base.replace(OBJECT_PUBLIC_SEGMENT, RENDER_PUBLIC_SEGMENT)}?${params.toString()}`;
}
