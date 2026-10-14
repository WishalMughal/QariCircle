import test from 'node:test';
import assert from 'node:assert/strict';
import {validInviteCode,mayAccessChild,isFutureExpiry,safeId,INVITE_HOURS,INVITE_BYTES} from '../src/family_rules.js';
import {validateConfig} from '../src/operations_rules.js';

test('guardian invitation requires 20-byte hex token',()=>{
  assert.equal(INVITE_BYTES,20);
  assert.equal(INVITE_HOURS,48);
  assert.equal(validInviteCode('ab'.repeat(20)),true);
  assert.equal(validInviteCode('AB'.repeat(20)),true);
  assert.equal(validInviteCode('ab'.repeat(19)),false);
  assert.equal(validInviteCode('z'.repeat(40)),false);
});
test('guardian association cannot be implied for tutors or strangers',()=>{
  assert.equal(mayAccessChild({role:'parent',sub:'8'},{guardian_id:8}),true);
  assert.equal(mayAccessChild({role:'parent',sub:'9'},{guardian_id:8}),false);
  assert.equal(mayAccessChild({role:'tutor',sub:'8'},{guardian_id:8}),false);
});
test('invite expiry must be strictly future',()=>{
  const n=new Date('2026-10-09T12:00:00Z');
  assert.equal(isFutureExpiry(new Date('2026-10-09T12:00:01Z'),n),true);
  assert.equal(isFutureExpiry(n,n),false);
  assert.equal(isFutureExpiry(new Date('invalid'),n),false);
});
test('strict integer identifiers reject injected and unsafe IDs',()=>{
  assert.equal(safeId('123'),123);
  for(const bad of ['-1','1e2','1 OR 1=1','1.1','0','999999999999999999999'])assert.equal(safeId(bad),null);
});
test('development env may use localhost origin',()=>{
  assert.equal(validateConfig({NODE_ENV:'development',CORS_ORIGIN:'http://localhost:3000'}),true);
});
test('production rejects wildcard and http origins',()=>{
  for(const cors of ['*','http://localhost:3000','https://ok.test,*','https://ok.test/path'])
    assert.throws(()=>validateConfig({NODE_ENV:'production',CORS_ORIGIN:cors,JWT_SECRET:'A'.repeat(64)}));
});
test('production requires non-placeholder JWT secret',()=>{
  assert.throws(()=>validateConfig({NODE_ENV:'production',CORS_ORIGIN:'https://academy.example',JWT_SECRET:'replace_with_secret_here'.repeat(3)}));
  assert.throws(()=>validateConfig({NODE_ENV:'production',CORS_ORIGIN:'https://academy.example',JWT_SECRET:'short'}));
  assert.equal(validateConfig({NODE_ENV:'production',CORS_ORIGIN:'https://academy.example',JWT_SECRET:'A'.repeat(64)}),true);
});
