"""Throwaway Postgres proof. No connection to production."""
import concurrent.futures, subprocess, tempfile, uuid
from pathlib import Path
import pgserver
srv=pgserver.get_server(tempfile.mkdtemp(prefix='mobile-db-'))
uri=srv.get_uri()
def sql(q):
 r=subprocess.run(['psql',uri,'-qAt','-v','ON_ERROR_STOP=1','-c',q],capture_output=True,text=True)
 if r.returncode: raise RuntimeError(r.stderr)
 return r.stdout.strip()
sql('create role service_role; create role anon; create table workspaces(id uuid primary key);')
migration=Path(__file__).resolve().parents[2]/'supabase/migrations/20261104_mobile_pairings.sql'
sql(migration.read_text())
ws=str(uuid.uuid4()); sql(f"insert into workspaces values ('{ws}'); insert into mobile_pairings(workspace_id,code_hash,expires_at) values ('{ws}','correct',now()+interval '5 min')")
with concurrent.futures.ThreadPoolExecutor(16) as pool:
 outcomes=list(pool.map(lambda i:sql(f"select exchange_mobile_pairing('{ws}','correct',10,300000)"),range(8)))
assert outcomes.count('ok')==1,outcomes
print('PASS concurrent same-code consumption: exactly one winner')
sql('truncate mobile_pairing_failures')
with concurrent.futures.ThreadPoolExecutor(16) as pool:
 outcomes=list(pool.map(lambda i:sql(f"select exchange_mobile_pairing('{ws}','wrong-{i}',10,300000)"),range(24)))
assert outcomes.count('invalid')==10,outcomes
assert outcomes.count('rate_limited')==14,outcomes
print('PASS 24 concurrent distinct guesses: exactly 10 failures recorded, 14 blocked')
assert sql("select has_function_privilege('anon','exchange_mobile_pairing(uuid,text,integer,bigint)','execute')")=='f'
assert sql("select has_function_privilege('service_role','exchange_mobile_pairing(uuid,text,integer,bigint)','execute')")=='t'
print('PASS anonymous RPC denied; service-role RPC allowed')
# Additive rollback only touches these previously-new objects; no workspace data.
sql('drop function exchange_mobile_pairing(uuid,text,integer,bigint); drop table mobile_devices,mobile_pairing_failures,mobile_pairings;')
assert sql(f"select count(*) from workspaces where id='{ws}'")=='1'
print('PASS rollback removes mobile objects only, preserves workspace row')
