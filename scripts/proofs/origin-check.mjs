import assert from'node:assert/strict'
import{ownerOriginMatches}from'../../lib/mobile/origin.ts'
process.env.DOCK_PUBLIC_ORIGIN='https://dock.example.com'
assert.equal(ownerOriginMatches(new Request('http://internal:3000/approve',{headers:{origin:'https://dock.example.com'}})),true)
assert.equal(ownerOriginMatches(new Request('http://internal:3000/approve',{headers:{origin:'https://evil.invalid','x-forwarded-host':'dock.example.com'}})),false)
assert.equal(ownerOriginMatches(new Request('http://internal:3000/approve')),false)
process.env.DOCK_PUBLIC_ORIGIN='https://dock.example.com/wrong-path'
assert.equal(ownerOriginMatches(new Request('http://internal:3000/approve',{headers:{origin:'https://dock.example.com'}})),false)
delete process.env.DOCK_PUBLIC_ORIGIN
console.log('Owner origin checks pass: configured proxy origin allowed, spoofed forwarded host/missing origin/malformed config refused')
