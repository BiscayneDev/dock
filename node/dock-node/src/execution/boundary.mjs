// Controller-plane comparison against a reviewed immutable image digest and
// documented platform isolation contract. This is a PREPARATION boundary;
// deny-all also blocks model services. Launch needs separately verified scoped
// gateway egress, and is intentionally not enabled by this verifier. No workload/model attestation here.
export function pinnedBoundaryVerifier({reviewed}){
 if(!reviewed||!/^dock-t3-[a-z0-9-]+@[1-9][0-9]*$/.test(reviewed.template??'')||!/^sha256:[a-f0-9]{64}$/.test(reviewed.imageDigest??'')||!reviewed.imageReviewEvidence||!reviewed.platformIsolationEvidence||reviewed.workloadUid<=0||reviewed.workloadHasSudo!==false||reviewed.includesOwnerCredentials!==false||reviewed.sharedMounts!==false||!reviewed.rootOwnedRuntimePolicy)throw Error('Independent reviewed image and platform evidence required')
 return async({instanceId,template,state})=>{
  const[name,revision]=reviewed.template.split('@')
  return instanceId===state?.id&&template===reviewed.template&&state.template===name&&state.template_revision===Number(revision)&&state.image_digest===reviewed.imageDigest&&state.mount_path==='/home/node'&&state.type==='default'&&state.region==='us'&&Array.isArray(state.public_ports)&&state.public_ports.length===0&&state.network==='deny-all'
 }
}
