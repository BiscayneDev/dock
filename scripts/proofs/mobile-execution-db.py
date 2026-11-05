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
sql(open('db/migrations/0013_mobile_execution_draft.sql').read());sql(open('db/migrations/0014_mobile_execution_protocol_draft.sql').read())
proposal=sql('select id from mobile_task_proposals limit 1');e='00000000-0000-0000-0000-000000000099'
sql(f"update mobile_task_proposals set status='approved',approved_digest='digest'where id='{proposal}';insert into mobile_executions(id,proposal_id,owner_id,workspace_id,agent_key,repo_key,source_commit,approved_proposal_digest,owner_decision_ref,managed_budget_micros,max_compute_cost_micros,lifecycle_approved,cleanup_deadline,state,decision_expires_at,approved_text,source_paths)values('{e}','{proposal}','{o}','{w}','architect','dock','{'a'*40}','digest','fictional-owner-review',1000000,1000,true,now()+interval '10 minutes','approved',now()+interval '5 minutes','Review source',array['lib/memory.ts'])")
def claim_execution(i):return sql(f"select mobile_execution_transition('{e}','approved','provision_intent')")
with concurrent.futures.ThreadPoolExecutor(8)as ex:executionclaims=list(ex.map(claim_execution,range(8)))
assert executionclaims.count('t')==1 and executionclaims.count('f')==7
assert sql(f"select mobile_execution_transition('{e}','provision_intent','bound','{{\"instanceId\":\"isolated-one\"}}')")=='t'
assert sql(f"select mobile_execution_transition('{e}','bound','start_intent')")=='t'
assert sql(f"select mobile_execution_transition('{e}','start_intent','running','{{\"runId\":\"run-one\",\"threadId\":\"thread-one\"}}')")=='t'
try:sql(f"select mobile_execution_result('{e}','sibling','run-one','wrong result',true)");raise AssertionError('sibling result accepted')
except RuntimeError:pass
assert sql(f"select mobile_execution_result('{e}','isolated-one','run-one','Scoped architect finding',true)")=='t'
assert sql(f"select mobile_execution_result('{e}','isolated-one','run-one','Scoped architect finding',true)")=='f'
assert sql(f"select count(*) from messages where meta->>'executionId'='{e}'")=='1'
def cleanupclaim(i):return sql(f"select mobile_cleanup_claim('{e}')")
with concurrent.futures.ThreadPoolExecutor(8)as ex:cleanupclaims=list(ex.map(cleanupclaim,range(8)))
assert cleanupclaims.count('t')==1 and cleanupclaims.count('f')==7
print(json.dumps({'proof':'actual local PostgreSQL lifecycle draft','executionClaimWinners':executionclaims.count('t'),'cleanupClaimWinners':cleanupclaims.count('t'),'siblingResultRejected':True,'resultRecordedExactlyOnce':True,'canonicalMemoryAndNoticeAtomic':True,'liveOwnerApproval':False,'deployed':False}))
