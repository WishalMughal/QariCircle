import {randomBytes, createHash} from 'node:crypto';
import bcrypt from 'bcryptjs';
import {z} from 'zod';

const name='QariCircle';
export const brand={name,descriptor:'QariCircle Online Quran Academy',tagline:'Learn Quran. Connect Worldwide.',colors:{primary:'#123D34',accent:'#D6B36E',background:'#F8F5ED',secondary:'#0F766E'},classProvider:'google_meet_link',builtInCalls:'coming_soon',features:{chat:'polling',notifications:'in_app',payment:'manual_admin_verified',audioVideo:'coming_soon'}};
const id=x=>/^\d+$/.test(String(x))&&Number(x)>0?String(x):null;
const sha=s=>createHash('sha256').update(s).digest('hex');
const sqlTime=d=>d.toISOString().slice(0,19).replace('T',' ');
export function registerQariCircle(app,{db,auth,api,fail}){
  app.get('/api/brand',(_req,res)=>res.json(brand));
  app.get('/api/public/catalog',api(async(_req,res)=>{
    const [courses]=await db.execute('SELECT id,title,slug,description FROM courses WHERE is_active=1 ORDER BY id');
    const [[tutors]]=await db.execute("SELECT COUNT(*) total FROM tutor_profiles t JOIN users u ON u.id=t.user_id WHERE t.approval_status='active' AND u.is_active=1");
    res.json({brand,courses,verified_tutors:tutors.total,booking_requires_login:true});
  }));
  app.get('/api/notifications/summary',auth(),api(async(req,res)=>{
    const [[n]]=await db.execute('SELECT COUNT(*) unread FROM notifications WHERE user_id=? AND read_at IS NULL',[req.user.sub]);
    res.set('Cache-Control','no-store');res.json(n);
  }));
  app.patch('/api/notifications/read-all',auth(),api(async(req,res)=>{
    const [r]=await db.execute('UPDATE notifications SET read_at=UTC_TIMESTAMP() WHERE user_id=? AND read_at IS NULL',[req.user.sub]);res.json({updated:r.affectedRows});
  }));
  app.patch('/api/me/profile',auth(['student','tutor','parent']),api(async(req,res)=>{
    const p=z.object({name:z.string().trim().min(2).max(120).optional(),country:z.string().trim().max(100).nullable().optional(),timezone:z.string().trim().max(80).optional()}).strict().parse(req.body);
    if(!Object.keys(p).length)return fail(res,400,'No fields to update');
    if(p.timezone){try{Intl.DateTimeFormat('en',{timeZone:p.timezone});}catch{return fail(res,400,'Invalid timezone');}}
    const keys=Object.keys(p);await db.execute(`UPDATE users SET ${keys.map(x=>x+'=?').join(',')} WHERE id=?`,[...keys.map(x=>p[x]),req.user.sub]);res.json({ok:true});
  }));
  app.patch('/api/me/password',auth(),api(async(req,res)=>{
    const p=z.object({current_password:z.string(),new_password:z.string().min(10).max(100)}).parse(req.body);
    const [[u]]=await db.execute('SELECT password_hash FROM users WHERE id=?',[req.user.sub]);
    if(!await bcrypt.compare(p.current_password,u.password_hash))return fail(res,401,'Current password incorrect');
    const hash=await bcrypt.hash(p.new_password,12);const cx=await db.getConnection();
    try{await cx.beginTransaction();await cx.execute('UPDATE users SET password_hash=? WHERE id=?',[hash,req.user.sub]);await cx.execute('UPDATE refresh_sessions SET revoked_at=UTC_TIMESTAMP() WHERE user_id=? AND revoked_at IS NULL',[req.user.sub]);await cx.commit();res.json({ok:true,reauthentication_required:true});}
    catch(e){await cx.rollback();throw e;}finally{cx.release();}
  }));
  app.post('/api/me/deletion-request',auth(),api(async(req,res)=>{
    const p=z.object({reason:z.string().max(500).default('')}).parse(req.body||{});
    await db.execute('INSERT INTO account_deletion_requests(user_id,reason) VALUES(?,?) ON DUPLICATE KEY UPDATE reason=VALUES(reason), status=IF(status=\'completed\',status,\'requested\')',[req.user.sub,p.reason]);
    res.status(202).json({status:'requested',message:'Request queued for privacy/legal retention review; account not yet deleted.'});
  }));
  app.post('/api/support/tickets',auth(),api(async(req,res)=>{
    const p=z.object({category:z.enum(['technical','booking','billing','safety','other']),subject:z.string().trim().min(5).max(160),message:z.string().trim().min(10).max(4000),related_user_id:z.number().int().positive().optional()}).parse(req.body);
    const [r]=await db.execute('INSERT INTO support_tickets(user_id,category,subject,message,related_user_id) VALUES(?,?,?,?,?)',[req.user.sub,p.category,p.subject,p.message,p.related_user_id||null]);
    res.status(201).json({id:r.insertId,status:'open'});
  }));
  app.get('/api/support/tickets',auth(),api(async(req,res)=>{
    const admin=req.user.role==='admin';const [rows]=await db.execute(`SELECT id,user_id,category,subject,message,status,admin_note,created_at FROM support_tickets ${admin?'':'WHERE user_id=?'} ORDER BY id DESC LIMIT 100`,admin?[]:[req.user.sub]);res.json(rows);
  }));
  app.patch('/api/support/tickets/:id',auth(['admin']),api(async(req,res)=>{
    if(!id(req.params.id))return fail(res,400,'Invalid ID');
    const p=z.object({status:z.enum(['open','in_review','resolved','closed']),admin_note:z.string().max(2000).default('')}).parse(req.body);
    const [r]=await db.execute('UPDATE support_tickets SET status=?,admin_note=?,reviewed_by=? WHERE id=?',[p.status,p.admin_note,req.user.sub,req.params.id]);
    if(!r.affectedRows)return fail(res,404,'Ticket not found');
    await db.execute('INSERT INTO audit_logs(actor_id,action,target_id,details) VALUES(?,?,?,?)',[req.user.sub,'support_ticket_review',req.params.id,JSON.stringify({status:p.status})]);res.json({ok:true});
  }));
  app.get('/api/admin/audit-logs',auth(['admin']),api(async(req,res)=>{
    const before=req.query.before_id===undefined?null:id(req.query.before_id);if(req.query.before_id!==undefined&&!before)return fail(res,400,'Invalid cursor');
    const [rows]=await db.execute(`SELECT id,actor_id,action,target_id,details,created_at FROM audit_logs ${before?'WHERE id<?':''} ORDER BY id DESC LIMIT 100`,before?[before]:[]);res.json(rows);
  }));
  app.get('/api/admin/deletion-requests',auth(['admin']),api(async(_req,res)=>{
    const [rows]=await db.execute('SELECT id,user_id,reason,status,created_at FROM account_deletion_requests ORDER BY id DESC LIMIT 100');res.json(rows);
  }));
  app.get('/api/admin/reports/overview',auth(['admin']),api(async(_req,res)=>{
    const [[v]]=await db.execute(`SELECT (SELECT COUNT(*) FROM users) users,(SELECT COUNT(*) FROM tutor_profiles WHERE approval_status='active') active_tutors,(SELECT COUNT(*) FROM booking_requests WHERE status='confirmed') confirmed_bookings,(SELECT COUNT(*) FROM support_tickets WHERE status IN ('open','in_review')) open_tickets,(SELECT COUNT(*) FROM finance_invoices WHERE status='under_review') payments_pending_review`);res.json(v);
  }));
  app.get('/api/me/privacy',auth(),api(async(req,res)=>{
    const [[u]]=await db.execute('SELECT id,name,email,role,country,timezone,created_at FROM users WHERE id=?',[req.user.sub]);
    res.set('Cache-Control','no-store');res.json({profile:u,export_note:'For complete private records, submit a support ticket with category other.'});
  }));
}
