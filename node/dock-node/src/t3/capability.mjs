// Capability narrows read-only context delivery. It is not user spend/launch authority.
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto'
const hash=x=>createHash('sha256').update(x).digest()
export function issueContextCapability(scope,{ttlMs=300000,now=Date.now()}={}){
 for(const key of ['ownerId','workspaceId','projectId','taskRef','executionId'])if(typeof scope[key]!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(scope[key]))throw new Error('invalid capability scope')
 if(!Number.isFinite(ttlMs)||ttlMs<=0||ttlMs>900000)throw new Error('invalid capability lifetime')
 const token=randomBytes(32).toString('base64url')
 return {token,record:{scope:structuredClone(scope),digest:hash(token).toString('hex'),expiresAt:now+ttlMs,revoked:false,actions:['context:read']}}
}
export function permitContext(record,token,scope,action,now=Date.now()){
 if(record.revoked||record.expiresAt<=now||action!=='context:read'||!record.actions.includes(action)||typeof token!=='string'||token.length>128)return false
 if(!['ownerId','workspaceId','projectId','taskRef','executionId'].every(k=>typeof scope[k]==='string'&&scope[k]===record.scope[k]))return false
 const expected=Buffer.from(record.digest,'hex');return expected.length===32&&timingSafeEqual(expected,hash(token))
}
