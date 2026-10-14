#!/usr/bin/env node
/** Opt-in integration smoke against a LOCAL disposable DB/API. Creates test users. */
import {randomBytes} from 'node:crypto';
const base=process.env.SMOKE_API_BASE||'http://127.0.0.1:4000/api';
const u=new URL(base);
if(process.env.SMOKE_ALLOW_MUTATION!=='yes'||!['127.0.0.1','localhost'].includes(u.hostname)||u.protocol!=='http:'){
  throw new Error('Refusing to write: set SMOKE_ALLOW_MUTATION=yes and use http://127.0.0.1 or localhost only');
}
const suffix=randomBytes(7).toString('hex');
const password=`StrongSmoke!${suffix}xyz`;
const call=async(method,path,body,token,expected)=>{
 const response=await fetch(base+path,{method,headers:{'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{})},body:body?JSON.stringify(body):undefined});
 const data=await response.json();
 if(!expected.includes(response.status))throw new Error(`${method} ${path}: expected ${expected.join('/')} got ${response.status}: ${JSON.stringify(data)}`);
 return data;
};
const register=async(role)=>{
 const email=`smoke-${role}-${suffix}@example.invalid`;
 await call('POST','/auth/register',{name:`Smoke ${role}`,email,password,role,country:'Testland',timezone:'UTC'},null,[201]);
 return (await call('POST','/auth/login',{email,password},null,[200])).access_token;
};
const run=async()=>{
 const healthy=await call('GET','/ready',null,null,[200]);if(healthy.database!=='connected')throw new Error('MySQL not ready');
 const student=await register('student');const parent=await register('parent');
 const parent2=await register('parent');
 const invite=await call('POST','/family/invitations',{},student,[201]);
 const childrenBefore=await call('GET','/family/children',null,parent,[200]);
 if(childrenBefore.length)throw new Error('Parent has unexpected children before linking');
 await call('POST','/family/invitations/accept',{invite_code:invite.invite_code},parent,[200]);
 await call('POST','/family/invitations/accept',{invite_code:invite.invite_code},parent2,[404]);
 const children=await call('GET','/family/children',null,parent,[200]);
 if(children.length!==1)throw new Error('Parent link not reflected in API');
 await call('GET',`/family/children/${children[0].student_id}/progress`,null,parent,[200]);
 await call('GET',`/family/children/${children[0].student_id}/progress`,null,parent2,[403]);
 await call('DELETE',`/family/children/${children[0].student_id}`,null,parent,[200]);
 await call('GET',`/family/children/${children[0].student_id}/classes`,null,parent,[403]);
 console.log('PASS: readiness, auth, invite, single-use, guardian authorization, unlink');
};
run().catch(e=>{console.error(e.message);process.exitCode=1;});
