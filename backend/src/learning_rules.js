export const positiveId = value => {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};
export const SURAH_COUNT=114;
export const validIsoDay = day => /^\d{4}-\d{2}-\d{2}$/.test(day) && !Number.isNaN(Date.parse(day+'T00:00:00Z')) && new Date(day+'T00:00:00Z').toISOString().slice(0,10)===day;
export const normalizeHifzRange = ({from_surah,to_surah,mistakes}) => {
  if(!Number.isInteger(from_surah)||!Number.isInteger(to_surah)||from_surah<1||to_surah>SURAH_COUNT||to_surah<from_surah)
    return null;
  if(!Number.isInteger(mistakes)||mistakes<0||mistakes>1000)return null;
  return {from_surah,to_surah,mistakes};
};
export const canReadEnrollment = (actor,enrollment) => Boolean(
  actor.role==='admin' ||
  (actor.role==='student'&&String(enrollment.student_id)===String(actor.sub)) ||
  (actor.role==='tutor'&&String(enrollment.tutor_id)===String(actor.sub))
);
export const canManageEnrollment = (actor,enrollment) => Boolean(
  actor.role==='tutor' && String(enrollment.tutor_id)===String(actor.sub) && enrollment.status==='active'
);
export const percent = (done,total)=>total>0?Math.round(done*100/total):0;
export const isValidScore = s=>s===null||(Number.isInteger(s)&&s>=0&&s<=100);
