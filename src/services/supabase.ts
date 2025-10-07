// backend/src/services/supabase.ts
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL as string;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY as string;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY as string;

// Define your Supabase bucket name from .env, with a fallback
export const SUPABASE_BUCKET_NAME = process.env.SUPABASE_BUCKET_NAME || 'gitstack-files';

if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceKey) {
  // Log an error but do not necessarily throw, to allow parts of the app
  // that don't rely on Supabase to still function.
  console.error("Supabase environment variables (SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_KEY) are not fully set. Supabase storage operations may fail.");
}

// Client for public reads (can be used on frontend too if needed, though Next.js handles env differently)
// This uses the anon key, suitable for clients that might read public objects with RLS.
export const supabasePublic = createClient(supabaseUrl, supabaseAnonKey);

// Client for authenticated/service role actions (for server-side mutations like upload/delete)
// This uses the service_role key, which bypasses RLS and is suitable for backend operations.
export const supabaseService = createClient(supabaseUrl, supabaseServiceKey);