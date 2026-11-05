// Fixed scoped memory tool surface. No caller-selected owner, project, agent or
// execution identity. Credential stays in runtime env, never tool descriptions.
export function executionMemoryMcp({memory}){
 const definitions=[{name:'memory_search',description:'Recall your permitted personal, approved business and own private notes.',inputSchema:{type:'object',properties:{query:{type:'string',maxLength:1000}},required:['query'],additionalProperties:false}},{name:'memory_note',description:'Save your own private working note. Does not share it with other agents.',inputSchema:{type:'object',properties:{content:{type:'string',maxLength:2000}},required:['content'],additionalProperties:false}},{name:'memory_distill',description:'Propose an exact business fact distilled from your own note. Owner/admin review is required before sharing.',inputSchema:{type:'object',properties:{noteId:{type:'string'},content:{type:'string',maxLength:2000}},required:['noteId','content'],additionalProperties:false}}]
 return async function handle({method,params={}}){
  if(method==='initialize')return{protocolVersion:'2024-11-05',capabilities:{tools:{listChanged:false}},serverInfo:{name:'dock-execution-memory',version:'0.1.0'}}
  if(method==='notifications/initialized')return
  if(method==='tools/list')return{tools:definitions}
  if(method!=='tools/call')throw Error('Unsupported memory method')
  const a=params.arguments??{},allowed=params.name==='memory_search'?['query']:params.name==='memory_note'?['content']:params.name==='memory_distill'?['noteId','content']:[]
  if(!allowed.length||Object.keys(a).some(k=>!allowed.includes(k))||allowed.some(k=>typeof a[k]!=='string'||!a[k].trim())||JSON.stringify(a).length>6000)throw Error('Bound memory tool arguments required')
  const result=params.name==='memory_search'?await memory.recall(a.query):params.name==='memory_note'?await memory.note(a.content):await memory.distill(a.noteId,a.content)
  return{content:[{type:'text',text:JSON.stringify(result)}],isError:false}
 }
}
