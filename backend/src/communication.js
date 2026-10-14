import { z } from 'zod';
import {asPositiveId,validZone,validWindows,fitsAvailability,formatUtcSql,sqlUtcDate,isChatParticipant,validBody} from './communication_rules.js';

const fail=(res,status,message)=>res.status(status).json({error:message});
const timeSql = value => formatUtcSql(new Date(value));
const idFrom = (res,value) => {const id=asPositiveId(value);if(!id)fail(res,400,'Invalid ID');return id;};
export async function notify(db,{user_id,type,title,body,booking_id=null,dedupe_key=null}){
  await db.execute(`INSERT IGNORE INTO notifications(user_id,type,title,body,booking_id,dedupe_key)
    VALUES(?,?,?,?,?,?)`,[user_id,type,title,body,booking_id,dedupe_key]);
}

export async function hasSlot(db,tutorId,start,end,{lock=false}={}) {
  const [[user]]=await db.execute('SELECT timezone FROM users WHERE id=?',[tutorId]);
  if(!user)return false;
  const [win]=await db.execute('SELECT weekday,start_minute,end_minute FROM tutor_availability WHERE tutor_id=?',[tutorId]);
  if(!fitsAvailability(start,end,user.timezone,win))return false;
  const [blackouts]=await db.execute(`SELECT id FROM tutor_blackouts WHERE tutor_id=? AND starts_at<? AND ends_at>? LIMIT 1`,[tutorId,formatUtcSql(end),formatUtcSql(start)]);
  if(blackouts.length)return false;
  // Bookings must be checked again under a tutor-profile lock in the confirmation endpoint.
  const [busy]=await db.execute("SELECT id FROM booking_requests WHERE tutor_id=? AND status='confirmed' AND starts_at<? AND ends_at>? LIMIT 1",[tutorId,formatUtcSql(end),formatUtcSql(start)]);
  return !busy.length;
}

