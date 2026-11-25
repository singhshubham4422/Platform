import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const missing=['ATP_USER','ATP_PASSWORD','ATP_CONNECT_STRING'].filter(k=>!process.env[k]);
if(missing.length){console.error(`Missing environment variables: ${missing.join(', ')}`);process.exit(1);}
const driver=process.env.ATP_ORACLEDB_MODULE_DIR?await import(pathToFileURL(join(process.env.ATP_ORACLEDB_MODULE_DIR,'index.js')).href):await import('oracledb');
const oracledb=driver.default??driver;
// node-oracledb 6 defaults to Thin mode; no Oracle Client libraries are loaded.
let connection;
try { connection=await oracledb.getConnection({user:process.env.ATP_USER,password:process.env.ATP_PASSWORD,connectString:process.env.ATP_CONNECT_STRING});await connection.execute('select 1 from dual');console.log('ATP keep-alive query succeeded.'); }
catch(e){console.error(`ATP keep-alive failed: ${e.message}`);process.exitCode=1;}
finally{await connection?.close();}
