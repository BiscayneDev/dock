import{timingSafeEqual}from'node:crypto'
import{NextResponse}from'next/server'
import{maintainMobileExecutions}from'@/lib/mobile/maintenance'
export const runtime='nodejs'
export const dynamic='force-dynamic'
export async function POST(request:Request){
 const key=process.env.DOCK_MAINTENANCE_SECRET,actual=request.headers.get('authorization')??''
 if(!key||key.length<32||actual.length!==key.length+7||!timingSafeEqual(Buffer.from(actual),Buffer.from('Bearer '+key)))return NextResponse.json({error:'Not authorized'},{status:401})
 try{return NextResponse.json(await maintainMobileExecutions())}catch{return NextResponse.json({error:'Maintenance unconfirmed; inspect durable deadlines and heartbeat'},{status:503})}
}
