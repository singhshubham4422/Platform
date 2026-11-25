import { createClient } from '@supabase/supabase-js';
import { createEdgeHandler } from '../_shared/http.js';
import { submitAssessmentAttempts } from '../_shared/assessments.js';
import * as packFormat from '../_shared/pack-format.js';

Deno.serve(createEdgeHandler({ run: (args) => submitAssessmentAttempts({ ...args, packFormat }), env: Deno.env, createClient }));
