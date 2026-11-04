// Client-only fictional HTTP contract test, not a native/production proof.
import assert from 'node:assert/strict'
import puppeteer from 'puppeteer-core'
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
const root=path.resolve('mobile/dist')
const server=http.createServer((req,res)=>{
 const f=path.join(root, req.url.split('?')[0]==='/'?'index.html':req.url.split('?')[0]);
 res.setHeader('Content-Type', f.endsWith('.js')?'application/javascript':f.endsWith('.html')?'text/html':'application/octet-stream')
 try{res.end(fs.readFileSync(f))}catch{res.writeHead(404);res.end()}
}).listen(8899,'127.0.0.1')
const b=await puppeteer.launch({executablePath:'/usr/bin/google-chrome',headless:true,args:['--no-sandbox'],defaultViewport:{width:390,height:844}})
try{
 const p=await b.newPage(); let failRefresh=false
 await p.setRequestInterception(true)
 p.on('request',async r=>{
  const u=new URL(r.url())
  if(u.host!=='dock.test'){await r.continue();return}
  const cors={'access-control-allow-origin':'*','access-control-allow-headers':'*','content-type':'application/json'}
  if(r.method()==='OPTIONS'){await r.respond({status:204,headers:cors});return}
  let status=200,body={}
  if(u.pathname==='/api/mobile/pair/exchange')body={deviceToken:'dockdev_fictional'}
  else if(u.pathname==='/api/mobile/status')body={ok:true}
  else if(u.pathname==='/api/tasks') {if(failRefresh)status=503;body=[{id:'fixture-1',title:'FICTIONAL result task',column:'done',assignee:'scout'}]}
  else if(u.pathname==='/api/messages') {if(r.method()==='POST')status=503;body=[{id:'msg-1',taskId:'fixture-1',from:'scout',content:'FICTIONAL useful result: checked three source files.',timestamp:'2026-11-04T16:00:00Z'}]}
  else if(u.pathname==='/api/runs')body={runs:[]}
  else if(u.pathname==='/api/repos')body={repos:[]}
  else if(u.pathname==='/api/mobile/approvals')body={cards:[]}
  await r.respond({status,headers:cors,body:JSON.stringify(body)})
 })
 const click=async text=>{await p.evaluate(t=>{const e=[...document.querySelectorAll('div,button')].find(e=>e.children.length===0&&e.textContent===t);if(!e)throw Error('missing '+t);e.click()},text)}
 await p.goto('http://127.0.0.1:8899/',{waitUntil:'networkidle0'})
 let inputs=await p.$$('input');await inputs[0].type('https://dock.test');await inputs[1].type('123456');await click('Connect')
 await p.waitForFunction(()=>document.body.innerText.includes('FICTIONAL result task'))
 await click('FICTIONAL result task')
 await p.waitForFunction(()=>document.body.innerText.includes('FICTIONAL useful result'))
 inputs=await p.$$('input');await inputs[0].type('Keep this unsent text');await click('Send')
 await p.waitForFunction(()=>document.body.innerText.includes('Message was not confirmed'))
 assert.equal(await inputs[0].evaluate(e=>e.value),'Keep this unsent text')
 await p.screenshot({path:'/downloads/dock-mobile-failed-message-1104.png'})
 await click('‹ Board');failRefresh=true;await click('Refresh')
 await p.waitForFunction(()=>document.body.innerText.includes('Showing the last loaded board'))
 assert.ok((await p.$eval('body',e=>e.innerText)).includes('FICTIONAL result task'))
 await p.screenshot({path:'/downloads/dock-mobile-offline-board-1104.png'})
 console.log('PASS result renders, failed message retains input, failed refresh retains board with warning')
}finally{await b.close();server.close()}
