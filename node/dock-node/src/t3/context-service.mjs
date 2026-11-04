import {permitContext} from './capability.mjs'
import {buildTaskContext} from './context.mjs'
// Caller supplies host-configured repositories/source allowlist, not HTTP payload.
export async function readScopedContext({registry,capability,token,scope,sourceConfig,query,now=Date.now()}){
 if(!permitContext(capability,token,scope,'context:read',now))throw new Error('context capability refused')
 const task=await registry.get(scope)
 if(['deleted','cleanup_due','uncertain'].includes(task.state)||task.deadlineMs<=now)throw new Error('task context no longer available')
 return buildTaskContext({...sourceConfig,query})
}
