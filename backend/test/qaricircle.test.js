import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=p=>readFileSync(new URL(p,import.meta.url),'utf8');
test('QariCircle Meet-only brand response',()=>{const s=source('../src/qaricircle.js');assert.match(s,/name='QariCircle'/);assert.match(s,/classProvider:'google_meet_link'/);assert.match(s,/builtInCalls:'coming_soon'/);});
test('Phase 7 migration exists in full schema and incremental migration',()=>{for(const p of ['../schema.sql','../migrations/007_qaricircle.sql']){const s=source(p);assert.match(s,/CREATE TABLE IF NOT EXISTS support_tickets/);assert.match(s,/CREATE TABLE IF NOT EXISTS account_deletion_requests/);}});
test('Role guarded administration and protected profile mutations',()=>{const s=source('../src/qaricircle.js');assert.match(s,/auth\(\['admin'\]\)/);assert.match(s,/auth\(\)/);assert.match(s,/refresh_sessions SET revoked_at/);});
