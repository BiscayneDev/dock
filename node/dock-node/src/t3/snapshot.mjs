// Export a registered committed source allowlist, never arbitrary archives or .git.
import {execFile}from'node:child_process'
import {promisify}from'node:util'
const exec=promisify(execFile)
export function snapshotReader(repositories){return async task=>{
 const repo=repositories[task.repo_key]
 if(!repo||typeof repo.path!=='string'||!Array.isArray(repo.files)||!repo.files.length)throw new Error('Registered source allowlist required')
 if(!/^[a-f0-9]{40}$/.test(task.base_sha))throw new Error('Resolved base required')
 const files=[];let bytes=0
 for(const file of repo.files){
  if(typeof file!=='string'||! /^[a-zA-Z0-9_/-]+\.(ts|tsx|js|mjs|json|md|py|go|rs|sql)$/.test(file)||file.split('/').some(p=>!p||p==='..'||p==='.'||p.startsWith('.'))||/(secret|credential|token|private|node_modules)/i.test(file))throw new Error('Unsafe source allowlist')
  const {stdout:entry}=await exec('git',['-C',repo.path,'ls-tree',task.base_sha,'--',file],{encoding:'utf8'})
  if(!entry.startsWith('100644 blob ')&&!entry.startsWith('100755 blob '))throw new Error('Only regular committed files allowed')
  const{stdout}=await exec('git',['-C',repo.path,'show',`${task.base_sha}:${file}`],{encoding:'buffer',maxBuffer:1024*1024})
  bytes+=stdout.length;if(bytes>2*1024*1024)throw new Error('Source snapshot too large')
  files.push({path:file,base64:stdout.toString('base64')})
 }
 return{repoKey:task.repo_key,baseSha:task.base_sha,files}
}}
