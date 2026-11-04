import pgserver, subprocess, concurrent.futures, uuid, tempfile
from pathlib import Path
srv=pgserver.get_server(tempfile.mkdtemp(prefix='coding-db-'))
uri=srv.get_uri()
def sql(q):
 r=subprocess.run(['psql',uri,'-qAt','-v','ON_ERROR_STOP=1','-c',q],capture_output=True,text=True)
 if r.returncode: raise RuntimeError(r.stderr)
 return r.stdout.strip()
sql("create role service_role; create table task_runs(id uuid primary key, lease_owner text, status text, lease_until timestamptz, target text, payload jsonb, spent_cents int, budget_cents int);")
sql((Path(__file__).resolve().parents[2] / 'supabase/migrations/20261104_coding_call_reservations.sql').read_text())
run,dev=str(uuid.uuid4()),str(uuid.uuid4())
sql(f"insert into task_runs values ('{run}','device:{dev}','leased',now()+interval '5 minute','home','{{\"isolatedTask\":{{}}}}',0,30)")
def call(i): return sql(f"select reserve_coding_call('{run}','{uuid.uuid4()}','{dev}',10)->>'ok'")
with concurrent.futures.ThreadPoolExecutor(8) as ex: outcomes=list(ex.map(call,range(8)))
assert outcomes.count('true')==3,outcomes
assert sql(f"select spent_cents from task_runs where id='{run}'")=='30'
print('PASS 8 concurrent requests, exactly 3 reservations, budget capped at 30 cents')
request=str(uuid.uuid4())
sql(f"update task_runs set spent_cents=0 where id='{run}'")
q=f"select reserve_coding_call('{run}','{request}','{dev}',10)->>'error'"
sql(q)
assert sql(q)=='duplicate'
assert sql(f"select spent_cents from task_runs where id='{run}'")=='10'
print('PASS duplicate request cannot reserve or authorize a second call')
assert sql(f"select reserve_coding_call('{run}','{uuid.uuid4()}','{uuid.uuid4()}',10)->>'error'")=='lease'
sql(f"update task_runs set lease_until=now()-interval '1 second' where id='{run}'")
assert sql(f"select reserve_coding_call('{run}','{uuid.uuid4()}','{dev}',10)->>'error'")=='lease'
print('PASS wrong-device and expired leases rejected')
