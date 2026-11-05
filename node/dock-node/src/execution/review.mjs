// Owner review packet from trusted backend catalogs, never from model totals or
// source instructions. A packet is a draft, not an approved execution decision.
import{createHash}from'node:crypto'
export function executionReview({proposal,source,compute,model,cleanup,now=Date.now()}){
 if(!proposal?.id||!proposal.ownerId||!proposal.workspaceId||!proposal.agentId||typeof proposal.text!=='string'||!proposal.text.trim())throw Error('Bound proposal required')
 if(!/^[a-f0-9]{40}$/.test(source?.commit??'')||!source.repoKey||!Array.isArray(source.paths)||!source.paths.length||source.paths.some(p=>typeof p!=='string'||p.includes('..')||p.startsWith('/')||p.startsWith('.git')))throw Error('Exact source grant required')
 if(!compute?.rateEvidence||!Number.isSafeInteger(compute.rateMicrosPerHour)||compute.rateMicrosPerHour<0||!Number.isSafeInteger(compute.maxApprovedMicros)||compute.maxApprovedMicros<=0||!compute.storageUntilDeleted||!compute.billingGranularity)throw Error('Verified compute terms required')
 if(!model?.gatewayEvidence||!Number.isSafeInteger(model.budgetMicros)||model.budgetMicros<0||model.maxOutputTokens!==2048||![1,3].includes(model.maxAttempts)||!model.quoteAndSettlementEnforced)throw Error('Actual model gateway enforcement required')
 if(!cleanup?.watchdogEvidence||!cleanup.retainedInstanceExclusion||!Number.isFinite(Date.parse(cleanup.deadline))||Date.parse(cleanup.deadline)<=now||Date.parse(cleanup.deadline)>now+24*60*60*1000)throw Error('Verified independent cleanup required')
 const packet={proposalId:proposal.id,ownerId:proposal.ownerId,workspaceId:proposal.workspaceId,projectId:proposal.projectId??null,agentId:proposal.agentId,text:proposal.text,source,compute,model,cleanup,limitations:['Compute is charged until verified deletion. A deadline is not a vendor hard dollar cap.','Unknown provider charges retain their reservation and require reconciliation.','Approval covers only this exact proposal, source, audience, model budget and lifecycle.'],expiresAt:new Date(Math.min(now+10*60*1000,Date.parse(cleanup.deadline))).toISOString()}
 return{...packet,digest:createHash('sha256').update(JSON.stringify(packet)).digest('hex'),status:'needs-owner-review'}
}
