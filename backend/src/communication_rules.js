/** Phase 4 pure rules: tested without a database or timezone server. */
export const asPositiveId = value => {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};
export const validZone = zone => {
  if(typeof zone !== 'string' || zone.length > 80) return false;
  try { new Intl.DateTimeFormat('en-US',{timeZone:zone});return true; }catch{return false;}
};
const days = {Sun:0,Mon:1,Tue:2,Wed:3,Thu:4,Fri:5,Sat:6};
const partsOf = (date,zone) => {
  const values = Object.fromEntries(new Intl.DateTimeFormat('en-US',{
    timeZone:zone,weekday:'short',year:'numeric',month:'2-digit',day:'2-digit',
    hour:'2-digit',minute:'2-digit',hourCycle:'h23'
  }).formatToParts(date).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
  return { dayOfWeek:days[values.weekday],dayKey:`${values.year}-${values.month}-${values.day}`,
    minute:Number(values.hour)*60+Number(values.minute) };
};
export const validWindows = windows => {
  if(!Array.isArray(windows)||windows.length>35)return false;
  const grouped=new Map();
  for(const w of windows){
    if(!Number.isInteger(w.weekday)||w.weekday<0||w.weekday>6||
       !Number.isInteger(w.start_minute)||!Number.isInteger(w.end_minute)||
       w.start_minute<0||w.end_minute>1440||w.start_minute>=w.end_minute||
       w.end_minute-w.start_minute<30) return false;
    if(!grouped.has(w.weekday))grouped.set(w.weekday,[]);
    grouped.get(w.weekday).push(w);
  }
  for(const group of grouped.values()){
    group.sort((a,b)=>a.start_minute-b.start_minute);
    for(let i=1;i<group.length;i++)if(group[i].start_minute<group[i-1].end_minute)return false;
  }
  return true;
};
export const fitsAvailability = (start,end,zone,windows) => {
  if(!validZone(zone)||!(start instanceof Date)||!(end instanceof Date)||
     !Number.isFinite(start.getTime())||!Number.isFinite(end.getTime())||
     end<=start||end-start>120*60000)return false;
  const a=partsOf(start,zone),b=partsOf(end,zone);
  if(a.dayKey!==b.dayKey)return false;
  return windows.some(w=>w.weekday===a.dayOfWeek&&a.minute>=w.start_minute&&b.minute<=w.end_minute);
};
export const formatUtcSql = date => date.toISOString().slice(0,19).replace('T',' ');
export const sqlUtcDate = value => new Date(String(value).replace(' ','T')+'Z');
export const isChatParticipant = (user,conversation) =>
  (user.role==='student' && String(conversation.student_id)===String(user.sub)) ||
  (user.role==='tutor' && String(conversation.tutor_id)===String(user.sub));
export const validBody = body => typeof body==='string'&&body.trim().length>0&&body.trim().length<=2000;
export const bookingWindow = (start,end,now=new Date()) => end>start && start>now && start.getTime()-now.getTime()<=90*86400000 &&
  [30,60].includes((end-start)/60000);
