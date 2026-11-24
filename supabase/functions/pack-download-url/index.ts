import { createClient } from '@supabase/supabase-js';
import { createEdgeHandler } from '../_shared/http.js';
import { packDownloadUrl } from '../_shared/handlers.js';
Deno.serve(createEdgeHandler({ run: packDownloadUrl, env: Deno.env, createClient }));
