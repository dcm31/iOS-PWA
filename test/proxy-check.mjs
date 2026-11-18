import assert from 'node:assert/strict';
import proxy from '../integration/personal-site-proxy.ts';
const site='https://charliemolthrop.com', worker='https://ios-pwa.charliemolthrop.workers.dev', path='/ios-push-pwa-example/';
const originalFetch=globalThis.fetch;
let calls=0;
try {
 globalThis.fetch=async(url,init)=>{calls++;assert.equal(String(url),worker+path+'api/session?check=1');assert.equal(init.method,'POST');assert.equal(init.redirect,'manual');assert.equal(init.headers.get('origin'),worker);assert.equal(init.headers.get('authorization'),'Bearer test-token');assert.equal(init.headers.get('cookie'),null);assert.equal(init.headers.get('cf-connecting-ip'),null);assert.equal(await new Response(init.body).text(),'{}');return Response.json({ok:true},{status:201,headers:{'Service-Worker-Allowed':path,'Content-Security-Policy':"default-src 'self'"}})};
 const request=origin=>new Request(site+path+'api/session?check=1',{method:'POST',headers:{Origin:origin,Authorization:'Bearer test-token','Content-Type':'application/json',Cookie:'private-site-cookie','CF-Connecting-IP':'spoofed'},body:'{}'});
 for(const origin of ['https://attacker.example','null','https://charliemolthrop.com.evil.example']) assert.equal((await proxy(request(origin))).status,403);
 assert.equal((await proxy(new Request(site+path+'api/session',{method:'POST',body:'{}'}))).status,403);assert.equal(calls,0);
 assert.equal((await proxy(new Request(site+'/ios-push-pwa-example-other'))).status,404);
 const good=await proxy(request(site));assert.equal(good.status,201);assert.equal(good.headers.get('service-worker-allowed'),path);assert.equal(good.headers.get('content-security-policy'),"default-src 'self'");assert.equal(good.headers.get('access-control-allow-origin'),site);assert.equal(calls,1);
 globalThis.fetch=async()=>new Response('<link rel="canonical" href="'+worker+path+'">',{headers:{'Content-Type':'text/html','Content-Length':'123'}});
 const html=await proxy(new Request(site+path));assert.equal(html.headers.get('content-length'),null);assert((await html.text()).includes(site+path));
 globalThis.fetch=async()=>new Response(null,{status:308,headers:{Location:worker+path+'?check=1'}});
 assert.equal((await proxy(new Request(site+path.slice(0,-1)))).headers.get('location'),site+path+'?check=1');
 globalThis.fetch=async()=>new Response(null,{status:302,headers:{Location:'https://attacker.example/'}});assert.equal((await proxy(new Request(site+path))).status,502);
 globalThis.fetch=async()=>{throw new Error('private details')};const error=await proxy(new Request(site+path));assert.equal(error.status,502);assert(!(await error.text()).includes('private'));
 console.log('Proxy checks passed: origin rejection, exact path, method/body/query/auth, credential filtering, scoped headers, canonical/redirect rewriting, failure sanitization.');
}finally{globalThis.fetch=originalFetch;}
