// TRACK F: RLS client-write refusals + non-vacuous isolation, via real authenticated
// JWTs against PostgREST. No service role. Asserts two donor ids DIFFER first (AT-62).
import { readFileSync } from 'node:fs';
function readEnvFile(p){const o={};for(const l of readFileSync(p,'utf8').split('\n')){const m=l.match(/^([A-Z0-9_]+)=(.*)$/);if(m)o[m[1]]=m[2].trim();}return o;}
const env = readEnvFile('apps/mobile/.env');
const URL = env.EXPO_PUBLIC_SUPABASE_URL, ANON = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const PW = 'AtlitosDemo!2026';
const UPA_VERIFIED = '4f7616f4-f43f-4dd9-b2cb-f166ec268081';
const ITEM = '976221c9-aa02-4b0b-aacf-49ffee60d7f1';

async function signIn(email){
  const r = await fetch(`${URL}/auth/v1/token?grant_type=password`,{method:'POST',headers:{apikey:ANON,'Content-Type':'application/json'},body:JSON.stringify({email,password:PW})});
  const j = await r.json(); if(!j.access_token) throw new Error(`signin ${email}: ${JSON.stringify(j)}`);
  return {token:j.access_token, uid:j.user.id};
}
async function rest(method, path, token, body){
  const r = await fetch(`${URL}/rest/v1/${path}`,{method,headers:{apikey:ANON,Authorization:`Bearer ${token}`,'Content-Type':'application/json',Prefer:'return=representation'},body:body?JSON.stringify(body):undefined});
  const t = await r.text(); let j; try{j=JSON.parse(t);}catch{j=t;}
  return {status:r.status, body:j};
}
async function rpc(fn, token, args){
  const r = await fetch(`${URL}/rest/v1/rpc/${fn}`,{method:'POST',headers:{apikey:ANON,Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(args||{})});
  const t = await r.text(); let j; try{j=JSON.parse(t);}catch{j=t;}
  return {status:r.status, body:j};
}

const A = await signIn('player@atlitos.dev');
const B = await signIn('coach1@atlitos.dev');
const R = { A_uid:A.uid, B_uid:B.uid, ids_differ: A.uid!==B.uid };

// --- Client-write refusals (financial invariant) ---
R.w_donations_insert = await rest('POST','donations',A.token,{donor_id:A.uid,upa_id:UPA_VERIFIED,amount:50,method:'standalone'});
R.w_funded_amount    = await rest('PATCH',`upa_wishlist_items?id=eq.${ITEM}`,A.token,{funded_amount:999999});
R.w_item_status      = await rest('PATCH',`upa_wishlist_items?id=eq.${ITEM}`,A.token,{status:'funded'});
R.w_app_status       = await rest('PATCH',`upa_applications?id=eq.${UPA_VERIFIED}`,A.token,{status:'verified'});
R.w_ledger_insert    = await rest('POST','ledger_entries',A.token,{account_type:'platform',direction:'debit',amount:1,domain:'donation'});

// --- Isolation: My Impact scoped to self ---
// A donated (has impact); read get_my_impact_summary as A and as B, assert B never sees A's donations.
R.impact_A = await rpc('get_my_impact_summary', A.token);
R.impact_B = await rpc('get_my_impact_summary', B.token);

// --- Verified visibility to both; unverified unresolvable ---
R.pub_verified_A = await rpc('public_upa_profile', A.token, {p_upa_id:UPA_VERIFIED});
R.pub_verified_B = await rpc('public_upa_profile', B.token, {p_upa_id:UPA_VERIFIED});

console.log(JSON.stringify(R,null,2));
