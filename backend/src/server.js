import 'dotenv/config';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import mysql from 'mysql2/promise';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { meetLink, isoUtc } from './rules.js';
import { registerPhase2 } from './phase2.js';
import { registerLearning } from './learning.js';
import { registerCommunication, notify, hasSlot } from './communication.js';
import { bookingWindow } from './communication_rules.js';
import { registerFinance } from './finance.js';
import { registerFamily } from './family.js';
import {registerQariCircle} from './qaricircle.js';
import { validateConfig } from './operations_rules.js';
import { priceForBooking, validCurrency, validBps } from './finance_rules.js';

for(const key of ['DB_HOST','DB_USER','DB_NAME','DB_PASSWORD','JWT_SECRET']) if(!process.env[key])throw new Error(`Missing env: ${key}`);
if(process.env.JWT_SECRET.length<32)throw new Error('JWT_SECRET too short');
validateConfig(process.env);
const commissionBps=Number(process.env.ACADEMY_COMMISSION_BPS||2000);
if(!validBps(commissionBps))throw new Error('ACADEMY_COMMISSION_BPS must be an integer 0-5000');
const db=mysql.createPool({host:process.env.DB_HOST,port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME,connectionLimit:10,timezone:'Z',dateStrings:true});
const app=express();
app.disable('x-powered-by');
app.use((req,res,next)=>{req.requestId=randomUUID();res.setHeader('X-Request-Id',req.requestId);next();});
app.use('/api',rateLimit({windowMs:15*60*1000,limit:600,standardHeaders:'draft-7',legacyHeaders:false}));
app.use(helmet());
app.use(cors({origin:(process.env.CORS_ORIGIN||'http://localhost:3000').split(',')}));
app.use(express.json({limit:'64kb'}));
app.use('/api/auth',rateLimit({windowMs:15*60*1000,limit:40,standardHeaders:'draft-7',legacyHeaders:false}));
const api=(fn)=>(req,res,next)=>Promise.resolve(fn(req,res,next)).catch(next);
const fail=(res,status,error)=>res.status(status).json({error});
const fingerprint=(token)=>createHash('sha256').update(token).digest('hex');
const utcSql=(d)=>d.toISOString().slice(0,19).replace('T',' ');
const sessionDays=30;
const accessToken=(user)=>jwt.sign({sub:String(user.id)},process.env.JWT_SECRET,{expiresIn:'30m',algorithm:'HS256'});
async function createSession(cx,userId){
  const secret=randomBytes(48).toString('base64url');
  await cx.execute('INSERT INTO refresh_sessions(user_id,token_hash,expires_at) VALUES(?,?,?)',[userId,fingerprint(secret),utcSql(new Date(Date.now()+sessionDays*86400000))]);
  return secret;
}
function auth(roles=[]){return api(async(req,res,next)=>{
  const header=req.headers.authorization||'';
  if(!header.startsWith('Bearer '))return fail(res,401,'Authentication required');
  let token;try{token=jwt.verify(header.slice(7),process.env.JWT_SECRET,{algorithms:['HS256']});}catch{return fail(res,401,'Invalid or expired token');}
  if(!/^\d+$/.test(String(token.sub)))return fail(res,401,'Invalid token');
  const [[user]]=await db.execute('SELECT id,role,is_active FROM users WHERE id=?',[token.sub]);
  if(!user||!user.is_active)return fail(res,401,'Account inactive');
  if(roles.length&&!roles.includes(user.role))return fail(res,403,'Insufficient permissions');
  req.user={sub:String(user.id),role:user.role};next();
});}
const email=z.string().trim().email().max(190);
const registerSchema=z.object({name:z.string().trim().min(2).max(120),email,password:z.string().min(10).max(100),role:z.enum(['student','tutor','parent']),country:z.string().trim().max(100).optional(),timezone:z.string().max(80).default('UTC')});
app.get('/api/health',(_req,res)=>res.json({status:'ok',phase:7,builtInCalls:'coming_soon',classProvider:'google_meet_link'}));
app.get('/api/ready',api(async(_req,res)=>{await db.query('SELECT 1');res.json({ready:true,database:'connected'});}));
app.post('/api/auth/register',api(async(req,res)=>{
  const p=registerSchema.parse(req.body);
  try{Intl.DateTimeFormat('en',{timeZone:p.timezone});}catch{return fail(res,400,'Invalid IANA timezone');}
  const hash=await bcrypt.hash(p.password,12),cx=await db.getConnection();
  try{await cx.beginTransaction();
    const [r]=await cx.execute('INSERT INTO users(name,email,password_hash,role,country,timezone) VALUES(?,?,?,?,?,?)',[p.name,p.email.toLowerCase(),hash,p.role,p.country||null,p.timezone]);
    if(p.role==='tutor')await cx.execute('INSERT INTO tutor_profiles(user_id) VALUES(?)',[r.insertId]);
    if(p.role==='student')await cx.execute('INSERT INTO student_profiles(user_id) VALUES(?)',[r.insertId]);
    await cx.commit();res.status(201).json({id:r.insertId,role:p.role,message:'Registered. Sign in to continue.'});
  }catch(e){await cx.rollback();if(e.code==='ER_DUP_ENTRY')return fail(res,409,'Email already registered');throw e;}finally{cx.release();}
}));
app.post('/api/auth/login',api(async(req,res)=>{
  const p=z.object({email,password:z.string()}).parse(req.body);
  const [rows]=await db.execute('SELECT id,role,password_hash,is_active FROM users WHERE email=?',[p.email.toLowerCase()]);
  if(!rows.length||!(await bcrypt.compare(p.password,rows[0].password_hash))||!rows[0].is_active)return fail(res,401,'Invalid credentials');
  const user=rows[0],refresh_token=await createSession(db,user.id);
  res.json({access_token:accessToken(user),refresh_token,role:user.role,expires_in:1800});
}));
app.post('/api/auth/refresh',api(async(req,res)=>{
  const p=z.object({refresh_token:z.string().min(20)}).parse(req.body);
  const cx=await db.getConnection();
  try{await cx.beginTransaction();
    const [[row]]=await cx.execute(`SELECT s.id,s.user_id,u.role,u.is_active FROM refresh_sessions s JOIN users u ON u.id=s.user_id
      WHERE s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>UTC_TIMESTAMP() FOR UPDATE`,[fingerprint(p.refresh_token)]);
    if(!row||!row.is_active){await cx.rollback();return fail(res,401,'Refresh token invalid or expired');}
    await cx.execute('UPDATE refresh_sessions SET revoked_at=UTC_TIMESTAMP() WHERE id=?',[row.id]);
    const refresh_token=await createSession(cx,row.user_id);
    await cx.commit();res.json({access_token:accessToken({id:row.user_id}),refresh_token,role:row.role,expires_in:1800});
  }catch(e){await cx.rollback();throw e;}finally{cx.release();}
}));
app.post('/api/auth/logout',api(async(req,res)=>{
  const p=z.object({refresh_token:z.string().min(20)}).parse(req.body);
  await db.execute('UPDATE refresh_sessions SET revoked_at=UTC_TIMESTAMP() WHERE token_hash=? AND revoked_at IS NULL',[fingerprint(p.refresh_token)]);
  res.json({ok:true});
}));
app.get('/api/me',auth(),api(async(req,res)=>{
  const [[u]]=await db.execute('SELECT id,name,email,role,country,timezone FROM users WHERE id=?',[req.user.sub]);
  res.json(u);
}));
app.get('/api/courses',api(async(_req,res)=>{
  const [rows]=await db.execute('SELECT id,title,slug,description FROM courses WHERE is_active=1 ORDER BY id');res.json(rows);
}));
app.get('/api/tutors',api(async(req,res)=>{
  const lang=typeof req.query.language==='string'?req.query.language.trim():'';
  const courseId=req.query.course_id?Number(req.query.course_id):null;
  if(lang&&!/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/.test(lang))return fail(res,400,'Invalid language');
  if(courseId!==null&&(!Number.isSafeInteger(courseId)||courseId<=0))return fail(res,400,'Invalid course ID');
  let sql=`SELECT u.id,u.name,u.country,t.bio,t.hourly_rate,t.currency FROM tutor_profiles t
    JOIN users u ON u.id=t.user_id WHERE t.approval_status='active' AND u.is_active=1`;
  const args=[];
  if(lang){sql+=' AND EXISTS (SELECT 1 FROM tutor_languages l WHERE l.tutor_id=u.id AND l.language_code=?)';args.push(lang);}
  if(courseId){sql+=' AND EXISTS (SELECT 1 FROM tutor_courses c WHERE c.tutor_id=u.id AND c.course_id=? AND c.approved=1)';args.push(courseId);}
  sql+=' ORDER BY u.id DESC LIMIT 100';const [rows]=await db.execute(sql,args);res.json(rows);
}));
app.get('/api/tutors/:id',api(async(req,res)=>{
  const id=Number(req.params.id);if(!Number.isSafeInteger(id)||id<=0)return fail(res,400,'Invalid ID');
  const [[t]]=await db.execute(`SELECT u.id,u.name,u.country,t.bio,t.hourly_rate,t.currency FROM tutor_profiles t JOIN users u ON u.id=t.user_id WHERE u.id=? AND u.is_active=1 AND t.approval_status='active'`,[id]);
  if(!t)return fail(res,404,'Tutor not found');
  const [[languages],[courses]]=await Promise.all([
    db.execute('SELECT language_code FROM tutor_languages WHERE tutor_id=?',[id]),
    db.execute('SELECT c.id,c.title FROM tutor_courses tc JOIN courses c ON c.id=tc.course_id WHERE tc.tutor_id=? AND tc.approved=1 AND c.is_active=1',[id])
  ]);res.json({...t,languages:languages.map(x=>x.language_code),courses});
}));
const bookingSchema=z.object({tutor_id:z.number().int().positive(),course_id:z.number().int().positive(),starts_at:z.string(),ends_at:z.string()});
app.post('/api/bookings',auth(['student']),api(async(req,res)=>{
  const p=bookingSchema.parse(req.body);const start=isoUtc(p.starts_at),end=isoUtc(p.ends_at);
  const startDate=new Date(p.starts_at),endDate=new Date(p.ends_at);
  if(!start||!end||!bookingWindow(startDate,endDate)||startDate.getTime()-Date.now()<3600000)return fail(res,400,'Booking must be 30/60 minutes, 1 hour to 90 days in the future');
  const [[t]]=await db.execute(`SELECT t.user_id,t.hourly_rate,t.currency FROM tutor_profiles t JOIN tutor_courses c ON c.tutor_id=t.user_id AND c.course_id=? AND c.approved=1 WHERE t.user_id=? AND t.approval_status='active'`,[p.course_id,p.tutor_id]);
  if(!t)return fail(res,400,'Tutor not verified for this course');
  if(!await hasSlot(db,p.tutor_id,startDate,endDate))return fail(res,409,'Tutor is not available for this time. Select an available slot.');
  const [studentBusy]=await db.execute("SELECT id FROM booking_requests WHERE student_id=? AND status='confirmed' AND starts_at<? AND ends_at>? LIMIT 1",[req.user.sub,end,start]);
  if(studentBusy.length)return fail(res,409,'Student has another class at that time');
  if(!validCurrency(t.currency))return fail(res,400,'Tutor currency not supported for checkout');
  const durationMinutes=(endDate-startDate)/60000;
  const quote=priceForBooking(t.hourly_rate,durationMinutes,commissionBps);
  if(!quote)return fail(res,400,'Tutor has no valid hourly rate for payment. Contact academy admin.');
  const cx=await db.getConnection();let bookingId;
  try{
    await cx.beginTransaction();
    const [r]=await cx.execute('INSERT INTO booking_requests(student_id,tutor_id,course_id,starts_at,ends_at) VALUES(?,?,?,?,?)',[req.user.sub,p.tutor_id,p.course_id,start,end]);
    bookingId=r.insertId;
    await cx.execute('INSERT INTO finance_booking_quotes(booking_id,amount_minor,currency,commission_bps) VALUES(?,?,?,?)',
      [bookingId,quote.amount_minor,t.currency,quote.commission_bps]);
    await notify(cx,{user_id:p.tutor_id,type:'booking',title:'New class request',body:'A student requested a Quran class. Open Classes to respond.',booking_id:bookingId,dedupe_key:`booking_requested_${bookingId}`});
    await cx.commit();
  }catch(e){await cx.rollback();throw e;}finally{cx.release();}
  res.status(201).json({id:bookingId,status:'requested',price:{amount_minor:quote.amount_minor,currency:t.currency}});
}));
app.get('/api/bookings',auth(['student','tutor','admin']),api(async(req,res)=>{
  let sql=`SELECT b.id,b.student_id,b.tutor_id,b.course_id,b.starts_at,b.ends_at,b.status,q.amount_minor quoted_amount_minor,q.currency quoted_currency,
    st.name student_name,tu.name tutor_name,c.title course_title
    FROM booking_requests b LEFT JOIN finance_booking_quotes q ON q.booking_id=b.id JOIN users st ON st.id=b.student_id JOIN users tu ON tu.id=b.tutor_id JOIN courses c ON c.id=b.course_id WHERE `;
  let args=[req.user.sub];
  if(req.user.role==='student')sql+='b.student_id=?';else if(req.user.role==='tutor')sql+='b.tutor_id=?';else{sql+='1=1';args=[];}
  const [rows]=await db.execute(sql+' ORDER BY b.starts_at DESC LIMIT 100',args);res.json(rows);
}));
app.patch('/api/bookings/:id/confirm',auth(['tutor']),api(async(req,res)=>{
  const id=Number(req.params.id);if(!Number.isSafeInteger(id)||id<=0)return fail(res,400,'Invalid booking');
  const p=z.object({meet_url:z.string().max(250)}).parse(req.body);
  const meet_url=meetLink(p.meet_url);if(!meet_url)return fail(res,400,'A direct https://meet.google.com/abc-defg-hij URL is required');
  const cx=await db.getConnection();
  try{await cx.beginTransaction();
    // Every confirmation for the same tutor locks the same profile row to prevent a concurrent double-booking race.
    const [[t]]=await cx.execute("SELECT user_id FROM tutor_profiles WHERE user_id=? AND approval_status='active' FOR UPDATE",[req.user.sub]);
    if(!t){await cx.rollback();return fail(res,403,'Tutor is not active');}
    const [[b]]=await cx.execute('SELECT * FROM booking_requests WHERE id=? AND tutor_id=? FOR UPDATE',[id,req.user.sub]);
    if(!b||b.status!=='requested'){await cx.rollback();return fail(res,409,'Booking unavailable');}
    if(new Date(`${b.starts_at.replace(' ','T')}Z`)<=new Date()){await cx.rollback();return fail(res,409,'Class time has passed');}
    if(!await hasSlot(cx,req.user.sub,new Date(b.starts_at.replace(' ','T')+'Z'),new Date(b.ends_at.replace(' ','T')+'Z'))){
      await cx.rollback();return fail(res,409,'Tutor is no longer available for this slot');
    }
    const [studentOverlap]=await cx.execute("SELECT id FROM booking_requests WHERE student_id=? AND id<>? AND status='confirmed' AND starts_at<? AND ends_at>? LIMIT 1",[b.student_id,id,b.ends_at,b.starts_at]);
    if(studentOverlap.length){await cx.rollback();return fail(res,409,'Student has another confirmed class');}
    await cx.execute("UPDATE booking_requests SET status='confirmed',meet_url=? WHERE id=?",[meet_url,id]);
    await notify(cx,{user_id:b.student_id,type:'booking',title:'Your class is confirmed',body:'Open Classes to see the schedule and join via Google Meet.',booking_id:id,dedupe_key:`booking_confirmed_${id}`});
    await cx.commit();res.json({status:'confirmed'});
  }catch(e){await cx.rollback();throw e;}finally{cx.release();}
}));
app.patch('/api/bookings/:id/reject',auth(['tutor']),api(async(req,res)=>{
  const id=Number(req.params.id);if(!Number.isSafeInteger(id)||id<=0)return fail(res,400,'Invalid booking');
  const [r]=await db.execute("UPDATE booking_requests SET status='rejected' WHERE id=? AND tutor_id=? AND status='requested'",[id,req.user.sub]);
  if(!r.affectedRows)return fail(res,409,'Booking unavailable');
  const [[b]]=await db.execute('SELECT student_id FROM booking_requests WHERE id=?',[id]);
  await notify(db,{user_id:b.student_id,type:'booking',title:'Class request declined',body:'Please choose another available Quran class slot.',booking_id:id,dedupe_key:`booking_declined_${id}`});
  res.json({status:'rejected'});
}));
app.get('/api/bookings/:id/meet',auth(['student','tutor','admin']),api(async(req,res)=>{
  const id=Number(req.params.id);if(!Number.isSafeInteger(id)||id<=0)return fail(res,400,'Invalid booking');
  const [[b]]=await db.execute('SELECT student_id,tutor_id,status,meet_url FROM booking_requests WHERE id=?',[id]);
  if(!b)return fail(res,404,'Booking not found');
  if(req.user.role!=='admin'&&String(b.student_id)!==req.user.sub&&String(b.tutor_id)!==req.user.sub)return fail(res,403,'Forbidden');
  if(b.status!=='confirmed'||!b.meet_url)return fail(res,409,'Meet link not available');
  res.setHeader('Cache-Control','no-store');res.json({meet_url:b.meet_url});
}));

