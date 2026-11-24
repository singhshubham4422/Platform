import { createClient } from '@supabase/supabase-js';
import { createEdgeHandler } from '../_shared/http.js';
import { inviteUser } from '../_shared/handlers.js';
Deno.serve(createEdgeHandler({ run: inviteUser, env: Deno.env, createClient }));
