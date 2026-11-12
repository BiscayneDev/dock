import pgserver,tempfile,subprocess,json,http.server,urllib.parse,hashlib,datetime,atexit,signal
signal.signal(signal.SIGTERM,lambda *args:__import__('sys').exit(0))
srv=pgserver.get_server(tempfile.mkdtemp(prefix='dock-mobile-http-pg-'));uri=srv.get_uri()
import atexit,signal;atexit.register(srv.cleanup);signal.signal(signal.SIGTERM,lambda *args:__import__('sys').exit(0))
def sql(q):
 r=subprocess.run(['/usr/lib/postgresql/14/bin/psql',uri,'-qtAX','-v','ON_ERROR_STOP=1','-c',q],capture_output=True,text=True)
 if r.returncode:raise Exception(r.stderr)
 return r.stdout.strip()
def lit(x):return 'null'if x is None else"'"+str(x).replace("'","''")+"'"
sql("create role anon;create role authenticated;create role service_role; create table users(id uuid primary key);create table workspaces(id uuid primary key,owner_id uuid);create table projects(id uuid primary key,workspace_id uuid);create table devices(id uuid primary key,owner_id uuid,workspace_id uuid,name text,token_salt text,token_hash text,revoked_at timestamptz,last_seen_at timestamptz,created_at timestamptz);create table conversations(id uuid primary key default gen_random_uuid(),workspace_id uuid,owner_id uuid,project_id uuid,title text,agent text,preview text,created_at timestamptz default now(),updated_at timestamptz);create table messages(id uuid primary key default gen_random_uuid(),conversation_id uuid,role text,content text,agent text,meta jsonb,created_at timestamptz default now());create table agents(runtime_agent text,display_name text,kind text,workspace_id uuid);create table memory_items(id uuid primary key default gen_random_uuid(),owner_id uuid,workspace_id uuid,project_id uuid,scope text,type text,content text,conversation_id uuid,embedding_model text,created_at timestamptz default now());")
if __import__('os').environ.get('PROOF_BEACON')=='true':sql("create schema auth;create function auth.uid()returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$")
sql(open('db/migrations/0012_mobile_foundations.sql').read())
sql(open('db/migrations/0013_mobile_execution_draft.sql').read());sql(open('db/migrations/0014_mobile_execution_protocol_draft.sql').read());sql(open('db/migrations/0015_mobile_model_holds_draft.sql').read());sql(open('db/migrations/0023_mobile_tasks_draft.sql').read());sql(open('db/migrations/0024_mobile_task_jobs_draft.sql').read())
o='44444444-4444-4444-8444-444444444444';w='33333333-3333-4333-8333-333333333333';d='66666666-6666-4666-8666-666666666666';salt='fictional-salt-only';secret='fictional-device-secret';h=hashlib.sha256((salt+':'+secret).encode()).hexdigest()
sql(f"insert into users values('{o}');insert into workspaces values('{w}','{o}');insert into devices values('{d}','{o}','{w}','Fictional T3','{salt}','{h}',null,now(),now(),'mobile');insert into agents values('chief','Chief','chief_of_staff','{w}'),('architect','Architect','agent','{w}');insert into mobile_grants(device_id,owner_id,workspace_id,agent_key,repo_keys,inference_enabled)values('{d}','{o}','{w}','chief',array['dock','shipyard-inference'],true);insert into memory_items(owner_id,workspace_id,scope,type,content)values('{o}','{w}','fact','preference','Canonical shared Shipyard memory verified fixture.')")
if __import__('os').environ.get('PROOF_BEACON')=='true':
 sql(open('db/migrations/0018_mobile_execution_capabilities_draft.sql').read());sql(open('db/migrations/0019_mobile_capability_protocol_draft.sql').read());sql(open('db/migrations/0020_beacon_memory_draft.sql').read());sql(open('db/migrations/0021_beacon_execution_tools_draft.sql').read())
 sql(f"insert into memory_agent_assignments(workspace_id,agent_key)values('{w}','chief')")
if __import__('os').environ.get('PROOF_BEACON_UI')=='true':
 note=sql(f"select beacon_mobile_note('{d}','{o}','{w}',null,'chief','Fictional private source note','fixture:ui-proof')")
 candidate=sql(f"select beacon_mobile_distill('{d}','{o}','{w}',null,'chief','{note}','Fictional business fact reviewed through the actual owner page')")
