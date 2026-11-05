import pgserver,subprocess,concurrent.futures,tempfile,json
srv=pgserver.get_server(tempfile.mkdtemp(prefix='dock-mobile-pg-'));uri=srv.get_uri()
def sql(q):
 p=subprocess.run(['/usr/lib/postgresql/14/bin/psql',uri,'-tAX','-v','ON_ERROR_STOP=1','-c',q],capture_output=True,text=True)
 if p.returncode:raise RuntimeError(p.stderr)
 return p.stdout.strip()
sql("create role anon; create role authenticated; create role service_role; create table users(id uuid primary key); create table workspaces(id uuid primary key,owner_id uuid); create table projects(id uuid primary key,workspace_id uuid); create table devices(id uuid primary key,owner_id uuid,workspace_id uuid,revoked_at timestamptz); create table conversations(id uuid primary key default gen_random_uuid(),workspace_id uuid,owner_id uuid,project_id uuid,title text,agent text,preview text,updated_at timestamptz); create table memory_items(id uuid primary key default gen_random_uuid(),workspace_id uuid,owner_id uuid,project_id uuid,scope text,type text,content text,conversation_id uuid);create table messages(id uuid primary key default gen_random_uuid(),conversation_id uuid,role text,content text,agent text,meta jsonb,created_at timestamptz default now());")
sql(open('db/migrations/0012_mobile_foundations.sql').read())
o='00000000-0000-0000-0000-000000000001';w='00000000-0000-0000-0000-000000000002';d='00000000-0000-0000-0000-000000000003';r='00000000-0000-0000-0000-000000000004';r2='00000000-0000-0000-0000-000000000005'
sql(f"insert into users values('{o}'); insert into workspaces values('{w}','{o}');insert into devices(id,owner_id,workspace_id,revoked_at,purpose) values('{d}','{o}','{w}',null,'mobile');insert into mobile_grants(device_id,owner_id,workspace_id,agent_key,repo_keys,inference_enabled)values('{d}','{o}','{w}','chief',array['dock'],true)")
def opening(i):return json.loads(sql(f"select mobile_open('{d}','{o}','{w}','{r}')"))['id']
with concurrent.futures.ThreadPoolExecutor(8)as ex: sessions=list(ex.map(opening,range(8)))
assert len(set(sessions))==1; s=sessions[0]
def claiming(i):return json.loads(sql(f"select mobile_claim('{s}','{d}','{o}','{w}','{r}','same')"))['status']
with concurrent.futures.ThreadPoolExecutor(8)as ex:claims=list(ex.map(claiming,range(8)))
assert claims.count('claimed')==1 and claims.count('pending')==7,claims
assert json.loads(sql(f"select mobile_claim('{s}','{d}','{o}','{w}','{r2}','other')"))['status']=='busy'
try:sql(f"select mobile_claim('{s}','{d}','{o}','{w}','{r}','altered')");raise AssertionError('conflict accepted')
except RuntimeError:pass
sql(f'''select mobile_complete('{s}','{d}','{o}','{w}','{r}','same','owner question','canonical response','{{"text":"canonical response","contextVersion":"v1"}}')''')
assert sql('select count(*) from memory_items')=='1';assert sql('select count(*) from messages')=='2';assert sql('select count(*) from mobile_notices')=='1';assert json.loads(sql(f"select mobile_claim('{s}','{d}','{o}','{w}','{r}','same')"))['status']=='complete'
notice=sql('select id from mobile_notices limit 1')
assert sql(f"select mobile_ack_notice('{s}','{d}','{o}','{w}','{notice}')")=='t'
assert sql('select count(*) from mobile_notices where delivered_at is not null')=='1'
assert json.loads(sql(f"select mobile_claim('{s}','{d}','{o}','{w}','{r2}','next')"))['status']=='claimed'
proposal={'text':'Proposed work','proposals':[{'goal':'Review canonical memory','budgetCents':100,'assignments':[{'agentKey':'architect','prompt':'Review'}]}]}
sql(f"select mobile_complete('{s}','{d}','{o}','{w}','{r2}','next','Review request','Proposed work','{json.dumps(proposal)}')")
assert sql('select count(*) from mobile_task_proposals')=='1'
assert sql('select count(*) from memory_items')=='2'
sql(f"update mobile_grants set revoked_at=now() where device_id='{d}'")
try:claiming(1);raise AssertionError('revoked accepted')
except RuntimeError:pass

