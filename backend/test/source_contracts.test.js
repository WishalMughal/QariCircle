import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
const src=(path)=>readFileSync(new URL(path,import.meta.url),'utf8');
test('Phase 6 schema fresh install and upgrade both contain guardian invites',()=>{
  const full=src('../schema.sql'), migration=src('../migrations/006_parent_access.sql');
  assert.match(full,/CREATE TABLE IF NOT EXISTS guardian_invites/i);
  assert.match(migration,/CREATE TABLE IF NOT EXISTS guardian_invites/i);
  assert.match(migration,/token_hash CHAR\(64\) NOT NULL UNIQUE/i);
});
test('Guardian endpoints never select Google Meet secret URLs',()=>{
  const family=src('../src/family.js');
  assert.match(family,/auth\(\['parent'\]\)/);
  assert.doesNotMatch(family, /SELECT[^;]*meet_url/i);
  assert.match(family,/authorizeChild\(req,res\)/);
});
test('Google Meet booking endpoint and Coming Soon feature remain intact',()=>{
  const backend=src('../src/server.js');
  assert.match(backend,/\/api\/bookings\/:id\/meet/);
  assert.match(backend,/classProvider:'google_meet_link'/);
  assert.match(backend,/builtInCalls:'coming_soon'/);
  assert.ok(existsSync(new URL('../src/family.js',import.meta.url))); // backend-only distribution
});
