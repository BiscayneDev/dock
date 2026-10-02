const { PGlite } = require('@electric-sql/pglite');
const fs = require('fs');
const path = require('path');
(async () => {
 const db = new PGlite();
 await db.exec(`create role anon; create role authenticated; create role service_role;
 create table dinghy_files(id uuid primary key default gen_random_uuid(),user_id uuid,chat_guid text,title text,format text,url text,markdown text,expires_at timestamptz,created_at timestamptz default now(),deleted_at timestamptz);
 alter table dinghy_files enable row level security;
 revoke all on dinghy_files from public,anon,authenticated;
 insert into dinghy_files(user_id,title,format,markdown) values('00000000-0000-4000-8000-000000000001','Existing file','page','keep');`);
 const sql = fs.readFileSync(path.join(process.cwd(),'supabase/migrations/064_profile_files.sql'),'utf8');
 await db.exec(sql); await db.exec(sql);
 const rows = await db.query(`select kind,revoked_at,markdown from dinghy_files`);
 if(rows.rows[0].kind !== 'file' || rows.rows[0].revoked_at !== null || rows.rows[0].markdown !== 'keep') throw Error('existing file changed');
 await db.exec(`update dinghy_files set revoked_at=now();`);
 const permissions = await db.query(`select has_table_privilege('anon','dinghy_files','SELECT') as anon,has_table_privilege('authenticated','dinghy_files','SELECT') as authenticated`);
 if(permissions.rows[0].anon || permissions.rows[0].authenticated) throw Error('privacy regression');
 try { await db.exec(`insert into dinghy_files(title,format,kind,markdown) values('daily brief','md','brief','do not save')`); throw Error('brief kind accepted'); } catch(e) { if(e.message==='brief kind accepted') throw e; }
 console.log('SQL PASS: metadata migration syntax, rerun safety, existing-content preservation, privacy privileges, revocation and rejection of brief kind');
 await db.close();
})().catch(e => {console.error(e);process.exit(1)});
