import {timingSafeEqual,randomUUID} from 'node:crypto'
import {NextResponse} from 'next/server'
import {adminClient} from '@/lib/tenancy'
import {vercelT3Tick} from '../node/dock-node/src/t3/vercel-service.mjs'
export async function t3Control(request:Request,cleanupOnly=false){
 const secret=process.env.CRON_SECRET
 if(!secret)return NextResponse.json({error:'Private control not configured'},{status:503})
 const a=Buffer.from(request.headers.get('authorization')??''),b=Buffer.from(`Bearer ${secret}`)
 if(a.length!==b.length||!timingSafeEqual(a,b))return NextResponse.json({error:'Unauthorized'},{status:401})
 // Never accept task, source, grants, callback URLs or credentials from request.
 try{const result=await vercelT3Tick(adminClient(),{cleanupOnly,workerId:`t3:${randomUUID()}`,onError:()=>console.error('Private task lifecycle unresolved')});return NextResponse.json(result)}
 catch{return NextResponse.json({error:'Private control unresolved; reconciliation required'},{status:503})}
}
