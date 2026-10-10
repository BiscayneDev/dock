import {PGlite} from '@electric-sql/pglite'
import fs from 'node:fs'
const db=new PGlite()
await db.exec(`create schema extensions; create role anon; create role authenticated; create role service_role;
create function extensions.digest(text,text) returns bytea language sql immutable as $$select decode(md5($1),'hex')$$;
create table users(id uuid primary key, daily_briefing boolean,email_monitor_enabled boolean);
create table spectrum_identities(user_id uuid references users(id) on delete cascade,chat_guid text,handle text);
create table recipes(id uuid primary key,user_id uuid references users(id) on delete cascade,enabled boolean);
create table briefing_settings(user_id uuid,enabled boolean,muted boolean);
create table dinghy_pending_actions(user_id uuid,chat_guid text,status text);
create table spectrum_outbox(chat_guid text);
create table waitlist(id uuid primary key,phone text,email text);
create table waitlist_admit_queue(email text);
create table connect_tokens(user_id uuid,chat_id text);
create table spectrum_messages(id uuid primary key,chat_guid text,content text);
create table inference_usage(id uuid primary key,user_id uuid references users(id) on delete set null,chat_guid text);
`)
await db.exec(fs.readFileSync(process.argv[2] || 'supabase/migrations/068_account_erasure.sql','utf8'))
const user='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222'
await db.exec(`insert into users values('${user}',true,true),('${other}',true,true);insert into spectrum_identities values('${user}','chat-a','phone-a'),('${other}','chat-b','phone-b');insert into recipes values(gen_random_uuid(),'${user}',true);insert into spectrum_messages values(gen_random_uuid(),'chat-a','private'),(gen_random_uuid(),'chat-b','other');insert into inference_usage values(gen_random_uuid(),'${user}',null);insert into waitlist values(gen_random_uuid(),'phone-a','a@test');insert into waitlist_admit_queue values('a@test');`)
const {rows}=await db.query(`select dinghy_erasure_request($1,'hash') as id`,[user]);const id=rows[0].id
if((await db.query(`select dinghy_erasure_confirm($1,$2,'wrong') as ok`,[user,id])).rows[0].ok)throw Error('Bad hash accepted')
if(!(await db.query(`select dinghy_erasure_confirm($1,$2,'hash') as ok`,[user,id])).rows[0].ok)throw Error('Confirmation failed')
try{await db.exec(`insert into spectrum_messages values(gen_random_uuid(),'chat-a','resurrection')`);throw Error('Guard absent')}catch(e){if(e.message==='Guard absent')throw e}
try{await db.exec(`update spectrum_messages set chat_guid='chat-a' where chat_guid='chat-b'`);throw Error('Owner transition escaped guard')}catch(e){if(e.message==='Owner transition escaped guard')throw e}
await db.exec(`insert into spectrum_messages values(gen_random_uuid(),'chat-b','still allowed')`)
await db.exec(`update dinghy_erasure_jobs set frozen_at=now()-interval '6 minutes'`)
const job=(await db.query('select dinghy_erasure_claim() as job')).rows[0].job
if(job.id!==id)throw Error('Claim mismatch')
if(!(await db.query('select dinghy_erasure_finish($1) as ok',[id])).rows[0].ok)throw Error('Finish false')
const remaining=(await db.query(`select count(*)::int as n from spectrum_messages`)).rows[0].n
if(remaining!==2)throw Error('Other user affected')
if((await db.query('select count(*)::int as n from inference_usage')).rows[0].n!==0)throw Error('Usage orphan retained')
if((await db.query('select user_id,chats,status from dinghy_erasure_jobs')).rows[0].user_id!==null)throw Error('PII retained in job')
console.log('Synthetic migration PASS: confirm/hash, freeze/write rejection, other-user isolation, claim, hard delete, noncascade usage, job PII cleared.')
await db.close()
