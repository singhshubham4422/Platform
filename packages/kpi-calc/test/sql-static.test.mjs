import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile,readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../../oracle/atp/sql');
test('ATP SQL has statement boundaries, no embedded credentials, and uses lp_secrets for outbound REST',async()=>{
 const files=(await readdir(root)).filter(x=>x.endsWith('.sql'));assert.equal(files.length,7);
 const all=[];for(const file of files){const text=await readFile(path.join(root,file),'utf8');assert.doesNotMatch(text,/eyJ[A-Za-z0-9_-]{20,}/);assert.doesNotMatch(text,/password\s*=>\s*'[^&<][^']+'/i);const statements=text.split(/\n\/\s*\n|;\s*(?=\s|$)/).map(x=>x.replace(/--[^\n]*/g,'').trim()).filter(Boolean);assert.ok(statements.length>0,`${file} should split into SQL statements`);all.push([file,text]);}
 for(const [name,text] of all.filter(([n])=>n==='004_dimensions.sql'||n==='006_publish.sql'))for(const match of text.matchAll(/DBMS_CLOUD\.SEND_REQUEST/gi)){const statement=text.slice(Math.max(0,match.index-600),match.index+1500);assert.match(statement,/lp_secrets/i,`${name} SEND_REQUEST must obtain credentials from lp_secrets`)}
 const ddl=(await readFile(path.resolve(root,'../../../supabase/migrations/20261124000004_kpi.sql'),'utf8')).toLowerCase(),publish=(await readFile(path.join(root,'006_publish.sql'),'utf8').then(x=>x.toLowerCase()));
 const columns={kpi_student_daily:['organization_id','user_id','day','active_minutes','questions_attempted','questions_solved','runs','submits','accepted_submits','typed_chars','paste_chars','paste_ratio','focus_lost_count','idle_minutes','computed_at'],kpi_student_topic:['organization_id','user_id','topic','attempted','solved','mastery','computed_at'],kpi_assessment:['organization_id','assessment_id','user_id','score','solved','total_questions','time_minutes','flags','computed_at']};
 for(const [table,cols] of Object.entries(columns)){assert.match(ddl,new RegExp(`create table public\\.${table}`));for(const col of cols)assert.ok(publish.includes(`'${col}' value`),`006_publish.sql must send ${table}.${col}`)}
});
