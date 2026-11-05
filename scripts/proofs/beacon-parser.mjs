import assert from'node:assert/strict'
import{parseBeaconCandidates}from'../../lib/mobile/beacon-proposals.ts'
const result=parseBeaconCandidates('Reply\n```beacon_memory\n["Shared fact","api_key=secret-value","Other fact"]\n```')
assert.equal(result.text,'Reply');assert.deepEqual(result.candidates,['Shared fact','Other fact'])
assert.equal(parseBeaconCandidates('```beacon_memory\nnot-json\n```').candidates.length,0)
assert.equal(parseBeaconCandidates('```beacon_memory\n["a","b","c","d","e"]\n```').candidates.length,4)
console.log('Beacon candidate extraction pass: untrusted proposals only, bounded, secret-shaped values refused')
