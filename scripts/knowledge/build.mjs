#!/usr/bin/env node
// Local-only Graphify adapter. Only explicitly listed repositories, committed
// source/docs and deterministic parsing. No model, uploads, account keys or
// agent-private worktrees. Output stays outside the public repository.
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile, copyFile, lstat, mkdtemp, rm, rename } from 'node:fs/promises'
import { resolve, join, dirname, extname } from 'node:path'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
const [configFile, outputDir] = process.argv.slice(2)
if (!configFile || !outputDir) throw new Error('usage: node build.mjs <explicit-repos.json> <private-output-directory>')
const config = JSON.parse(await readFile(configFile, 'utf8'))
if (!Array.isArray(config.repos) || !config.repos.length) throw new Error('repos required')
const stage = await mkdtemp(join(tmpdir(), 'dock-knowledge-build-'))
const manifest = { schema: 1, createdAt: new Date().toISOString(), repos: [], files: [], mode: 'local-code-and-markdown-structure', semanticExtraction: false }
const docNodes = [], docEdges = []
const SHA = (s) => createHash('sha256').update(s).digest('hex')
try {
 for (const entry of config.repos) {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(entry.key) || typeof entry.path !== 'string') throw new Error('invalid repository')
  const repo = resolve(entry.path)
  const commit = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], {encoding:'utf8'}).trim()
  const files = execFileSync('git', ['-C', repo, 'ls-tree', '-rz', '--name-only', 'HEAD'], {encoding:'utf8'}).split('\0').filter(Boolean)
  manifest.repos.push({ key: entry.key, commit })
  for (const file of files) {
   if (file.split('/').some((part) => ['node_modules','data','.git','.dock','.env','vendor'].includes(part))) continue
   if (!['.ts','.tsx','.js','.mjs','.py','.go','.rs','.sql','.md'].includes(extname(file))) continue
   if (entry.include && !entry.include.some((prefix) => file === prefix || file.startsWith(prefix + '/'))) continue
   // Read committed bytes, not a dirty checkout or symlink target.
   const bytes = execFileSync('git', ['-C', repo, 'show', `${commit}:${file}`], {maxBuffer:4*1024*1024})
   const relative = `${entry.key}/${file}`
   const target = join(stage, 'input', relative)
   await mkdir(dirname(target), {recursive:true}); await writeFile(target, bytes)
   manifest.files.push({source:relative, commit, sha256:SHA(bytes)})
   if (extname(file) === '.md') {
    const text=bytes.toString('utf8'), lines=text.split('\n')
    const id=`doc:${relative}`
    docNodes.push({id,label:file,source_file:relative,source_location:'L1',file_type:'document',provenance:'EXTRACTED',extractor:'local-markdown-structure'})
    lines.forEach((line,i) => {
     const heading=line.match(/^#{1,6}\s+(.+)$/)
     if (!heading) return
     const hid=`${id}:L${i+1}`
     docNodes.push({id:hid,label:heading[1],source_file:relative,source_location:`L${i+1}`,file_type:'document',provenance:'EXTRACTED',extractor:'local-markdown-structure'})
     docEdges.push({source:id,target:hid,relation:'contains_heading',confidence:'EXTRACTED'})
    })
   }
  }
 }
 const graphify = config.graphifyExecutable || 'graphify'
 execFileSync(graphify,['extract',join(stage,'input'),'--code-only','--no-cluster','--out',join(stage,'output')],{
   stdio:'inherit', timeout:600000,
   env:{PATH:process.env.PATH,HOME:join(stage,'home'),GRAPHIFY_QUERY_LOG_DISABLE:'1'},
 })
 const graph=JSON.parse(await readFile(join(stage,'output','graphify-out','graph.json'),'utf8'))
 graph.nodes.push(...docNodes); graph.edges.push(...docEdges)
 graph.dock={schema:1,manifestSha256:SHA(JSON.stringify(manifest)),semanticExtraction:false}
 const out=resolve(outputDir), pending=`${out}.pending-${process.pid}`
 await mkdir(pending,{recursive:true,mode:0o700})
 await writeFile(join(pending,'graph.json'),JSON.stringify(graph),{mode:0o600})
 await writeFile(join(pending,'manifest.json'),JSON.stringify(manifest,null,2),{mode:0o600})
 await rm(out,{recursive:true,force:true}); await rename(pending,out)
 console.log(JSON.stringify({output:out,nodes:graph.nodes.length,edges:graph.edges.length,files:manifest.files.length,docs:docNodes.length}))
} finally { await rm(stage,{recursive:true,force:true}) }
