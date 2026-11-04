"""Scratch PostgreSQL ONLY. Does not read .env, connect Supabase or create compute."""
import pgserver, subprocess, concurrent.futures, uuid, tempfile
from pathlib import Path
root=tempfile.mkdtemp(prefix='t3-prep-db-')
srv=pgserver.get_server(root)
uri=srv.get_uri()
def sql(q,fail=False):
 r=subprocess.run(['psql',uri,'-qAt','-v','ON_ERROR_STOP=1','-c',q],capture_output=True,text=True)
 if fail:
  assert r.returncode!=0,'unexpected authorized write: '+q
  return r.stderr
 if r.returncode:raise RuntimeError(r.stderr)
 return r.stdout.strip()
def uid():return str(uuid.uuid4())
a,b,wa,wb,pa,pb=[uid() for _ in range(6)]
sql("""create role anon;create role authenticated;create role service_role bypassrls;
create schema auth; create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
grant usage on schema public,auth to anon,authenticated,service_role;grant execute on function auth.uid() to anon,authenticated,service_role;
create table users(id uuid primary key);create table workspaces(id uuid primary key,owner_id uuid not null references users);
create table projects(id uuid primary key,workspace_id uuid not null references workspaces);
create table task_runs(id uuid primary key,owner_id uuid not null references users,workspace_id uuid not null references workspaces,project_id uuid references projects,status text not null,target text not null,payload jsonb not null,lease_owner text,lease_until timestamptz);
grant select on workspaces,projects to authenticated;
""")
sql(f"insert into users values('{a}'),('{b}');insert into workspaces values('{wa}','{a}'),('{wb}','{b}');insert into projects values('{pa}','{wa}'),('{pb}','{wb}');")
migration=Path(__file__).resolve().parents[2]/'supabase/migrations/20261104_t3_execution_preparations.sql'
sql(migration.read_text())
def owner(q,who=a):return f"set role authenticated;set request.jwt.claim.sub='{who}';{q}"
sha='a'*40
deadline=sql("select (now()+interval '20 minutes')::text")
def run(ownerid=a,ws=wa,proj=pa):
 r=uid();sql(f"insert into task_runs values('{r}','{ownerid}','{ws}','{proj}','queued','home','{{\"isolatedTask\":{{\"taskRef\":\"task-fixture\",\"repoKey\":\"fixture\",\"baseRef\":\"main\",\"brief\":\"Fictional task\"}}}}',null,null)");return r
def prepare(r,who=a):return sql(owner(f"select prepare_t3_execution('{r}','{sha}','{deadline}')->>'id'",who))
def claim(i,execution='instancefixture',worker='t3:fixture'):
 return sql(f"set role service_role;select claim_t3_preparation('{i}',1,'{execution}','{worker}',120)->>'ok'")
r=run()
with concurrent.futures.ThreadPoolExecutor(8) as ex:ids=list(ex.map(lambda _:prepare(r),range(8)))
assert len(set(ids))==1
binding=ids[0]
assert sql(f"select count(*) from t3_execution_preparations where run_id='{r}'")=='1'
print('PASS 8 concurrent owner preparations produce exactly one durable binding')
assert sql(owner('select count(*) from t3_execution_preparations'))=='1'
assert sql(owner('select count(*) from t3_execution_preparations',b))=='0'
sql(owner(f"update t3_execution_preparations set phase='deleted' where id='{binding}'"),fail=True)
sql(owner(f"select claim_t3_preparation('{binding}',1,'instancestolen','t3:fixture',120)"),fail=True)
sql(f"set role anon;select prepare_t3_execution('{r}','{sha}','{deadline}')",fail=True)
sql(f"set role service_role;select prepare_t3_execution('{r}','{sha}','{deadline}')",fail=True)
print('PASS owner-read RLS, sibling invisibility, owner mutation denied, backend-only claim, anon denied')
r_other=run(b,wb,pb)
sql(owner(f"select prepare_t3_execution('{r_other}','{sha}','{deadline}')"),fail=True)
r_cross=run(a,wa,pb)
sql(owner(f"select prepare_t3_execution('{r_cross}','{sha}','{deadline}')"),fail=True)
sql(owner(f"select prepare_t3_execution('{r}','{'b'*40}','{deadline}')"),fail=True)
print('PASS other owner, cross-workspace project and changed preparation rejected')
with concurrent.futures.ThreadPoolExecutor(8) as ex:claims=list(ex.map(lambda n:claim(binding,'private'+str(n),'t3:worker'+str(n)),range(8)))
assert claims.count('true')==1,claims
assert sql(f"select phase||':'||version from t3_execution_preparations where id='{binding}'")=='claimed:2'
assert sql(f"select status from task_runs where id='{r}'")=='leased'
print('PASS 8 concurrent backend claims yield exactly one winner and matching task lease')
# Two preparations cannot bind the same private instance. Failed uniqueness must roll back task+binding writes.
r2=run();id2=prepare(r2)
used=sql(f"select private_execution_id from t3_execution_preparations where id='{binding}'")
sql(f"set role service_role;select claim_t3_preparation('{id2}',1,'{used}','t3:worker',120)",fail=True)
assert sql(f"select phase||':'||version from t3_execution_preparations where id='{id2}'")=='prepared:1'
assert sql(f"select status from task_runs where id='{r2}'")=='queued'
print('PASS private-instance reuse refused and transaction rollback leaves second run unleased')
# Existing device lease beats a later bridge claim; no lease stealing.
sql(f"update task_runs set status='leased',lease_owner='device:other',lease_until=now()+interval '1 minute' where id='{r2}'")
assert claim(id2,'instanceother')=='false'
print('PASS existing home-device lease cannot be stolen by T3 claim')
r3=run();id3=prepare(r3);sql(f"update t3_execution_preparations set cleanup_deadline=now()-interval '1 second' where id='{id3}'")
assert claim(id3,'instanceexpired')=='false'
r4=run();id4=prepare(r4);sql(f"update task_runs set payload='{{\"isolatedTask\":{{\"taskRef\":\"changed\"}}}}' where id='{r4}'")
assert claim(id4,'instancechanged')=='false'
rnull=run();idnull=prepare(rnull);sql(f"update task_runs set project_id=null where id='{rnull}'");assert claim(idnull,'instancenull')=='false'
print('PASS expired cleanup deadline, changed payload and null project refuse claim')
sql(f"delete from task_runs where id='{r}'",fail=True)
print('PASS run deletion cannot erase live execution ownership record')
# Race an owner replay with backend claim. Neither lock order deadlocks.
r5=run();id5=prepare(r5)
def replay():
 try:return prepare(r5)
 except RuntimeError:return 'refused_after_claim'
with concurrent.futures.ThreadPoolExecutor(2) as ex:
 jobs=[ex.submit(replay),ex.submit(claim,id5,'instancerace')];[j.result(timeout=10) for j in jobs]
assert sql(f"select count(*) from t3_execution_preparations where run_id='{r5}'")=='1'
print('PASS prepare/claim race preserves one binding without deadlock')
# pgserver owns cleanup on process exit; no external database credentials used.
print('PASS scratch-only migration and race/RLS proof complete')
