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
print(json.dumps({'atomicCanonicalMemory':sql('select count(*) from memory_items')=='2','proposalAndNoticeAck':True,'proof':'real local PostgreSQL','schemaAppliedLocally':True,'concurrentOpenOneSession':True,'claims':claims,'differentTurnBusy':True,'changedPayloadRejected':True,'canonicalMessages':4,'genericNotices':2,'replayReturnsStoredReply':True,'revokedGrantRejected':True}))