registerPhase2(app,{db,auth,api,fail});
registerLearning(app,{db,auth,api});
registerCommunication(app,{db,auth,api});
registerFinance(app,{db,auth,api});
registerFamily(app,{db,auth,api});
registerQariCircle(app,{db,auth,api,fail});
app.use((err,_req,res,_next)=>{
  if(err instanceof z.ZodError)return fail(res,400,err.flatten());
  if(err.code==='LIMIT_FILE_SIZE')return fail(res,413,'Document too large (max 5 MB)');
  if(err.code==='ER_DUP_ENTRY')return fail(res,409,'Duplicate value');
  if(err instanceof SyntaxError && err.status===400 && 'body' in err)return fail(res,400,'Malformed JSON body');
  if(err.status===413 || err.type==='entity.too.large')return fail(res,413,'Request body too large');
  console.error(`[${_req.requestId||'unknown'}]`,err);return res.status(500).json({error:'Internal server error',request_id:_req.requestId});
});
const port=Number(process.env.PORT||4000);
if(process.env.NODE_ENV!=='test'){
  const server=app.listen(port,()=>console.log(`Quran Academy API running on ${port}`));
  function shutdown(signal){console.log(`${signal}: closing API`);server.close(async()=>{await db.end();process.exit(0);});}
  process.once('SIGTERM',()=>shutdown('SIGTERM'));process.once('SIGINT',()=>shutdown('SIGINT'));
}
export {app};
