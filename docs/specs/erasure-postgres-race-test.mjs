import pg from 'pg';import fs from 'node:fs';const {Client}=pg;
const url=process.env.ERASURE_TEST_DATABASE_URL;if(!url)throw Error('Set ERASURE_TEST_DATABASE_URL to a disposable local database; this harness drops public schema');const a=new Client({connectionString:url}),b=new Client({connectionString:url});await a.connect();await b.connect();
await a.query(`drop schema public cascade;create schema public;create schema if not exists extensions;`);
for(const r of ['anon','authenticated','service_role'])await a.query(`do $$begin create role ${r};exception when duplicate_object then null;end$$`)
await a.query(`create extension if not exists pgcrypto with schema extensions;
create table users(id uuid primary key,telegram_id bigint,daily_briefing boolean,email_monitor_enabled boolean);
create table spectrum_identities(user_id uuid references users(id) on delete cascade,chat_guid text,handle text);
create table recipes(id uuid primary key,user_id uuid references users(id) on delete cascade,enabled boolean);
create table recipe_runs(id uuid primary key,recipe_id uuid references recipes(id),user_id uuid references users(id));
create table briefing_settings(user_id uuid,enabled boolean,muted boolean);
create table dinghy_pending_actions(user_id uuid,chat_guid text,status text);
create table spectrum_outbox(chat_guid text);
create table waitlist(id uuid primary key,phone text,email text);
create table waitlist_admit_queue(email text);
create table connect_tokens(user_id uuid,chat_id text);
create table spectrum_messages(id uuid primary key,chat_guid text,content text);
create table inference_usage(id uuid primary key,user_id uuid references users(id) on delete set null,chat_guid text);
`)
await a.query(fs.readFileSync(process.argv[2] || 'supabase/migrations/068_account_erasure.sql','utf8'))
const u='11111111-1111-4111-8111-111111111111',v='22222222-2222-4222-8222-222222222222';await a.query(`insert into users values('${u}',1,true,true),('${v}',2,true,true);insert into spectrum_identities values('${u}','a','pa'),('${v}','b','pb');insert into recipes values(gen_random_uuid(),'${u}',true);insert into recipe_runs select gen_random_uuid(),id,user_id from recipes;insert into inference_usage values(gen_random_uuid(),'${u}',null);`)
const id=(await a.query('select dinghy_erasure_request($1,$2) id',[u,'hash'])).rows[0].id
await a.query('begin');await a.query('select pg_advisory_xact_lock(hashtext($1))',['erase:user:'+u]);await a.query('select dinghy_erasure_confirm($1,$2,$3)',[u,id,'hash']);
let settled=false;const write=b.query("insert into spectrum_messages values(gen_random_uuid(),'a','race')").then(()=>{settled=true;return 'WRONG success'},e=>{settled=true;return e.message});await new Promise(r=>setTimeout(r,200));if(settled)throw Error('Writer did not block behind confirm transaction');await a.query('commit');const outcome=await write;if(!outcome.includes('Account unavailable'))throw Error(outcome)
await a.query("insert into spectrum_messages values(gen_random_uuid(),'b','other')");
await a.query("update dinghy_erasure_jobs set frozen_at=now()-interval '6 minutes'");const lease=(await a.query('select dinghy_erasure_claim() job')).rows[0].job.lease_token;
if((await a.query('select dinghy_erasure_finish($1,$2) ok',[id,null])).rows[0].ok)throw Error('Null lease accepted');
if((await a.query('select dinghy_erasure_heartbeat($1,$2) ok',[id,'33333333-3333-4333-8333-333333333333'])).rows[0].ok)throw Error('Wrong lease heartbeat accepted');
if(!(await a.query('select dinghy_erasure_heartbeat($1,$2) ok',[id,lease])).rows[0].ok)throw Error('Heartbeat failed');
try{await a.query('select dinghy_erasure_finish($1,$2)',[id,lease]);console.log('FK finish success')}catch(e){console.log('FK finish failure',e.message);throw e}
if((await a.query('select count(*)::int n from users')).rows[0].n!==1)throw Error('Other user removed');
console.log('Real PostgreSQL 14 + pgcrypto: two-transaction race PASS, other user untouched, FK fixture deletion PASS');await a.end();await b.end();
