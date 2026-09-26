// ATLITOS v2 — supabase/functions/ai-search/fetch-people.ts
//
// Coaches, athletes and clips: the three non commerce entity reads of
// ai-search, moved out of index.ts unchanged in Phase L0 (ADR-014 component
// boundaries; docs/PLAN-SEARCH-LOCATION-AFFILIATE.md L0-T2). Every query is
// publicly scoped exactly as before; see the VISIBILITY note in index.ts.

import { AppError } from "../_shared/app-error.ts";
import { type Candidate, capitalize, type ParsedIntent, type Sport } from "./search-core.ts";

// deno-lint-ignore no-explicit-any
export async function fetchCoaches(supabase: any, intent: ParsedIntent, city?: string): Promise<Candidate[]> {
  let q = supabase
    .from("coach_profiles_public")
    .select("user_id, sport, city, state, bio, specialization, coaching_style, rating, rating_count")
    .limit(50);
  if (intent.sport !== "general") q = q.eq("sport", intent.sport);

  const { data, error } = await q;
  if (error) throw new AppError("INTERNAL", `Failed to load coaches: ${error.message}`, 500);
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.user_id as string);

  const [{ data: profiles }, { data: sessionTypes }] = await Promise.all([
    supabase.from("public_profiles").select("id, name, avatar_url").in("id", ids),
    supabase.from("session_types").select("coach_id, price, active").in("coach_id", ids),
  ]);

  const nameById = new Map<string, { name: string; avatar_url: string | null }>();
  for (const p of (profiles ?? []) as Array<Record<string, unknown>>) {
    nameById.set(p.id as string, { name: (p.name as string) ?? "Coach", avatar_url: (p.avatar_url as string) ?? null });
  }
  const minPriceById = new Map<string, number>();
  for (const s of (sessionTypes ?? []) as Array<Record<string, unknown>>) {
    if (!s.active) continue;
    const price = Number(s.price);
    const cid = s.coach_id as string;
    if (!minPriceById.has(cid) || price < (minPriceById.get(cid) as number)) minPriceById.set(cid, price);
  }

  return rows.map((r): Candidate => {
    const uid = r.user_id as string;
    const prof = nameById.get(uid);
    const spec = Array.isArray(r.specialization) ? (r.specialization as string[]) : [];
    const cityStr = (r.city as string) ?? "";
    const distanceKm = city && cityStr && city.toLowerCase() === cityStr.toLowerCase() ? 0 : undefined;
    return {
      entityType: "coach",
      entityId: uid,
      title: prof?.name ?? "Coach",
      // Carry state after city (BUG-002) so two coaches with the same sport and
      // city still read differently in the results row.
      subtitle: [capitalize(r.sport as string), cityStr, r.state as string].filter(Boolean).join(" . "),
      imageUrl: prof?.avatar_url ?? undefined,
      sport: r.sport as Sport,
      price: minPriceById.get(uid),
      rating: typeof r.rating === "number" ? r.rating : Number(r.rating) || undefined,
      distanceKm,
      text: [prof?.name, r.sport, cityStr, r.state, r.bio, r.coaching_style, spec.join(" ")]
        .filter(Boolean)
        .join(" ")
        .toLowerCase(),
    };
  });
}

// deno-lint-ignore no-explicit-any
export async function fetchAthletes(supabase: any, intent: ParsedIntent): Promise<Candidate[]> {
  let q = supabase
    .from("upa_applications")
    .select("id, story_headline, sport, region, state, photo_url")
    .eq("status", "verified")
    .limit(50);
  if (intent.sport !== "general") q = q.eq("sport", intent.sport);

  const { data, error } = await q;
  if (error) throw new AppError("INTERNAL", `Failed to load athletes: ${error.message}`, 500);
  const rows = (data ?? []) as Array<Record<string, unknown>>;

  return rows.map((r): Candidate => {
    const region = (r.region as string) ?? "";
    const state = (r.state as string) ?? "";
    return {
      entityType: "athlete",
      entityId: r.id as string,
      title: (r.story_headline as string) ?? "Athlete",
      subtitle: [capitalize((r.sport as string) ?? ""), region || state].filter(Boolean).join(" . "),
      imageUrl: typeof r.photo_url === "string" ? r.photo_url : undefined,
      sport: r.sport as Sport,
      rating: undefined,
      distanceKm: undefined,
      text: [r.story_headline, r.sport, region, state].filter(Boolean).join(" ").toLowerCase(),
    };
  });
}

// deno-lint-ignore no-explicit-any
export async function fetchClips(supabase: any, intent: ParsedIntent): Promise<Candidate[]> {
  let q = supabase
    .from("clips")
    .select("id, caption, sport, likes_count, thumb_path")
    .eq("status", "published")
    .limit(50);
  if (intent.sport !== "general") q = q.eq("sport", intent.sport);

  const { data, error } = await q;
  if (error) throw new AppError("INTERNAL", `Failed to load clips: ${error.message}`, 500);
  const rows = (data ?? []) as Array<Record<string, unknown>>;

  const maxLikes = Math.max(1, ...rows.map((r) => Number(r.likes_count) || 0));

  return rows.map((r): Candidate => {
    const thumb = r.thumb_path as string | null;
    return {
      entityType: "clip",
      entityId: r.id as string,
      title: (r.caption as string) ?? "Clip",
      subtitle: capitalize((r.sport as string) ?? "Clip"),
      imageUrl: typeof thumb === "string" && /^https?:\/\//.test(thumb) ? thumb : undefined,
      sport: r.sport as Sport,
      rating: (Math.min(1, (Number(r.likes_count) || 0) / maxLikes) * 5) || undefined,
      distanceKm: undefined,
      text: [r.caption, r.sport].filter(Boolean).join(" ").toLowerCase(),
    };
  });
}
