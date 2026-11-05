import {t3Control} from '@/lib/t3-control'
export const dynamic='force-dynamic'
export const runtime='nodejs'
export const maxDuration=300
export async function GET(request:Request){return t3Control(request,true)}
