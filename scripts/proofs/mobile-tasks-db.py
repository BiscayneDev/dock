# Local real Postgres proof of the DRAFT task ledger. No external system; migration not deployed.
import pgserver,tempfile,subprocess,json
server=pgserver.get_server(tempfile.mkdtemp(prefix='dock-tasks-db-'));uri=server.get_uri()
def sql(q,check=True):
 r=subprocess.run(['/usr/lib/postgresql/14/bin/psql',uri,'-qtAX','-v','ON_ERROR_STOP=1','-c',q],capture_output=True,text=True)
 if check and r.returncode:raise Exception(r.stderr)
 return r
def tr(task,owner,nxt,actor,ev="'[]'",w='null'):return sql(f"select mobile_task_transition('{task}','{owner}','{nxt}','{actor}',{ev}::jsonb,{w})").stdout.strip()
try:
 sql('create role anon;create role authenticated;create role service_role;')
 sql(open('db/migrations/0023_mobile_tasks_draft.sql').read())
 o='11111111-1111-1111-1111-111111111111';x='22222222-2222-2222-2222-222222222222';s='33333333-3333-3333-3333-333333333333'
 a='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';b='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
 sql(f"insert into mobile_tasks(id,owner_id,workspace_id,session_id,agent_key,review_policy)values('{a}','{o}','{o}','{s}','dock','none'),('{b}','{o}','{o}','{s}','dock','owner')")
 for t in(a,b):assert tr(t,o,'delegated','system')=='t' and tr(t,o,'running','agent')=='t'
 assert tr(a,x,'done','agent',"'[\"e\"]'")=='f'            # wrong owner
 assert tr(a,o,'done','agent')=='f'                         # no proof
 assert tr(a,o,'done','agent',"'[\"fictional check\"]'")=='t' # routine closes on proof, no owner needed
 assert tr(b,o,'done','agent',"'[\"e\"]'")=='f'             # owner-review task waits
 assert tr(b,o,'done','owner',"'[\"e\"]'")=='t'
 assert tr(a,o,'running','agent')=='f'                       # done is terminal
 assert sql("set role authenticated;select * from mobile_tasks",False).returncode!=0
 assert sql("set role authenticated;select mobile_task_transition('"+a+"','"+o+"','failed','owner','[]',null)",False).returncode!=0
 print(json.dumps({'actualLocalPostgres':True,'wrongOwnerRefused':True,'proofRequired':True,'reviewPolicyEnforced':True,'clientRoleDenied':True,'migrationDeployed':False}))
finally:server.cleanup()
