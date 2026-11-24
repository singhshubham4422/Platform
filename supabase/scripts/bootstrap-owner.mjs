#!/usr/bin/env node
import {createRequire} from 'node:module';

const args={};for(let i=2;i<process.argv.length;i++){const token=process.argv[i];if(!token.startsWith('--'))continue;const name=token.slice(2);const next=process.argv[i+1];if(next&&!next.startsWith('--')){args[name]=next;i++}else args[name]=true}
const email=args.email?.trim().toLowerCase();const fullName=args['full-name']?.trim();const dbUrl=args['database-url'];
if(!email||!fullName||!dbUrl){console.error('Usage: bootstrap-owner.mjs --database-url <url> --email <email> --full-name <name> [--local-stub]');process.exit(2)}
const domain=email.split('@')[1]??'';
if(domain.startsWith('example.')||domain.endsWith('.test')||domain.endsWith('.local')||domain.includes('demo')){console.error('Refusing a test, example, local or demo email domain.');process.exit(2)}
const require=createRequire(new URL('../../packages/supabase-tests/package.json',import.meta.url));
const pg=require('pg').default??require('pg');
const pool=new pg.Pool({connectionString:dbUrl});
try{const c=await pool.connect();try{await c.query('BEGIN');const existing=await c.query("SELECT 1 FROM public.profiles WHERE role='PLATFORM_OWNER' LIMIT 1");if(existing.rowCount){throw new Error('A PLATFORM_OWNER already exists.')}
 let id;
 if(args['local-stub']){if(process.env.NODE_ENV==='production')throw new Error('--local-stub is test-only');id=crypto.randomUUID();await c.query('INSERT INTO auth.users(id,email) VALUES($1,$2)',[id,email]);}
 else {const url=process.env.SUPABASE_URL;const key=process.env.SUPABASE_SERVICE_ROLE_KEY;if(!url||!key)throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for Auth Admin creation.');const response=await fetch(`${url.replace(/\/$/,'')}/auth/v1/admin/users`,{method:'POST',headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({email,email_confirm:true,user_metadata:{full_name:fullName}})});const body=await response.json();if(!response.ok)throw new Error(`Supabase Auth Admin failed (${response.status}).`);id=body.id;}
 await c.query("INSERT INTO public.profiles(id,organization_id,role,full_name,email,status) VALUES($1,NULL,'PLATFORM_OWNER',$2,$3,'ACTIVE')",[id,fullName,email]);await c.query('COMMIT');console.log('Platform owner profile created.');}catch(e){await c.query('ROLLBACK').catch(()=>{});throw e}finally{c.release()}}catch(e){console.error(`Bootstrap failed: ${e.message}`);process.exitCode=1}finally{await pool.end()}
