import { describe,it,expect,vi,afterEach } from 'vitest'
import { wantsPlaces,wantsRestaurantBooking,unmatchedPlacesReply } from '@/lib/places/intent'
import { chatWithTools } from '@/lib/spectrum/dinghy'
afterEach(()=>vi.unstubAllGlobals())
describe('booking intent stays separate from nearby discovery',()=>{
 it('excludes direct and indirect booking asks',()=>{
  for(const t of ['Can you book me a restaurant near my hotel for noodles?', 'book dinner near the station', 'reserve a table near me', 'get me a table for lunch around the marina']) {
   expect(wantsRestaurantBooking(t)).toBe(true);expect(wantsPlaces(t)).toBe(false)
  }
 })
 it('retains ordinary discovery',()=>{
  expect(wantsPlaces('good ramen around the marina')).toBe(true)
  expect(wantsRestaurantBooking('where should I eat near my hotel')).toBe(false)
 })
 it('guards mismatch summaries without inventing matches',()=>{
  expect(unmatchedPlacesReply({matched:false,page:'will_send_after_reply',note:'No tagged noodles found.'})).toContain('not verified matches')
  expect(unmatchedPlacesReply({matched:true})).toBeNull()
  expect(unmatchedPlacesReply({matched:false,page:'not made'})).toContain('did not go out')
 })
 it('does not repeat a model claim that fallback eateries are confirmed matches',async()=>{
  const queue=[{finish_reason:'tool_calls',message:{content:null,tool_calls:[{id:'c',type:'function',function:{name:'find_places',arguments:'{}'}}]}},{finish_reason:'stop',message:{content:'Here are the noodle options. Should I book?'}}]
  vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,headers:new Headers(),json:async()=>({choices:[queue.shift()]})})))
  const tool={name:'find_places',description:'d',inputSchema:{type:'object',properties:{}},execute:async()=>({success:true,data:{matched:false,page:'will_send_after_reply',note:'No tagged noodles found.'}})}
  const r=await chatWithTools([{role:'user',content:'noodles around the marina'}],{gatewayUrl:'https://gateway.example.test',apiKey:'fictional',model:'m'},[tool as never],{tokens:{}} as never)
  expect(r.reply).toContain('No tagged noodles found.');expect(r.reply).not.toContain('Should I book');expect(r.reply).not.toContain('noodle options')
 })
})