class Handler(http.server.BaseHTTPRequestHandler):
 def log_message(self,*a):pass
 def do_GET(self):self.handle_request()
 def do_POST(self):self.handle_request()
 def do_PATCH(self):self.handle_request()
 def handle_request(self):
  try:
   u=urllib.parse.urlparse(self.path);qs=urllib.parse.parse_qs(u.query);body=json.loads(self.rfile.read(int(self.headers.get('content-length','0')))or'{}')
   if u.path=='/auth/v1/user':result={'id':o,'email':'demo@example.com','aud':'authenticated'}
   elif u.path=='/fixture/execution-capability':
    e=sql("select id from mobile_executions limit 1")
    sql(f"update mobile_executions set state='bound',agent_key='architect',decision_expires_at=now()+interval '5 minutes'where id='{e}'")
    digest=hashlib.sha256('fictional-execution-capability-secret'.encode()).hexdigest()
    cap=sql(f"select mobile_capability_issue('{e}','{digest}',now()+interval '4 minutes')")
    result={'token':'dockexec.'+cap+'.fictional-execution-capability-secret'}
   elif u.path=='/fixture/complete-turn':
    # Fictional: completes a pending turn through the real SQL functions, as the service does after inference.
    sid,rid,fp=body['sessionId'],body['requestId'],body['fingerprint']
    assert len(sid)==36 and len(rid)==36 and fp.isalnum()
    sql(f"select mobile_claim({lit(sid)},'{d}','{o}','{w}',{lit(rid)},{lit(fp)})")
    sql(f"select mobile_complete({lit(sid)},'{d}','{o}','{w}',{lit(rid)},{lit(fp)},'fictional user','fictional reply text',jsonb_build_object('text','fictional reply text'))")
    result={'ok':True}
   elif u.path=='/fixture/second-device':
    o2='55555555-5555-4555-8555-555555555555';w2='77777777-7777-4777-8777-777777777777';d2='88888888-8888-4888-8888-888888888888';h2=hashlib.sha256((salt+':other-secret').encode()).hexdigest()
    sql(f"insert into users values('{o2}');insert into workspaces values('{w2}','{o2}');insert into devices values('{d2}','{o2}','{w2}','Other','{salt}','{h2}',null,now(),now(),'mobile');insert into agents values('chief','Chief','chief_of_staff','{w2}');insert into mobile_grants(device_id,owner_id,workspace_id,agent_key,repo_keys,inference_enabled)values('{d2}','{o2}','{w2}','chief',array['dock'],true)")
    result={'ok':True}
   elif u.path=='/fixture/seed-tasks':
    # FICTIONAL labels only. Drives the real ledger functions so the page shows real ledger rows.
    sess='99999999-9999-4999-8999-999999999999'
    def mk(i,brief,review,path,ev="'[]'",waiting=None,handoff=None,summary=None):
     t=f'aaaaaaaa-0000-4000-8000-00000000000{i}'
     sql(f"select mobile_task_open('{t}','{o}','{w}','{sess}','chief','{review}',{lit(brief)})")
     for k,st in enumerate(path):
      actor='owner' if st=='done' and review=='owner' else 'agent'
      sql(f"select mobile_task_transition('{t}','{o}','{st}','{actor}',{ev if k==len(path)-1 else chr(39)+'[]'+chr(39)}::jsonb,{lit(waiting) if st=='waiting_on_you' else 'null'})")
     if handoff:
      sql(f"select mobile_task_attempt('{t}','{o}','turn',true)")
      if handoff=='delivered':sql(f"select mobile_task_finish('{t}','{o}','turn','delivered','{'d'*64}',{lit(summary)})")
    mk(1,'FICTIONAL: Choose between two fictional landing page headlines','none',['delegated','running','waiting_on_you'],waiting='Pick headline A or B')
    mk(2,'FICTIONAL: Review the fictional pricing table change','owner',['delegated','running','ready_for_review'],ev="'[\"Fictional check: 12 of 12 passed\"]'",handoff='delivered',summary='Fictional result: the pricing table now shows three plans.')
    mk(3,'FICTIONAL: Fix a fictional typo in a fictional README','none',['delegated','blocked'],handoff='uncertain')
    mk(4,'FICTIONAL: Draft fictional release notes','none',['delegated','running'])
    mk(5,'FICTIONAL: Update a fictional changelog','none',['delegated','running','done'],ev="'[\"Fictional check: changelog builds\"]'",handoff='delivered',summary='Fictional result: the changelog has the new entry.')
    result={'ok':True}
   elif u.path=='/fixture/model-state':result={'holds':int(sql("select count(*)from mobile_model_holds")),'settled':int(sql("select count(*)from mobile_model_holds where state='settled'")),'architectNotes':int(sql("select count(*)from memory_items where visibility='agent'and author_agent='architect'and memory_state='active'"))}
   elif u.path=='/fixture/beacon-state':result={'candidates':int(sql("select count(*)from memory_items where visibility='agent'and memory_state='proposed'")),'privateNotes':int(sql("select count(*)from memory_items where visibility='agent'and memory_state='active'")),'shared':int(sql("select count(*)from memory_items where visibility='business'"))}
   elif u.path=='/fixture/execution-result':
    # Fictional controller: records the result bound to the execution's own instance and run.
    e=body['executionId'];assert len(e)==36
    row=json.loads(sql(f"select row_to_json(x) from(select instance_id,run_id from mobile_executions where id='{e}')x"))
    sql(f"select mobile_execution_result('{e}',{lit(row['instance_id'])},{lit(row['run_id'])},'fictional worker output',true)")
    result={'ok':True}
   elif u.path=='/fixture/prepare-execution':
    session=body['sessionId'];assert isinstance(session,str)and len(session)==36
    proposal=sql(f"insert into mobile_task_proposals(session_id,request_id,ordinal,owner_id,workspace_id,proposal,status,approved_digest)values({lit(session)},gen_random_uuid(),0,'{o}','{w}','{{}}','approved','fictional-proof')returning id")
    execution=sql(f"insert into mobile_executions(proposal_id,owner_id,workspace_id,agent_key,repo_key,source_commit,approved_proposal_digest,owner_decision_ref,managed_budget_micros,max_compute_cost_micros,lifecycle_approved,cleanup_deadline,state,instance_id,thread_id,run_id)values({lit(proposal)},'{o}','{w}','architect','dock','{'a'*40}','fictional-proof','local-only-not-owner-authority',1000000,100000,true,now()+interval '10 minutes','running','fictional-local',{lit(body['threadId'])},{lit(body['runId'])})returning id")
    result={'executionId':execution}
   elif u.path.startswith('/rest/v1/rpc/'):
    name=u.path.split('/')[-1];assert name in ['mobile_open','mobile_claim','mobile_complete','mobile_execution_result','beacon_mobile_recall','beacon_mobile_note','beacon_mobile_distill','beacon_promote','beacon_execution_recall','beacon_execution_memory','mobile_capability_reserve','mobile_model_settle','mobile_task_transition','mobile_task_open','mobile_task_attempt','mobile_task_finish','mobile_job_enqueue','mobile_job_lease','mobile_job_start','mobile_job_heartbeat','mobile_job_finish'];args=','.join(k+'=>'+lit(json.dumps(v)if isinstance(v,(dict,list))else v)for k,v in body.items());r=sql("select coalesce(json_agg(r),'[]'::json)from "+name+' ('+args+')r')if name in['beacon_mobile_recall','beacon_execution_recall']else sql('select '+name+'('+args+')');result=True if r=='t'else False if r=='f'else r if name in['beacon_mobile_note','beacon_mobile_distill','beacon_promote','mobile_capability_reserve','mobile_task_open']else json.loads(r)if r else None
   elif u.path.startswith('/rest/v1/'):
    table=u.path.split('/')[-1];assert table in ['mobile_task_jobs','mobile_tasks','mobile_task_versions','mobile_task_handoffs','workspaces','devices','agents','mobile_grants','mobile_sessions','mobile_turns','mobile_notices','mobile_task_proposals','mobile_executions','mobile_execution_events','mobile_execution_capabilities','mobile_model_holds','memory_items','messages','conversations']
    clauses=[]
    for k,vs in qs.items():
     if k in['select','order','limit','offset']:continue
     assert k.replace('_','').isalnum();v=vs[0]
     if v.startswith('eq.'):clauses.append(k+'='+lit(v[3:]))
     elif v=='is.null':clauses.append(k+' is null')
    where=' where '+' and '.join(clauses)if clauses else''
    if self.command=='GET':
     query='select * from '+table+where
     if qs.get('order'):col,direction,*_=qs['order'][0].split('.');assert col.replace('_','').isalnum();query+=' order by '+col+(' desc'if direction=='desc'else' asc')
     if qs.get('limit'):query+=' limit '+str(int(qs['limit'][0]))
    elif self.command=='POST':
     if isinstance(body,list):body=body[0]
     body={k:v for k,v in body.items()if k!='embedding'};keys=list(body);assert all(k.replace('_','').isalnum()for k in keys);query='insert into '+table+'('+','.join(keys)+')values('+','.join(lit(v)for v in body.values())+')returning *'
    elif self.command=='PATCH':query='update '+table+' set '+','.join(k+'='+lit(v)for k,v in body.items())+where+' returning *'
    result=json.loads(sql('select coalesce(json_agg(r),\'[]\'::json)from('+query+')r')if self.command=='GET'else sql('with r as('+query+")select coalesce(json_agg(r),'[]'::json)from r"))
    if 'vnd.pgrst.object+json'in self.headers.get('accept',''):result=result[0]if result else None
   else:raise Exception('Unknown route')
   out=json.dumps(result).encode();self.send_response(200);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(out)));self.end_headers();self.wfile.write(out)
  except Exception as e:
   print(type(e).__name__,str(e)[:400],flush=True);out=json.dumps({'message':str(e)}).encode();self.send_response(400);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(out)));self.end_headers();self.wfile.write(out)
print('POSTGRES_HTTP_READY',flush=True);http.server.ThreadingHTTPServer(('127.0.0.1',4597),Handler).serve_forever()
