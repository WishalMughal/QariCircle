/** Run as a separate process: npm run reminders; or npm run reminders-once for cron. */
import 'dotenv/config';
import mysql from 'mysql2/promise';
import {formatUtcSql,sqlUtcDate} from './communication_rules.js';
export function reminderKind(minutes){
  if(minutes>=0&&minutes<=15)return '15m';
  if(minutes>15&&minutes<=60)return '1h';
  if(minutes>60&&minutes<=1440)return '24h';
  return null;
}
export async function runReminders(db){
  const now=new Date();
  const [bookings]=await db.execute(`SELECT id,student_id,tutor_id,course_id,starts_at FROM booking_requests
    WHERE status='confirmed' AND starts_at>UTC_TIMESTAMP() AND starts_at<=? ORDER BY starts_at LIMIT 2000`,[formatUtcSql(new Date(now.getTime()+1440*60000))]);
  let inserted=0;
  for(const b of bookings){
    const until=(sqlUtcDate(b.starts_at).getTime()-now.getTime())/60000;
    const kind=reminderKind(until);if(!kind)continue;
    for(const user_id of [b.student_id,b.tutor_id]){
      const [r]=await db.execute(`INSERT IGNORE INTO notifications(user_id,type,title,body,booking_id,dedupe_key)
        VALUES(?,?,?,?,?,?)`,[user_id,'reminder','Upcoming Quran class',`Your class starts within the next ${kind==='24h'?'24 hours':kind==='1h'?'hour':'15 minutes'}. Open Classes to join via Google Meet.`,b.id,`booking_${b.id}_${kind}`]);
      inserted+=r.affectedRows;
    }
  }
  return {scanned:bookings.length,inserted};
}
if(process.argv[1]?.endsWith('reminder_worker.js')){
  for(const k of ['DB_HOST','DB_USER','DB_NAME','DB_PASSWORD'])if(!process.env[k])throw new Error(`Missing env: ${k}`);
  const db=await mysql.createPool({host:process.env.DB_HOST,user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME,port:Number(process.env.DB_PORT||3306),dateStrings:true,timezone:'Z',connectionLimit:3});
  const once=process.argv.includes('--once');
  const tick=async()=>{try{console.log(new Date().toISOString(),await runReminders(db));}catch(error){console.error('Reminder worker error',error);}};
  await tick();
  if(once){await db.end();}else{setInterval(tick,60*1000);}
}
