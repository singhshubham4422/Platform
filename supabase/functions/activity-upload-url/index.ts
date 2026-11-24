import { createClient } from '@supabase/supabase-js';
import { createEdgeHandler } from '../_shared/http.js';
import { activityUploadUrl } from '../_shared/handlers.js';
Deno.serve(createEdgeHandler({ run: activityUploadUrl, env: Deno.env, createClient }));
