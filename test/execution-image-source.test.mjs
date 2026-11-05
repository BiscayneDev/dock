import{test}from'node:test';import assert from'node:assert/strict';import{readFileSync,readdirSync}from'node:fs';
const root=new URL('../infra/execution-private/',import.meta.url)
test('unpublished image recipe consumes tested fixed repair before real nonroot startup smoke',()=>{
 const docker=readFileSync(new URL('Dockerfile',root),'utf8'),repair=readFileSync(new URL('repair.py',root),'utf8'),smoke=readFileSync(new URL('smoke.py',root),'utf8')
 assert.match(docker,/pi@sha256:[a-f0-9]{64}/);assert.match(docker,/COPY infra\/execution-private\/repair.py \/opt\/dock-runtime-repair.py/)
 assert.ok(docker.indexOf('RUN python3 /opt/dock-runtime-repair.py')<docker.indexOf('USER node'))
 assert.ok(docker.indexOf('RUN python3 /opt/dock-image-smoke.py')>docker.indexOf('USER node'))
 assert.match(repair,/is_relative_to\(root\)/);assert.match(repair,/'chmod','-R','a\+rX,a-w'/)
 assert.match(smoke,/assert os.getuid\(\)!=0/);assert.match(smoke,/server=subprocess.Popen/);assert.match(smoke,/loaded this policy/)
 assert.deepEqual(readdirSync(root).filter(x=>/\.env|\.pem|\.key|credential/i.test(x)),[])
})
