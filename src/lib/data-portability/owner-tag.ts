import {createHash} from 'node:crypto'
export function sandboxOwnerTag(userId:string):string {return createHash('sha256').update(`dinghy:sandbox:${userId}`).digest('hex')}