sql(f"update mobile_grants set revoked_at=null where device_id='{d}'")
sql("create schema auth;create function auth.uid()returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$")
sql("alter table memory_items add column created_at timestamptz default now()")
sql(open('db/migrations/0020_beacon_memory_draft.sql').read())
def refused(q):
 try:sql(q);raise AssertionError('Expected refusal')
 except RuntimeError:pass
identity=f"'{d}','{o}','{w}',null,'chief'"
note=sql(f"select beacon_mobile_note({identity},'Private architecture note','fixture:conversation')")
candidate=sql(f"select beacon_mobile_distill({identity},'{note}','Reviewed shared architecture')")
# A second real registered agent with an independent paired device.
d2='00000000-0000-0000-0000-000000000006'
sql(f"insert into devices(id,owner_id,workspace_id,purpose)values('{d2}','{o}','{w}','mobile');insert into mobile_grants(device_id,owner_id,workspace_id,agent_key,repo_keys,inference_enabled)values('{d2}','{o}','{w}','architect',array['dock'],false)")
other=f"'{d2}','{o}','{w}',null,'architect'"
assert sql(f"select count(*)from beacon_mobile_recall({other},'Private',20)")=='0'
assert sql(f"select count(*)from beacon_mobile_recall({identity},'Private',20)")=='1'
assert sql(f"select count(*)from beacon_mobile_recall({identity},'Reviewed',20)where id='{candidate}'")=='0'
refused(f"select beacon_promote('{candidate}','00000000-0000-0000-0000-000000000098','Reviewed shared architecture')")
refused(f"select beacon_promote('{candidate}','{o}','Changed content')")
def promote(i):
 try:return sql(f"select beacon_promote('{candidate}','{o}','Reviewed shared architecture')")
 except RuntimeError:return 'refused'
with concurrent.futures.ThreadPoolExecutor(8)as ex:decisions=list(ex.map(promote,range(8)))
assert decisions.count('refused')==7
assert sql(f"select count(*)from beacon_mobile_recall({other},'Reviewed',20)where visibility='business'")=='0'
sql(f"insert into memory_agent_assignments(workspace_id,agent_key)values('{w}','architect')")
assert sql(f"select count(*)from beacon_mobile_recall({other},'Reviewed',20)where visibility='business'")=='1'
sql(f"update memory_agent_assignments set revoked_at=now()where workspace_id='{w}'")
assert sql(f"select count(*)from beacon_mobile_recall({other},'Reviewed',20)where visibility='business'")=='0'
refused(f"select beacon_mobile_distill({other},'{note}','Steal sibling note')")
sql(f"update devices set revoked_at=now()where id='{d}'")
refused(f"select *from beacon_mobile_recall({identity},'Private',20)")
assert sql("select count(*)from memory_items where visibility='business'")=='1'
assert sql("select count(*)from memory_items where visibility='personal'")=='2'
print(json.dumps({'proof':'Real local PostgreSQL Beacon recall distill promote on existing memory_items','privateSiblingReadRefused':True,'unapprovedCandidateNotRecalled':True,'changedPromotionRefused':True,'unauthorizedPromotionRefused':True,'concurrentPromotions':8,'promotionWinners':1,'businessAssignmentRequired':True,'assignmentRevocationImmediate':True,'revokedDeviceRefused':True,'legacyRowsRemainPersonal':True,'fixtureAuthorityOnly':True,'deployed':False}))
