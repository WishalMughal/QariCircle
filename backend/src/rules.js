const stateTransitions = Object.freeze({
  draft: ['pending_review'], pending_review: ['documents_approved', 'rejected'],
  documents_approved: ['test_scheduled', 'rejected'],
  test_scheduled: ['passed', 'retest', 'rejected'],
  passed: ['active', 'rejected'], retest: ['test_scheduled', 'rejected'],
  rejected: ['draft'], active: ['suspended'], suspended: ['active']
});
export function canTransition(from, to) { return (stateTransitions[from] || []).includes(to); }
export function gradeTutor(scores) {
  const limits = {recitation_score:30, tajweed_score:25, subject_score:20, demo_score:15, communication_score:10};
  for (const [field, max] of Object.entries(limits)) {
    if (!Number.isInteger(scores[field]) || scores[field] < 0 || scores[field] > max) throw new Error(`Invalid score: ${field}`);
  }
  const total = Object.keys(limits).reduce((n,k)=>n+scores[k],0);
  return {total, result:total>=75 && scores.recitation_score>=21 && scores.tajweed_score>=18?'passed':'retest'};
}
export function meetLink(input) {
  if (typeof input !== 'string') return null;
  try {
    const u = new URL(input.trim());
    if (u.protocol !== 'https:' || u.hostname !== 'meet.google.com' || u.port || u.username || u.password || u.hash) return null;
    if (!/^\/[a-z]{3}-[a-z]{4}-[a-z]{3}\/?$/.test(u.pathname)) return null;
    if (u.search) return null;
    return `https://meet.google.com${u.pathname.replace(/\/$/,'')}`;
  } catch { return null; }
}
export function isoUtc(value) {
  if(typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const d = new Date(value); return Number.isNaN(d.getTime())?null:d.toISOString().slice(0,19).replace('T',' ');
}
