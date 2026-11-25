import { createClient } from '@supabase/supabase-js';
import { createEdgeHandler } from '../_shared/http.js';
import { assessmentKey } from '../_shared/assessments.js';

Deno.serve(createEdgeHandler({ run: assessmentKey, env: Deno.env, createClient }));
