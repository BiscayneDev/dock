import pgserver,tempfile,subprocess,os,sys
server=pgserver.get_server(tempfile.mkdtemp(prefix='dock-ledger-int-'));uri=server.get_uri()
try:
 r=subprocess.run(['/usr/lib/postgresql/14/bin/psql',uri,'-qtAX','-v','ON_ERROR_STOP=1','-c','create role anon;create role authenticated;create role service_role;'],capture_output=True,text=True);assert not r.returncode,r.stderr
 r=subprocess.run(['/usr/lib/postgresql/14/bin/psql',uri,'-qtAX','-v','ON_ERROR_STOP=1','-f','db/migrations/0023_mobile_tasks_draft.sql','-f','db/migrations/0024_mobile_task_jobs_draft.sql'],capture_output=True,text=True);assert not r.returncode,r.stderr
 r=subprocess.run(['node',sys.argv[1] if len(sys.argv)>1 else 'scripts/proofs/task-ledger-integration.mjs'],env={**os.environ,'PGURI':uri},capture_output=True,text=True);print(r.stdout,r.stderr[-1500:]);sys.exit(r.returncode)
finally:server.cleanup()
