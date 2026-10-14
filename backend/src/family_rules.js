/** Pure Phase 6 guardian safety rules. */
export const INVITE_HOURS = 48;
export const INVITE_BYTES = 20;
export function validInviteCode(value) {
  return typeof value === 'string' && /^[a-f\d]{40}$/i.test(value.trim());
}
export function mayAccessChild(user, guardianLink) {
  return user?.role === 'parent' && String(user.sub) === String(guardianLink?.guardian_id);
}
export function isFutureExpiry(date, now = new Date()) {
  return date instanceof Date && Number.isFinite(date.getTime()) && date.getTime() > now.getTime();
}
export function safeId(value) {
  const str = String(value);
  return /^\d+$/.test(str) && Number.isSafeInteger(Number(str)) && Number(str) > 0 ? Number(str) : null;
}