export function registerCommunication(app,{db,auth,api}){
  app.patch('/api/me/timezone',auth(['student','tutor','parent','admin','examiner']),api(async(req,res)=>{
    const p=z.object({timezone:z.string().max(80)}).parse(req.body);
    if(!validZone(p.timezone))return fail(res,400,'Invalid IANA timezone');
    await db.execute('UPDATE users SET timezone=? WHERE id=?',[p.timezone,req.user.sub]);res.json({timezone:p.timezone});
  }));
  app.get('/api/schedule/availability',auth(['tutor']),api(async(req,res)=>{
    const [[u]]=await db.execute('SELECT timezone FROM users WHERE id=?',[req.user.sub]);
    const [rows]=await db.execute('SELECT id,weekday,start_minute,end_minute FROM tutor_availability WHERE tutor_id=? ORDER BY weekday,start_minute',[req.user.sub]);
    res.json({timezone:u.timezone,windows:rows});
  }));
  app.put('/api/schedule/availability',auth(['tutor']),api(async(req,res)=>{
    const p=z.object({windows:z.array(z.object({weekday:z.number().int().min(0).max(6),start_minute:z.number().int(),end_minute:z.number().int()})).max(35)}).parse(req.body);
    if(!validWindows(p.windows))return fail(res,400,'Invalid or overlapping availability windows');
    const cx=await db.getConnection();
    try{await cx.beginTransaction();
      const [[t]]=await cx.execute('SELECT user_id FROM tutor_profiles WHERE user_id=? FOR UPDATE',[req.user.sub]);
      if(!t){await cx.rollback();return fail(res,403,'Tutor profile required');}
      await cx.execute('DELETE FROM tutor_availability WHERE tutor_id=?',[req.user.sub]);
      for(const w of p.windows)await cx.execute('INSERT INTO tutor_availability(tutor_id,weekday,start_minute,end_minute) VALUES(?,?,?,?)',[req.user.sub,w.weekday,w.start_minute,w.end_minute]);
      await cx.commit();res.json({saved:p.windows.length});
    }catch(e){await cx.rollback();throw e;}finally{cx.release();}
  }));
  app.get('/api/schedule/blackouts',auth(['tutor']),api(async(req,res)=>{
    const [rows]=await db.execute('SELECT id,starts_at,ends_at FROM tutor_blackouts WHERE tutor_id=? AND ends_at>=UTC_TIMESTAMP() ORDER BY starts_at LIMIT 100',[req.user.sub]);res.json(rows);
  }));
  app.post('/api/schedule/blackouts',auth(['tutor']),api(async(req,res)=>{
    const p=z.object({starts_at:z.string().datetime({offset:true}),ends_at:z.string().datetime({offset:true})}).parse(req.body);
    const start=new Date(p.starts_at),end=new Date(p.ends_at),now=new Date();
    if(start<now||end<=start||end-start>14*86400000||start-now>120*86400000)return fail(res,400,'Invalid blackout interval');
    const cx=await db.getConnection();
    try{await cx.beginTransaction();
      // Serialize blackout edits with booking confirmation using the same tutor row lock.
      const [[t]]=await cx.execute('SELECT user_id FROM tutor_profiles WHERE user_id=? FOR UPDATE',[req.user.sub]);
      if(!t){await cx.rollback();return fail(res,403,'Tutor profile required');}
      const [confirmed]=await cx.execute("SELECT id FROM booking_requests WHERE tutor_id=? AND status='confirmed' AND starts_at<? AND ends_at>? LIMIT 1",[req.user.sub,formatUtcSql(end),formatUtcSql(start)]);
      if(confirmed.length){await cx.rollback();return fail(res,409,'Blackout overlaps a confirmed class. Resolve or reschedule that class first.');}
      const [r]=await cx.execute('INSERT INTO tutor_blackouts(tutor_id,starts_at,ends_at) VALUES(?,?,?)',[req.user.sub,formatUtcSql(start),formatUtcSql(end)]);
      await cx.commit();res.status(201).json({id:r.insertId});
    }catch(e){await cx.rollback();throw e;}finally{cx.release();}
  }));
  app.delete('/api/schedule/blackouts/:id',auth(['tutor']),api(async(req,res)=>{
    const id=idFrom(res,req.params.id);if(!id)return;
    const [r]=await db.execute('DELETE FROM tutor_blackouts WHERE id=? AND tutor_id=?',[id,req.user.sub]);
    if(!r.affectedRows)return fail(res,404,'Blackout not found');res.json({deleted:true});
  }));
  app.get('/api/schedule/tutors/:id/slots',api(async(req,res)=>{
    const id=idFrom(res,req.params.id);if(!id)return;
    const days=Number(req.query.days??7),duration=Number(req.query.duration??30);
    if(!Number.isInteger(days)||days<1||days>21||![30,60].includes(duration))return fail(res,400,'Invalid slot search');
    const [[t]]=await db.execute(`SELECT u.timezone,t.approval_status FROM users u JOIN tutor_profiles t ON t.user_id=u.id WHERE u.id=? AND u.is_active=1`,[id]);
    if(!t||t.approval_status!=='active')return fail(res,404,'Tutor not available');
    const [windows]=await db.execute('SELECT weekday,start_minute,end_minute FROM tutor_availability WHERE tutor_id=?',[id]);
    if(!windows.length)return res.json({tutor_timezone:t.timezone,slots:[]});
    const now=Date.now(),endTime=now+days*86400000;
    const [busy]=await db.execute("SELECT starts_at,ends_at FROM booking_requests WHERE tutor_id=? AND status='confirmed' AND starts_at<? AND ends_at>?",[id,formatUtcSql(new Date(endTime+3600000)),formatUtcSql(new Date(now))]);
    const [blackouts]=await db.execute('SELECT starts_at,ends_at FROM tutor_blackouts WHERE tutor_id=? AND starts_at<? AND ends_at>?',[id,formatUtcSql(new Date(endTime+3600000)),formatUtcSql(new Date(now))]);
    const overlapping=(list,start,end)=>list.some(v=>sqlUtcDate(v.starts_at)<end&&sqlUtcDate(v.ends_at)>start);
    const slots=[];
    let timestamp=Math.ceil((now+3600000)/(15*60000))*(15*60000);
    for(;timestamp<endTime && slots.length<160;timestamp+=15*60000){
      const start=new Date(timestamp),end=new Date(timestamp+duration*60000);
      // Some IANA timezones use :15 or :45 offsets; this is local half-hour alignment.
      const localMinute=Number(new Intl.DateTimeFormat('en-GB',{timeZone:t.timezone,minute:'2-digit'}).format(start));
      if(localMinute%30!==0)continue;
      if(!fitsAvailability(start,end,t.timezone,windows)||overlapping(busy,start,end)||overlapping(blackouts,start,end))continue;
      slots.push({starts_at:start.toISOString(),ends_at:end.toISOString()});
    }
    res.json({tutor_timezone:t.timezone,slots});
  }));

  // Conversations may be initiated ONLY from an existing confirmed/completed class.
  app.post('/api/conversations',auth(['student','tutor']),api(async(req,res)=>{
    const p=z.object({booking_id:z.number().int().positive()}).parse(req.body);
    const [[b]]=await db.execute(`SELECT b.student_id,b.tutor_id,b.status,s.is_minor,t.approval_status
      FROM booking_requests b JOIN student_profiles s ON s.user_id=b.student_id JOIN tutor_profiles t ON t.user_id=b.tutor_id WHERE b.id=?`,[p.booking_id]);
    if(!b||!['confirmed','completed'].includes(b.status))return fail(res,404,'Confirmed class required');
    if(!isChatParticipant(req.user,b))return fail(res,403,'Not a class participant');
    if(b.approval_status!=='active')return fail(res,403,'Tutor is not active');
    if(b.is_minor){
      const [guardians]=await db.execute('SELECT guardian_id FROM guardians WHERE student_id=? LIMIT 1',[b.student_id]);
      if(!guardians.length)return fail(res,403,'Guardian linkage required before messaging a minor');
    }
    const [r]=await db.execute(`INSERT INTO conversations(student_id,tutor_id) VALUES(?,?)
      ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)`,[b.student_id,b.tutor_id]);
    res.status(201).json({id:r.insertId});
  }));
  app.get('/api/conversations',auth(['student','tutor']),api(async(req,res)=>{
    const col=req.user.role==='student'?'c.student_id':'c.tutor_id';
    const [rows]=await db.execute(`SELECT c.id,c.student_id,c.tutor_id,st.name student_name,tu.name tutor_name,
      (SELECT body FROM messages m WHERE m.conversation_id=c.id ORDER BY m.id DESC LIMIT 1) last_message,
      (SELECT created_at FROM messages m WHERE m.conversation_id=c.id ORDER BY m.id DESC LIMIT 1) last_message_at,
      (SELECT COUNT(*) FROM messages m WHERE m.conversation_id=c.id AND m.sender_id<>?
         AND m.id>COALESCE(cr.last_read_message_id,0)) unread_count
      FROM conversations c JOIN users st ON st.id=c.student_id JOIN users tu ON tu.id=c.tutor_id
      LEFT JOIN conversation_reads cr ON cr.conversation_id=c.id AND cr.user_id=?
      WHERE ${col}=? ORDER BY last_message_at DESC,c.id DESC LIMIT 100`,[req.user.sub,req.user.sub,req.user.sub]);
    res.json(rows);
  }));
  async function getConversation(req,res){
    const id=idFrom(res,req.params.id);if(!id)return null;
    const [[c]]=await db.execute(`SELECT c.student_id,c.tutor_id,t.approval_status,s.is_minor FROM conversations c
      JOIN tutor_profiles t ON t.user_id=c.tutor_id JOIN student_profiles s ON s.user_id=c.student_id WHERE c.id=?`,[id]);
    if(!c){fail(res,404,'Conversation not found');return null;}
    if(!isChatParticipant(req.user,c)){fail(res,403,'Forbidden');return null;}
    if(c.is_minor){const [g]=await db.execute('SELECT guardian_id FROM guardians WHERE student_id=? LIMIT 1',[c.student_id]);if(!g.length){fail(res,403,'Guardian required');return null;}}
    return {id,...c};
  }
  app.get('/api/conversations/:id/messages',auth(['student','tutor']),api(async(req,res)=>{
    const c=await getConversation(req,res);if(!c)return;
    const before=req.query.before_id===undefined?null:asPositiveId(req.query.before_id);
    if(req.query.before_id!==undefined&&!before)return fail(res,400,'Invalid cursor');
    const [rows]=await db.execute(`SELECT id,sender_id,body,created_at FROM messages WHERE conversation_id=? ${before?'AND id<?':''} ORDER BY id DESC LIMIT 50`,before?[c.id,before]:[c.id]);
    res.json(rows.reverse());
  }));
  app.post('/api/conversations/:id/messages',auth(['student','tutor']),api(async(req,res)=>{
    const c=await getConversation(req,res);if(!c)return;
    if(c.approval_status!=='active')return fail(res,403,'Tutor is inactive');
    const p=z.object({body:z.string().max(2000)}).parse(req.body);
    if(!validBody(p.body))return fail(res,400,'Message must contain 1-2000 characters');
    const [booking]=await db.execute("SELECT id FROM booking_requests WHERE student_id=? AND tutor_id=? AND status IN ('confirmed','completed') LIMIT 1",[c.student_id,c.tutor_id]);
    if(!booking.length)return fail(res,403,'A confirmed class is required');
    const body=p.body.trim();
    const recipient=req.user.role==='student'?c.tutor_id:c.student_id;
    const cx=await db.getConnection();
    try{await cx.beginTransaction();
      const [r]=await cx.execute('INSERT INTO messages(conversation_id,sender_id,body) VALUES(?,?,?)',[c.id,req.user.sub,body]);
      await notify(cx,{user_id:recipient,type:'message',title:'New message',body:'You received a Quran Academy message.',dedupe_key:`message_${r.insertId}`});
      await cx.commit();res.status(201).json({id:r.insertId,body,sender_id:req.user.sub});
    }catch(e){await cx.rollback();throw e;}finally{cx.release();}
  }));
  app.post('/api/conversations/:id/read',auth(['student','tutor']),api(async(req,res)=>{
    const c=await getConversation(req,res);if(!c)return;
    const [[last]]=await db.execute('SELECT COALESCE(MAX(id),0) latest FROM messages WHERE conversation_id=?',[c.id]);
    await db.execute(`INSERT INTO conversation_reads(conversation_id,user_id,last_read_message_id) VALUES(?,?,?)
      ON DUPLICATE KEY UPDATE last_read_message_id=GREATEST(last_read_message_id,VALUES(last_read_message_id))`,[c.id,req.user.sub,last.latest]);
    res.json({read_through:last.latest});
  }));
  app.get('/api/notifications',auth(),api(async(req,res)=>{
    const [rows]=await db.execute(`SELECT id,type,title,body,booking_id,read_at,created_at FROM notifications
      WHERE user_id=? ORDER BY id DESC LIMIT 100`,[req.user.sub]);res.setHeader('Cache-Control','no-store');res.json(rows);
  }));
  app.patch('/api/notifications/:id/read',auth(),api(async(req,res)=>{
    const id=idFrom(res,req.params.id);if(!id)return;
    const [r]=await db.execute('UPDATE notifications SET read_at=COALESCE(read_at,UTC_TIMESTAMP()) WHERE id=? AND user_id=?',[id,req.user.sub]);
    if(!r.affectedRows)return fail(res,404,'Notification not found');res.json({ok:true});
  }));
}
