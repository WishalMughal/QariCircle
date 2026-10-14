import test from 'node:test';
import assert from 'node:assert/strict';
import {positiveId,normalizeHifzRange,canReadEnrollment,canManageEnrollment,percent,isValidScore,validIsoDay} from '../src/learning_rules.js';
const e={student_id:10,tutor_id:20,status:'active'};
test('positive IDs reject decimals and zero',()=>{assert.equal(positiveId('23'),23);assert.equal(positiveId('2.2'),null);assert.equal(positiveId('0'),null);});
test('student can only read owned learning record',()=>{assert.equal(canReadEnrollment({role:'student',sub:'10'},e),true);assert.equal(canReadEnrollment({role:'student',sub:'20'},e),false);});
test('tutor writes own active enrollment only',()=>{assert.equal(canManageEnrollment({role:'tutor',sub:'20'},e),true);assert.equal(canManageEnrollment({role:'tutor',sub:'22'},e),false);assert.equal(canManageEnrollment({role:'tutor',sub:'20'},{...e,status:'paused'}),false);});
test('Hifz entry requires valid Surah range and mistakes',()=>{assert.ok(normalizeHifzRange({from_surah:1,to_surah:3,mistakes:0}));assert.equal(normalizeHifzRange({from_surah:5,to_surah:3,mistakes:0}),null);assert.equal(normalizeHifzRange({from_surah:1,to_surah:115,mistakes:0}),null);});
test('progress and score bounds',()=>{assert.equal(percent(3,4),75);assert.equal(percent(2,0),0);assert.equal(isValidScore(100),true);assert.equal(isValidScore(101),false);});

test('Hifz dates reject impossible day',()=>{assert.equal(validIsoDay('2026-02-30'),false);assert.equal(validIsoDay('2026-10-09'),true);});
