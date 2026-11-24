import { createClient } from '@supabase/supabase-js';
import { createEdgeHandler } from '../_shared/http.js';
import { publishPack } from '../_shared/handlers.js';
import * as packFormat from '../_shared/pack-format.js';
Deno.serve(createEdgeHandler({ run: (args) => publishPack({ ...args, packFormat }), env: Deno.env, createClient }));
