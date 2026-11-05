// A configured public origin handles trusted reverse-proxy URL rewriting. Never
// trust forwarded headers or a caller-selected host as the approval destination.
export function ownerOriginMatches(request:Request){
 const source=request.headers.get('origin');if(!source)return false
 const configured=process.env.DOCK_PUBLIC_ORIGIN
 try{const expected=new URL(configured??request.url);if(configured&&(expected.pathname!=='/'||expected.search||expected.hash||expected.username||expected.password))return false;return source===expected.origin}catch{return false}
}
