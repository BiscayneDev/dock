// Strict bounded OpenAI-compatible tool request. Input is data, never provider
// configuration. Unknown billing-affecting fields are refused, not forwarded.
import{createHash}from'node:crypto'
export function boundChatRequest(input){
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Chat object required')
 const allowed=new Set(['model','messages','tools','tool_choice','stream','stream_options','max_tokens','max_completion_tokens','temperature','top_p','parallel_tool_calls','store'])
 if(Object.keys(input).some(k=>!allowed.has(k))||input.store===true||typeof input.model!=='string'||!input.model||input.model.length>200||!Array.isArray(input.messages)||!input.messages.length||input.messages.length>100||[input.max_tokens,input.max_completion_tokens].some(x=>x!==undefined&&(!Number.isSafeInteger(x)||x<1||x>2048)))throw Error('Unsupported chat request fields or output bound')
 const messages=input.messages.map(m=>{if(Array.isArray(m?.content)){if(m.content.some(c=>c.type!=='text'||typeof c.text!=='string'||Object.keys(c).some(k=>!['type','text'].includes(k))))throw Error('Text content blocks only');return{...m,content:m.content.map(c=>c.text).join('\n')}}return m});
 for(const m of messages){if(!m||!['system','user','assistant','tool'].includes(m.role)||Object.keys(m).some(k=>!['role','content','tool_calls','tool_call_id','name'].includes(k))||m.content!==null&&typeof m.content!=='string'||m.tool_calls&&(!Array.isArray(m.tool_calls)||m.tool_calls.length>16))throw Error('Text/tool messages only');for(const call of m.tool_calls??[])if(call.type!=='function'||typeof call.id!=='string'||typeof call.function?.name!=='string'||typeof call.function?.arguments!=='string')throw Error('Bound function message required')}
 if(input.tools&&(!Array.isArray(input.tools)||input.tools.length>128))throw Error('Tool count bound exceeded')
 for(const t of input.tools??[])if(t.type!=='function'||!t.function||typeof t.function.name!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(t.function.name)||typeof t.function.parameters!=='object'||!t.function.parameters||Array.isArray(t.function.parameters))throw Error('Function schema required')
 const body={model:input.model,messages,...input.tools?{tools:input.tools}:{},...input.tool_choice?{tool_choice:input.tool_choice}:{},max_tokens:2048,stream:false,parallel_tool_calls:false}
 const prompt=JSON.stringify(body);if(Buffer.byteLength(prompt)>160000)throw Error('Structured chat exceeds request bound')
 const digest=createHash('sha256').update(prompt).digest('hex');const requestId=digest.slice(0,8)+'-'+digest.slice(8,12)+'-'+digest.slice(12,16)+'-'+digest.slice(16,20)+'-'+digest.slice(20,32)
 return{body,prompt,requestId,stream:input.stream===true}
}
export function boundChatResult(result,request){
 const message=result.choices?.[0]?.message;if(!message||message.role&&message.role!=='assistant'||message.content!==null&&typeof message.content!=='string'||!Array.isArray(result.choices)||result.choices.length!==1)throw Error('Bound single assistant result required')
 if(Buffer.byteLength(JSON.stringify(message))>200000)throw Error('Tool result byte bound exceeded');
 const tools=new Set((request.tools??[]).map(x=>x.function.name));if(message.tool_calls&&(!Array.isArray(message.tool_calls)||message.tool_calls.length>16))throw Error('Tool output count exceeded')
 for(const t of message.tool_calls??[])if(t.type!=='function'||typeof t.id!=='string'||!tools.has(t.function?.name)||typeof t.function?.arguments!=='string')throw Error('Unknown/malformed tool result')
 return{...result,choices:[{index:0,message:{role:'assistant',content:message.content??null,...message.tool_calls?{tool_calls:message.tool_calls}:{}},finish_reason:message.tool_calls?.length?'tool_calls':'stop'}]}
}
