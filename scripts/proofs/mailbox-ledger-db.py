# Local real Postgres mailbox claim race/permissions proof. No external system.
import pgserver,tempfile,subprocess,concurrent.futures,json
server=pgserver.get_server(tempfile.mkdtemp(prefix='dock-mailbox-db-'));uri=server.get_uri()
def sql(q,check=True):
 r=subprocess.run(['/usr/lib/postgresql/14/bin/psql',uri,'-qtAX','-v','ON_ERROR_STOP=1','-c',q],capture_output=True,text=True)
 if check and r.returncode:raise Exception(r.stderr)
 return r
try:
 sql('create role anon;create role authenticated;create role service_role;create table mobile_executions(id uuid primary key);')
 sql(open('db/migrations/0022_mobile_mailbox_claims_draft.sql').read())
 execution='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';request='bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
 sql("insert into mobile_executions values('"+execution+"')")
 q="insert into mobile_mailbox_claims(execution_id,request_id,instance_id,request_hash)values('"+execution+"','"+request+"','own','"+'a'*64+"')"
 with concurrent.futures.ThreadPoolExecutor(2)as pool:results=list(pool.map(lambda _:sql(q,False).returncode,[1,2]))
 assert sorted(results)==[0,1]
 assert sql("set role authenticated;select *from mobile_mailbox_claims",False).returncode!=0
 assert sql("set role anon;select *from mobile_mailbox_claims",False).returncode!=0
 assert sql("select count(*)from mobile_mailbox_claims").stdout.strip()=='1'
 print(json.dumps({'actualLocalPostgres':True,'twoConcurrentClaimsOneWinner':True,'durableLedgerRows':1,'anonAndAuthenticatedReadDenied':True,'migrationDeployed':False}))
finally:server.cleanup()
