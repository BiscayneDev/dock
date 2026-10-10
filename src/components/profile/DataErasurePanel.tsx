'use client'
import { useState } from 'react'
import { ERASE_WARNING } from '@/lib/data-portability/erasure-copy'
import styles from '@/app/profile/profile.module.css'
type Gate={id:string;token:string}
export default function DataErasurePanel():React.JSX.Element {
  const [gate,setGate]=useState<Gate|null>(null),[phrase,setPhrase]=useState(''),[status,setStatus]=useState(''),[busy,setBusy]=useState(false)
  async function post(action:'request'|'confirm') {
    setBusy(true)
    try {
      const r=await fetch('/api/user/data-erasure',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,...gate,phrase})})
      const data=await r.json()
      if(!r.ok) throw new Error(data.error || 'Request failed')
      if(action==='request') {setGate({id:data.id,token:data.token});setStatus('Review the warning. This confirmation expires in 10 minutes.')}
      else {setStatus('Deletion queued. Your account is frozen. This is not a completion receipt. Use Check status to confirm the result.');setPhrase('')}
    } catch(e) {setStatus(e instanceof Error?e.message:'Status unavailable. Check before retrying.')}
    finally {setBusy(false)}
  }
  async function check() {
    if(!gate)return
    setBusy(true)
    try {
      const r=await fetch(`/api/user/data-erasure?id=${encodeURIComponent(gate.id)}`,{headers:{'X-Erasure-Receipt':gate.token},cache:'no-store'})
      const data=await r.json()
      if(!r.ok) throw new Error(data.error || 'Status unavailable')
      const j=data.job
      setStatus(j.status==='complete' ? `Deletion complete. ${(j.provider_notes||[]).join('. ')} Copies outside Dinghy cannot be recalled.`
        : j.status==='blocked' ? 'Deletion is blocked during cleanup. Your account remains frozen. Contact support with the deletion ID.'
        : 'Deletion is still queued or running. Not complete yet.')
    }catch(e){setStatus(e instanceof Error?e.message:'Status unavailable')}
    finally{setBusy(false)}
  }
  return <section className={styles.section}>
    <h2 className={styles.h2}>Delete your data</h2>
    <p>{ERASE_WARNING}</p>
    {!gate?<button type="button" onClick={()=>post('request')} disabled={busy}>Review deletion</button>:<>
      <p>Type DELETE MY DATA to confirm. Export your data first if you want to keep it.</p>
      <label>Confirmation <input value={phrase} onChange={e=>setPhrase(e.target.value)} autoComplete="off" /></label>
      <button type="button" onClick={()=>post('confirm')} disabled={busy||phrase!=='DELETE MY DATA'}>Permanently delete</button>
      <button type="button" onClick={check} disabled={busy}>Check status</button>
      <p>Keep this page open to check the result. Your receipt expires 7 days after completion. Deletion ID: {gate.id}</p>
    </>}
    {status&&<p role="status">{status}</p>}
  </section>
}
