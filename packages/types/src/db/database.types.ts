// PLACEHOLDER. This file will be overwritten wholesale by:
//
//   supabase gen types typescript --linked --schema public > packages/types/src/db/database.types.ts
//
// once supabase/migrations/ contains the real migrations for every domain in
// docs/architecture/SCHEMA.md and the project is linked (or, for CI/local,
// `supabase gen types typescript --local` against the dockerized stack).
//
// Do not hand-edit the generated file when it lands; do not delete this
// comment block when regenerating, keep it as the header so future runs of
// the same gen command remain a clean diff instead of a surprise rewrite.
//
// Until generation happens, `db/rows.ts` in this package is the hand-authored
// stand-in every app imports from (via the barrel in `index.ts`), typed
// against the same table and column names this placeholder's `Database`
// shape will eventually have, so the swap is a re-export change, not an
// app-wide rename.
//
// The minimal shape below exists only so `Database` is a valid importable
// type today (some Supabase client typings expect a generic parameter);
// it carries zero real schema information and must not be relied on for
// anything beyond satisfying that generic.

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export interface Database {
  public: {
    Tables: Record<string, never>;
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
