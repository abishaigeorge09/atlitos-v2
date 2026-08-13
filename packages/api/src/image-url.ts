// ATLITOS v2 — packages/api/src/image-url.ts
//
// SCALE-MEDIA M-6. The single place a stored image URL is asked for at the size
// it is actually painted at.
//
// Before this file there was ZERO image transformation and zero client side
// resize anywhere in the monorepo: every `getPublicUrl` call site passed no
// transform, no `package.json` carried an image manipulator, and avatar and
// cover picks went up at native camera resolution. The one genuinely user
// uploaded avatar in production is 298,490 bytes and renders into an 80 px
// circle, a 37x over fetch, plus a full decode of a multi megapixel bitmap for
// a circle the size of a thumbnail. A twenty row members list is 5.96 MB to
// paint twenty circles that need 160 KB, and at 10,000 users with a 30 percent
// avatar set rate that alone exceeds the whole 250 GB monthly egress quota
// before a single video plays.
//
// HOW IT WORKS. Supabase serves a resized render of any object in a PUBLIC
// bucket from `/storage/v1/render/image/public/...` with `width`, `height`,
// `resize` and `quality` query parameters, the same endpoint `getPublicUrl`'s
// own `transform` option targets. Most call sites here already hold a resolved
// public URL rather than a bucket and a path, so this rewrites the URL instead
// of threading an options object through nine signatures.
//
// COST, so it is not a surprise later: transformed images are billed per unique
// origin image per month (100 included on Pro, then $5 per 1,000), so this is
// roughly $30/month at 3,000 avatars in two sizes, against 270 GB of egress
// avoided. Only ask for a size you are actually going to paint.

const OBJECT_PUBLIC_SEGMENT = "/storage/v1/object/public/";
const RENDER_PUBLIC_SEGMENT = "/storage/v1/render/image/public/";

export interface SizedImageOptions {
  /** Painted width in device pixels. Pass the layout size times the device
   * pixel ratio, or just the largest size the image is ever painted at. */
  width: number;
  /** Painted height in device pixels. Defaults to `width` (square crop). */
  height?: number;
  /** `cover` crops to fill, the right default for avatars and grid tiles. */
  resize?: "cover" | "contain" | "fill";
  /** JPEG quality, 20 to 100. 70 is visually clean at thumbnail sizes. */
  quality?: number;
}

/**
 * Return `url` rewritten to Supabase's image transformation endpoint at the
 * requested size.
 *
 * Returns the input UNCHANGED, never throws, when it cannot safely rewrite:
 * a null or empty value, a URL that already points at the render endpoint, a
 * signed URL (`/object/sign/`, which the transform endpoint does not serve the
 * same way and which carries a token in its query string), or any URL that is
 * not a Supabase public object URL at all, for example the absolute fixture
 * URLs `use-empower` deliberately passes through.
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

/** Sizes the render sites in this repo actually paint at, so a caller picks a
 * name rather than inventing a number and defeating the per image cache. */
export const IMAGE_SIZE = {
  /** Avatars: 80 px circle at a 3x device pixel ratio is 240 px. */
  avatar: 240,
  /** Product and venue grid tiles, and the promo carousel. */
  tile: 600,
  /** A full width product or venue hero on a phone. */
  hero: 1080,
} as const;
