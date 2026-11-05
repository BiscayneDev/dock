import pgserver,subprocess,tempfile,uuid,concurrent.futures,json,os
from pathlib import Path
srv=pgserver.get_server(tempfile.mkdtemp(prefix='t3-release-db-'));uri=srv.get_uri()
def sql(q,fail=False):
 r=subprocess.run(['psql',uri,'-qAt','-v','ON_ERROR_STOP=1','-c',q],capture_output=True,text=True)
 if fail:assert r.returncode;return
 if r.returncode:raise RuntimeError(r.stderr)
 return r.stdout.strip()
def uid():return str(uuid.uuid4())
a,b,wa,wb,pa,pb=[uid()for _ in range(6)]
sql("create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema public,auth to authenticated,anon,service_role;create table users(id uuid primary key);create table workspaces(id uuid primary key,owner_id uuid references users);create table projects(id uuid primary key,workspace_id uuid references workspaces);grant select on workspaces,projects to authenticated;")
sql(f"insert into users values('{a}'),('{b}');insert into workspaces values('{wa}','{a}'),('{wb}','{b}');insert into projects values('{pa}','{wa}'),('{pb}','{wb}');")
sql((Path(__file__).resolve().parents[2]/'supabase/migrations/20261104_t3_owner_tasks.sql').read_text())
def owner(q,who=a):return f"set role authenticated;set request.jwt.claim.sub='{who}';{q}"
def submit(project=pa,who=a):return sql(owner(f"select submit_t3_owner_task('{uid()}','{project}','fictional','{'a'*40}','Fictional task',now()+interval '20 minutes')",who))
t=submit();assert sql(owner('select count(*)from t3_owner_tasks'))=='1';assert sql(owner('select count(*)from t3_owner_tasks',b))=='0'
sql(owner(f"update t3_owner_tasks set phase='deleted'where id='{t}'"),True)
sql(owner(f"select claim_t3_owner_task('{t}','t3:bad')"),True)
sql(owner(f"select submit_t3_owner_task('{uid()}','{pb}','fictional','{'a'*40}','Fixture',now()+interval '20 minutes')"),True)
request=uid();deadline=sql("select (now()+interval '20 minutes')::text")
def same_request(n):return sql(owner(f"select submit_t3_owner_task('{request}','{pa}','fictional','{'a'*40}','Idempotent fixture','{deadline}')"))
with concurrent.futures.ThreadPoolExecutor(8)as ex:ids=list(ex.map(same_request,range(8)))
assert len(set(ids))==1
sql(owner(f"select submit_t3_owner_task('{request}','{pa}','fictional','{'a'*40}','Conflict','{deadline}')"),True)
print('PASS concurrent idempotent owner request and conflicting retry refusal')
print('PASS owner-only submit/project binding, owner read RLS and mutation/claim denial')
def claim(n):return sql(f"set role service_role;select claim_t3_owner_task('{t}','t3:w{n}')is not null")
with concurrent.futures.ThreadPoolExecutor(8)as ex:r=list(ex.map(claim,range(8)))
assert r.count('t')==1
record=json.loads(sql(f"select row_to_json(t)from t3_owner_tasks t where id='{t}'"));worker=record['worker']
def advance(version,next,patch={}):return sql(f"set role service_role;select advance_t3_owner_task('{t}',{version},'{worker}','{next}','{json.dumps(patch)}')")
advance(2,'ready',{'execution_id':'fixtureone'});advance(3,'launching');advance(4,'launched',{'thread_id':'thread-one','run_id':'run-one'})
sql(f"set role service_role;select advance_t3_owner_task('{t}',4,'{worker}','uncertain','{{}}')",True)
sql(f"set role service_role;select advance_t3_owner_task('{t}',5,'{worker}','review_required','{{}}')",True)
artifact={'taskId':t,'executionId':'fixtureone','threadId':'thread-one','runId':'run-one','messages':['Fixture result'],'trusted':False,'reviewRequired':True};wrong={**artifact,'taskId':uid()}
sql(f"set role service_role;select advance_t3_owner_task('{t}',5,'{worker}','review_required','{json.dumps({'artifact':wrong})}')",True)
advance(5,'review_required',{'artifact':artifact});advance(6,'cleanup_due');advance(7,'deleted')
assert sql(owner(f"select artifact->'messages'from t3_owner_tasks where id='{t}'"))=='["Fixture result"]'
assert sql(owner(f"select artifact_sha256=encode(sha256(convert_to(artifact::text,'UTF8')),'hex')from t3_owner_tasks where id='{t}'"))=='t'
print('PASS8-way claim winner, strict CAS lifecycle, stored owner result survives execution deletion')
t2=submit();sql(f"set role service_role;select claim_t3_owner_task('{t2}','t3:lost')");sql(f"update t3_owner_tasks set lease_until=now()-interval '1 second'where id='{t2}'")
assert sql(f"set role service_role;select take_t3_cleanup('{t2}','t3:watchdog')->>'phase'")=='cleanup_due'
sql(f"set role service_role;select advance_t3_owner_task('{t2}',2,'t3:lost','ready','{{\"execution_id\":\"wrong\"}}')",True)
sql(f"update t3_owner_tasks set cleanup_deadline=now()-interval '1 second'where id='{t2}'")
assert sql(f"set role service_role;select take_t3_cleanup('{t2}','t3:other')is null")=='t'
print('PASS crashed-worker takeover allows cleanup only; old worker cannot revive task')
t3=submit()
env={**os.environ,'T3_SCRATCH_URI':uri,'T3_SCRATCH_TASK':t3}
result=subprocess.run(['node',str(Path(__file__).resolve().parents[1]/'proof/managed-t3-fixture.mjs'),'/tmp/t3-provider-proof/node_modules/.bin','/downloads/t3-owner-roundtrip-proof.json'],env=env,capture_output=True,text=True,timeout=45)
assert result.returncode==0,result.stderr
assert sql(owner(f"select phase||':'||(artifact->>'reviewRequired')from t3_owner_tasks where id='{t3}'"))=='deleted:true'
print('PASS real managed T3/Pi + fictional model + persistent Postgres worker round trip, result retained after local execution cleanup')
print('PASS scratch-only owner task persistence proof')
