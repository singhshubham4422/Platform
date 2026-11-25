import { createClient } from '@supabase/supabase-js';
import { createEdgeHandler } from '../_shared/http.js';
import { registerDevice } from '../_shared/assessments.js';

Deno.serve(createEdgeHandler({ run: registerDevice, env: Deno.env, createClient }));
