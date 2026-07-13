import { createClient } from "@supabase/supabase-js";

// Env vars are placeholders in .env.example, real project values are filled
// in locally (.env.local, gitignored) and in the Vercel project settings.
// See docs/architecture/SCHEMA.md for the project this app targets.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn(
    "Supabase env vars are missing. Copy .env.example to .env.local and fill in the project URL and anon key.",
  );
}

export const supabaseClient = createClient(supabaseUrl ?? "", supabaseAnonKey ?? "", {
  auth: {
    persistSession: true,
  },
});
