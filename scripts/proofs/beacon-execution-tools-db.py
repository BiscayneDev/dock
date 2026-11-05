import pgserver,subprocess,concurrent.futures,tempfile,json
srv=pgserver.get_server(tempfile.mkdtemp(prefix='dock-mobile-pg-'));uri=srv.get_uri()
import atexit,signal;atexit.register(srv.cleanup);signal.signal(signal.SIGTERM,lambda *args:__import__('sys').exit(0))
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
sql(open('db/migrations/0015_mobile_model_holds_draft.sql').read())
sql(open('db/migrations/0018_mobile_execution_capabilities_draft.sql').read());sql(open('db/migrations/0019_mobile_capability_protocol_draft.sql').read())
def refused(q):
 try:sql(q);raise AssertionError('Expected refusal')
 except RuntimeError:pass
sql(f"update mobile_executions set state='bound'where id='{e}'")
refused(f"select mobile_capability_issue('{e}','{'a'*64}',now()+interval '6 minutes')")
cap=sql(f"select mobile_capability_issue('{e}','{'a'*64}',now()+interval '4 minutes')")
refused(f"select mobile_capability_issue('{e}','{'b'*64}',now()+interval '4 minutes')")
def hold(i,hash='a'*64):
 try:return sql(f"select mobile_capability_reserve('{cap}','{hash}','00000000-0000-0000-0000-{100+i:012d}','quote',600000)")
 except RuntimeError:return 'refused'
assert hold(99,'b'*64)=='refused'
sql("create schema auth;create function auth.uid()returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;alter table memory_items add column created_at timestamptz default now()")
sql(open('db/migrations/0020_beacon_memory_draft.sql').read());sql(open('db/migrations/0021_beacon_execution_tools_draft.sql').read())
def tool(op,text,note=None,hash='a'*64):
 note_arg="null"if note is None else"'"+note+"'"
 return json.loads(sql(f"select beacon_execution_memory('{cap}','{hash}','{op}','{text}',{note_arg})"))
note=tool('note','Private specialist lesson')['id'];candidate=tool('distill','Distilled specialist candidate',note)['id']
assert tool('recall','Private specialist')[0]['id']==note
assert not any(row['id']==candidate for row in tool('recall','Distilled specialist'))
try:tool('promote','Must not share');raise AssertionError('Agent promotion accepted')
except RuntimeError:pass
try:tool('recall','Private specialist',hash='b'*64);raise AssertionError('Wrong secret accepted')
except RuntimeError:pass
# A distinct child with the same role must not inherit this execution's notes.
sibling='00000000-0000-0000-0000-000000000097'
siblingproposal=sql(f"insert into mobile_task_proposals(session_id,request_id,ordinal,owner_id,workspace_id,proposal,status,approved_digest)select session_id,gen_random_uuid(),ordinal,owner_id,workspace_id,proposal,status,approved_digest from mobile_task_proposals where id='{proposal}' returning id").splitlines()[0]
sql(f"insert into mobile_executions(id,proposal_id,owner_id,workspace_id,agent_key,repo_key,source_commit,approved_proposal_digest,owner_decision_ref,managed_budget_micros,max_compute_cost_micros,lifecycle_approved,cleanup_deadline,state,decision_expires_at,approved_text,source_paths)select '{sibling}','{siblingproposal}',owner_id,workspace_id,agent_key,repo_key,source_commit,approved_proposal_digest,owner_decision_ref,managed_budget_micros,max_compute_cost_micros,lifecycle_approved,cleanup_deadline,'bound',decision_expires_at,approved_text,source_paths from mobile_executions where id='{e}'")
assert sql(f"select count(*)from beacon_execution_recall('{sibling}','Private specialist',20)")=='0'
sql(f"update mobile_executions set instance_id='isolated-same-role'where id='{sibling}'")
siblingcap=sql(f"select mobile_capability_issue('{sibling}','{'c'*64}',now()+interval '3 minutes')")
refused(f"select beacon_execution_memory('{siblingcap}','{'c'*64}','distill','Steal same role note','{note}')")
siblingnote=json.loads(sql(f"select beacon_execution_memory('{siblingcap}','{'c'*64}','note','Same-role sibling private')"))['id']
assert not any(row['id']==siblingnote for row in tool('recall','Same-role sibling'))
assert tool('recall','Private specialist')[0]['id']==note
sql(f"update mobile_executions set state='running',run_id='private-result-run'where id='{sibling}'")
assert sql(f"select mobile_execution_result('{sibling}','isolated-same-role','private-result-run','Private same-role result sentinel',true)")=='t'
assert sql(f"select mobile_execution_result('{sibling}','isolated-same-role','private-result-run','Private same-role result sentinel',true)")=='f'
assert tool('recall','Private same-role result sentinel')==[]
assert sql("select count(*)from memory_items where content like '%Private same-role result sentinel%'")=='0'
assert sql("select count(*)from messages where content='Private same-role result sentinel'")=='1'
sql(f"update mobile_executions set agent_key='sibling'where id='{e}'")
assert tool('recall','Private specialist')==[]
try:tool('distill','Steal sibling note',note);raise AssertionError('Sibling note accepted')
except RuntimeError:pass
sql(f"update mobile_execution_capabilities set revoked_at=now()where id='{cap}'")
try:tool('note','After revocation');raise AssertionError('Revoked note accepted')
except RuntimeError:pass
assert sql("select count(*)from memory_items where visibility='business'")=='0'
print(json.dumps({'proof':'Real local PostgreSQL execution capability Beacon tools','sameRoleSiblingWritesIsolated':True,'privateResultNotAutoRecalledOrPromoted':True,'privateResultReplayIdempotent':True,'sameRoleSiblingRecallExcluded':True,'sameRoleSiblingDistillRefused':True,'ownPrivateNoteRecalled':True,'distilledCandidateNotShared':True,'agentPromotionUnavailable':True,'wrongSecretRefused':True,'siblingPrivateNoteExcluded':True,'siblingDistillRefused':True,'revokedCapabilityRefused':True,'businessWrites':0,'fixtureAuthorityOnly':True,'deployed':False}))
