import{redirect}from'next/navigation'
import{assistantContext}from'@/lib/assistant-store'
import{beaconReviewCandidates}from'@/lib/mobile/beacon'
import Candidates from'./Candidates'
export const dynamic='force-dynamic'
export default async function Page(){const ctx=await assistantContext();if(!ctx)redirect('/login');const enabled=process.env.DOCK_BEACON_ENABLED==='true';const items=enabled?await beaconReviewCandidates(ctx.userId,ctx.workspaceId):[];return <Candidates items={items} enabled={enabled}/>}
