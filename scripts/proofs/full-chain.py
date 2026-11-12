# Applies the repository's COMPLETE migration chain (0001..latest, in order, with real pgvector) to a throwaway local Postgres, then runs a node proof.
import pgserver,tempfile,subprocess,os,sys,glob
server=pgserver.get_server(tempfile.mkdtemp(prefix='dock-chain-'));uri=server.get_uri();P='/usr/lib/postgresql/14/bin/psql'
def psql(*a):
 r=subprocess.run([P,uri,'-qtAX','-v','ON_ERROR_STOP=1',*a],capture_output=True,text=True);assert not r.returncode,(a,r.stderr);return r
try:
 psql('-f','scripts/proofs/supabase-stubs.sql')
 for f in sorted(glob.glob('db/migrations/*.sql')):
  t=tempfile.NamedTemporaryFile('w',suffix='.sql',delete=False);t.write(open(f).read().replace('create extension if not exists pgcrypto;','-- pgcrypto skipped locally'));t.close();psql('-f',t.name);print('applied',os.path.basename(f))
 out=tempfile.NamedTemporaryFile('w+',suffix='.proof-out',delete=False)
 r=subprocess.run(['node',sys.argv[1]],env={**os.environ,'PGURI':uri},stdout=out,stderr=subprocess.STDOUT,text=True);out.flush();print(open(out.name).read()[-6000:]);sys.exit(r.returncode)
finally:server.cleanup()
