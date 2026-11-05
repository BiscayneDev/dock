// Public registered sources only. Backend fetches selected immutable blobs,
// never a git credential/archive/history, user URL, uncommitted files or symlink.
export function publicSnapshotReader(repositories,{fetchImpl=fetch}={}){return async task=>{
 const repo=repositories[task.repo_key]
 if(!repo||! /^[A-Za-z0-9_-]+\/[A-Za-z0-9_.-]+$/.test(repo.github??'')||! /^[a-f0-9]{40}$/.test(task.base_sha)||!Array.isArray(repo.files)||!repo.files.length||repo.files.length>3)throw new Error('Registered public source required')
 const files=[];let bytes=0
 async function json(path){const r=await fetchImpl(`https://api.github.com/repos/${repo.github}/${path}`,{headers:{Accept:'application/vnd.github+json'},redirect:'error',signal:AbortSignal.timeout(5000)});if(!r.ok||Number(r.headers.get('content-length'))>3000000)throw new Error('Source unavailable');const text=await r.text();if(text.length>3000000)throw new Error('Source too large');return JSON.parse(text)}
 const info=await json('');if(info.private!==false||info.full_name?.toLowerCase()!==repo.github.toLowerCase())throw new Error('Public source identity required')
 const tree=await json(`git/trees/${task.base_sha}?recursive=1`)
 if(tree.truncated||!Array.isArray(tree.tree))throw new Error('Complete source tree required')
 for(const path of repo.files){
  if(typeof path!=='string'||! /^[a-zA-Z0-9_/-]+\.(ts|tsx|js|mjs|json|md|py|go|rs|sql)$/.test(path)||path.split('/').some(p=>!p||p==='..'||p==='.'||p.startsWith('.'))||/(secret|credential|token|private|node_modules)/i.test(path))throw new Error('Unsafe source allowlist')
  const entry=tree.tree.find(x=>x.path===path)
  if(!entry||entry.type!=='blob'||!['100644','100755'].includes(entry.mode)||! /^[a-f0-9]{40}$/.test(entry.sha)||entry.size>524288)throw new Error('Regular committed source required')
  const blob=await json(`git/blobs/${entry.sha}`)
  if(blob.encoding!=='base64'||typeof blob.content!=='string')throw new Error('Invalid source blob')
  const data=Buffer.from(blob.content,'base64');bytes+=data.length;if(bytes>524288||data.length!==entry.size)throw new Error('Source bound exceeded')
  const {createHash}=await import('node:crypto');if(createHash('sha1').update(Buffer.from(`blob ${data.length}\0`)).update(data).digest('hex')!==entry.sha)throw new Error('Source blob hash mismatch')
  files.push({path,base64:data.toString('base64')})
 }
 return{repoKey:task.repo_key,baseSha:task.base_sha,files}
}}
