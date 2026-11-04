// Pre-launch check runs inside the bound private execution. Requires installed
// policy AND running-server acknowledgement. A settings default is insufficient.
import {createHash} from 'node:crypto'
export async function verifySupervisedPolicy(transport,{executionId,baseDir}){
 const r=await transport({executionId,args:['policy','show','--base-dir',baseDir],stdin:''})
 if(r.code!==0||typeof r.stdout!=='string')throw new Error('supervised policy unavailable')
 const text=r.stdout
 const fingerprint=/\(.*fingerprint ([a-f0-9]{12})\)/.exec(text)?.[1]
 if(!fingerprint||!text.includes('loaded this policy.')||!text.match(/"maxRuntimeMode"\s*:\s*"approval-required"/)||text.includes('Restart T3 Code')||text.includes('without a policy'))throw new Error('running supervised policy not verified')
 return {executionId,baseDir,maxRuntimeMode:'approval-required',loaded:true,fingerprint,evidenceSha256:createHash('sha256').update(text).digest('hex')}
}
