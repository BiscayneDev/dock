// Typecheck in a fresh process before webpack, so the compiler's live heap does
// not overlap the Next type worker. Any error stops the build. No ignored types.
import{spawnSync}from'node:child_process'
const run=(script,args,extra={})=>{const r=spawnSync(process.execPath,[script,...args],{stdio:'inherit',env:{...process.env,NODE_OPTIONS:'--max-old-space-size=640',...extra}});if(r.status!==0){process.exit(r.status??1)}}
run('node_modules/typescript/bin/tsc',['--noEmit','--incremental','false'])
run('node_modules/next/dist/bin/next',['build','--webpack'],{DOCK_BUILD_TYPES_CHECKED:'true'})
