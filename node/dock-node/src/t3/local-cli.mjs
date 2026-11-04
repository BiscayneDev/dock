// Use ONLY inside an already isolated execution namespace. Not a host sandbox.
// Explicit env prevents inheriting workspace/provider/control-plane credentials.
import {spawn} from 'node:child_process'
export function localCliTransport({binary,home,path=process.env.PATH,enabled=false,executionId}){
 return async({args,stdin,executionId:requestedExecution})=>{
  if(typeof executionId!=='string'||requestedExecution!==executionId)throw new Error('private execution transport mismatch')
  if(!enabled)throw new Error('local T3 transport disabled')
  return new Promise((resolve,reject)=>{
   let stdout='',size=0,overflow=false
   const p=spawn(binary,args,{shell:false,env:{PATH:path,HOME:home,T3CODE_TELEMETRY_ENABLED:'false'},stdio:['pipe','pipe','pipe']})
   const timer=setTimeout(()=>{p.kill('SIGTERM');reject(new Error('CLI outcome uncertain'))},30000)
   p.on('error',()=>{clearTimeout(timer);reject(new Error('CLI spawn failed'))})
   p.stdout.on('data',b=>{size+=b.length;if(size>1024*1024){overflow=true;p.kill('SIGTERM')}else stdout+=b})
   p.stderr.resume() // Do not expose raw stderr: it may contain private data.
   p.on('exit',code=>{clearTimeout(timer);if(overflow)reject(new Error('CLI output exceeded bound'));else resolve({code,stdout})})
   p.stdin.on('error',()=>{});p.stdin.end(stdin)
  })
 }
}
