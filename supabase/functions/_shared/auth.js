import { unauthorized } from './errors.js';

export function bearerToken(header) {
  const match=/^Bearer\s+([^\s]+)$/i.exec(header??'');
  if(!match) throw unauthorized();
  return match[1];
}

/** Build one RLS-scoped user client and a separate service client for explicitly authorized writes. */
export async function createSupabaseClients({authorization,env,createClient}) {
  const token=bearerToken(authorization);
  const url=env.get('SUPABASE_URL');
  const anon=env.get('SUPABASE_ANON_KEY');
  const service=env.get('SUPABASE_SERVICE_ROLE_KEY');
  if(!url||!anon||!service) throw new Error('SUPABASE_CONFIGURATION_MISSING');
  const userClient=createClient(url,anon,{global:{headers:{Authorization:`Bearer ${token}`}},auth:{persistSession:false,autoRefreshToken:false}});
  const {data,error}=await userClient.auth.getUser(token);
  if(error||!data?.user) throw unauthorized('Invalid access token');
  const serviceClient=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
  return {userClient,serviceClient,user:data.user};
}
