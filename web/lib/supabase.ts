import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !publishableKey) {
  throw new Error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY. " +
      "Copy web/.env.example to web/.env.local and fill both in.",
  );
}

// Publishable (anon) key, safe in the browser bundle for the intentionally
// public dashboard. Device writes use the authenticated server route instead.
export const supabase = createClient(url, publishableKey, {
  auth: { persistSession: false },
});
