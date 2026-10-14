import test from 'node:test';
import assert from 'node:assert/strict';
import {canTransition,gradeTutor,meetLink,isoUtc} from '../src/rules.js';
test('Tutor approval cannot skip testing',()=>{
  assert.equal(canTransition('pending_review','active'),false);
  assert.equal(canTransition('pending_review','documents_approved'),true);
  assert.equal(canTransition('test_scheduled','passed'),true);
});
test('exam requires category minimums as well as 75 total',()=>{
  assert.deepEqual(gradeTutor({recitation_score:28,tajweed_score:23,subject_score:18,demo_score:12,communication_score:9}),{total:90,result:'passed'});
  assert.equal(gradeTutor({recitation_score:20,tajweed_score:25,subject_score:20,demo_score:15,communication_score:10}).result,'retest');
  assert.throws(()=>gradeTutor({recitation_score:99,tajweed_score:25,subject_score:20,demo_score:15,communication_score:10}));
});
test('meet URL strict host and format',()=>{
  assert.equal(meetLink('https://meet.google.com/abc-defg-hij'),'https://meet.google.com/abc-defg-hij');
  for(const bad of ['https://meet.google.com.evil.com/abc-defg-hij','http://meet.google.com/abc-defg-hij','https://meet.google.com/abc-defg-hij?redirect=x','javascript:alert(1)'])assert.equal(meetLink(bad),null);
});
test('offset dates become UTC',()=>assert.equal(isoUtc('2026-11-01T15:00:00+05:00'),'2026-11-01 10:00:00'));
