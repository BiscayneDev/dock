import {expect,it} from 'vitest'
import {buildSystemPrompt} from '@/lib/spectrum/dinghy'
it('read-only scheduled brief cannot promise a connect link or email/calendar writes',()=>{
 const prompt=buildSystemPrompt([],false,{google:true,wallet:false,googleReadOnly:true,googleConnect:false})
 expect(prompt).toContain('This run can only read email and calendar')
 expect(prompt).toContain('This run cannot send a connect link')
 expect(prompt).not.toContain('call google_connect')
 expect(prompt).not.toContain('sending the link now')
 expect(prompt).not.toContain('Events on their own calendar with no attendees are created immediately')
})
it('ordinary interactive Google path retains connect tool guidance',()=>{expect(buildSystemPrompt([],false,{google:true,wallet:false})).toContain('call google_connect')})
