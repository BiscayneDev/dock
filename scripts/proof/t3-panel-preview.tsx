// Fictional visual fixture, never imported by the application.
import React from'react';import{createRoot}from'react-dom/client';import T3OwnerPanel from'../../components/tasks/T3OwnerPanel'
const sources=[{repoKey:'fictional-repo',projectId:'11111111-1111-4111-8111-111111111111',projectName:'Fictional project',baseSha:'a'.repeat(40)}]
let tasks=[{id:'22222222-2222-4222-8222-222222222222',brief:'Review selected committed files',phase:'deleted',result_outcome:'review_required',cleanup_deadline:new Date().toISOString(),artifact:{messages:['FICTIONAL RESULT: Reviewed the selected committed files. No patch was applied.']}}]
const requests:unknown[]=[];(window as unknown as {proofRequests:unknown[]}).proofRequests=requests
window.fetch=async(url,options)=>{if(options?.method==='POST'){requests.push(JSON.parse(String(options.body)));return new Response(JSON.stringify({id:'fixture',accepted:true,spendAuthorized:false}),{status:201})}return new Response(JSON.stringify(String(url).endsWith('/sources')?{sources}:{tasks}))}
createRoot(document.getElementById('root')!).render(<main className="mx-auto max-w-3xl p-4"><p className="mb-3 text-xs text-slate-400">LOCAL FICTIONAL PREVIEW - NO EXECUTION</p><T3OwnerPanel/></main>)
