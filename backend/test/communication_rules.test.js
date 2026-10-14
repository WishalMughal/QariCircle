import test from 'node:test';
import assert from 'node:assert/strict';
import { asPositiveId,validZone,validWindows,fitsAvailability,isChatParticipant,validBody,bookingWindow } from '../src/communication_rules.js';
const t = text => new Date(text);
test('IDs and timezone safety',()=>{
  assert.equal(asPositiveId('12'),12);assert.equal(asPositiveId('2.1'),null);
  assert.equal(validZone('Asia/Karachi'),true);assert.equal(validZone('Mars/Olympus'),false);
});
test('availability refuses overlapping local windows',()=>{
  assert.equal(validWindows([{weekday:1,start_minute:540,end_minute:660},{weekday:1,start_minute:600,end_minute:720}]),false);
  assert.equal(validWindows([{weekday:1,start_minute:540,end_minute:660},{weekday:1,start_minute:660,end_minute:720}]),true);
  assert.equal(validWindows([{weekday:7,start_minute:540,end_minute:660}]),false);
});
test('weekly slots convert UTC to Pakistani local time',()=>{
  const w=[{weekday:1,start_minute:540,end_minute:720}];
  assert.equal(fitsAvailability(t('2026-10-12T04:00:00Z'),t('2026-10-12T04:30:00Z'),'Asia/Karachi',w),true);
  assert.equal(fitsAvailability(t('2026-10-12T08:00:00Z'),t('2026-10-12T08:30:00Z'),'Asia/Karachi',w),false);
});
test('daylight savings change still uses tutor local clock',()=>{
  const w=[{weekday:0,start_minute:540,end_minute:720}];
  assert.equal(fitsAvailability(t('2026-10-25T09:00:00Z'),t('2026-10-25T09:30:00Z'),'Europe/London',w),true);
  assert.equal(fitsAvailability(t('2026-10-18T08:00:00Z'),t('2026-10-18T08:30:00Z'),'Europe/London',w),true);
});
test('overnight class cannot escape availability window',()=>{
  const w=[{weekday:2,start_minute:1380,end_minute:1440}];
  assert.equal(fitsAvailability(t('2026-10-13T23:15:00Z'),t('2026-10-14T00:15:00Z'),'UTC',w),false);
});
test('messaging is restricted to student and tutor participants',()=>{
  const c={student_id:101,tutor_id:303};
  assert.equal(isChatParticipant({role:'student',sub:'101'},c),true);
  assert.equal(isChatParticipant({role:'student',sub:'102'},c),false);
  assert.equal(isChatParticipant({role:'tutor',sub:'303'},c),true);
  assert.equal(isChatParticipant({role:'admin',sub:'303'},c),false);
});
test('messages trim, reject empty and oversized bodies',()=>{
  assert.equal(validBody('  salam   '),true);
  assert.equal(validBody('   '),false);assert.equal(validBody('x'.repeat(2001)),false);
});
test('booking window cannot be in past, too long or over 90 days away',()=>{
  const now=t('2026-10-09T12:00:00Z');
  assert.equal(bookingWindow(t('2026-10-10T12:00:00Z'),t('2026-10-10T12:30:00Z'),now),true);
  assert.equal(bookingWindow(t('2026-10-08T12:00:00Z'),t('2026-10-08T12:30:00Z'),now),false);
  assert.equal(bookingWindow(t('2026-10-10T12:00:00Z'),t('2026-10-10T14:00:00Z'),now),false);
});
