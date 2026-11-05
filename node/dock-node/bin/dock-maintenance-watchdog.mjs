#!/usr/bin/env node
// Run outside the workload in a supervised controller failure domain. Does not
// activate maintenance, configure its lifecycle grants or create remote hosts.
import{readFile}from'node:fs/promises';import{maintenanceClient}from'../src/execution/maintenance-client.mjs';import{runExecutionWatchdog}from'../src/execution/watchdog.mjs'
const secretPath=process.env.DOCK_MAINTENANCE_SECRET_FILE;if(!secretPath?.startsWith('/'))throw Error('Private maintenance-only secret file required')
const secret=(await readFile(secretPath,'utf8')).trim(),sweep=maintenanceClient({endpoint:process.env.DOCK_MAINTENANCE_ENDPOINT,secret}),controller=new AbortController()
for(const sig of['SIGTERM','SIGINT'])process.on(sig,()=>controller.abort())
await runExecutionWatchdog({signal:controller.signal,sweep,heartbeat:async receipt=>console.log(JSON.stringify({type:'maintenance-heartbeat',...receipt})),reportFailure:async notice=>console.error(JSON.stringify({type:'maintenance-alert',at:new Date().toISOString(),...notice}))})
