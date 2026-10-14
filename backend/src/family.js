import {createHash,randomBytes} from 'node:crypto';
import {z} from 'zod';
import {INVITE_HOURS, INVITE_BYTES, validInviteCode, safeId} from './family_rules.js';

const digest = value => createHash('sha256').update(value).digest('hex');
const error = (res,status,message) => res.status(status).json({error:message});
const stamp = date => date.toISOString().slice(0,19).replace('T',' ');

/** Guardian visibility is granted only after a child-account-generated, expiring invite is redeemed by a parent. */
export function registerFamily(app,{db,auth,api}) {
  app.post('/api/family/invitations',auth(['student']),api(async(req,res)=>{
    const [[count]]=await db.execute(`SELECT COUNT(*) n FROM guardian_invites WHERE student_id=?
      AND claimed_at IS NULL AND expires_at>UTC_TIMESTAMP()`,[req.user.sub]);
    if(Number(count.n)>=3)return error(res,429,'You have three active invitations. Please use an existing one or wait for expiry.');
    const code=randomBytes(INVITE_BYTES).toString('hex');
    const expiresAt=new Date(Date.now()+INVITE_HOURS*3600000);
    await db.execute('INSERT INTO guardian_invites(student_id,token_hash,expires_at) VALUES(?,?,?)',
      [req.user.sub,digest(code),stamp(expiresAt)]);
    res.setHeader('Cache-Control','no-store');
    res.status(201).json({invite_code:code,expires_at:expiresAt.toISOString(),warning:'Share this code privately with your parent. It is displayed only once.'});
  }));

  app.post('/api/family/invitations/accept',auth(['parent']),api(async(req,res)=>{
    const p=z.object({invite_code:z.string().max(80)}).parse(req.body);
    if(!validInviteCode(p.invite_code))return error(res,400,'Invalid invitation code');
    const cx=await db.getConnection();
    try {
      await cx.beginTransaction();
      const [[invite]]=await cx.execute(`SELECT i.id,i.student_id FROM guardian_invites i
        JOIN users u ON u.id=i.student_id AND u.role='student' AND u.is_active=1
        WHERE i.token_hash=? AND i.claimed_at IS NULL AND i.expires_at>UTC_TIMESTAMP() FOR UPDATE`,
      [digest(p.invite_code.trim().toLowerCase())]);
      if(!invite){await cx.rollback();return error(res,404,'Invitation invalid, expired or already used');}
      const [[previous]]=await cx.execute('SELECT guardian_id FROM guardians WHERE guardian_id=? AND student_id=?',
        [req.user.sub,invite.student_id]);
      if(previous){await cx.rollback();return error(res,409,'You are already linked to this student');}
      await cx.execute('INSERT INTO guardians(guardian_id,student_id) VALUES(?,?)',[req.user.sub,invite.student_id]);
      await cx.execute('UPDATE guardian_invites SET claimed_at=UTC_TIMESTAMP(),claimed_by=? WHERE id=?',[req.user.sub,invite.id]);
      await cx.execute('INSERT INTO audit_logs(actor_id,action,target_id) VALUES(?,?,?)',
        [req.user.sub,'parent_linked',invite.student_id]);
      await cx.commit();res.json({linked:true,student_id:invite.student_id});
    }catch(e){await cx.rollback();throw e;}finally{cx.release();}
  }));

  app.get('/api/family/guardians',auth(['student']),api(async(req,res)=>{
    const [rows]=await db.execute(`SELECT p.id,p.name,p.email,g.guardian_id
      FROM guardians g JOIN users p ON p.id=g.guardian_id AND p.role='parent' AND p.is_active=1
      WHERE g.student_id=? ORDER BY p.name LIMIT 30`,[req.user.sub]);
    res.setHeader('Cache-Control','private, no-store').json(rows);
  }));

  app.delete('/api/family/guardians/:id',auth(['student']),api(async(req,res)=>{
    const id=safeId(req.params.id);if(!id)return error(res,400,'Invalid guardian ID');
    const [result]=await db.execute('DELETE FROM guardians WHERE student_id=? AND guardian_id=?',[req.user.sub,id]);
    if(!result.affectedRows)return error(res,404,'Guardian relationship not found');
    await db.execute('INSERT INTO audit_logs(actor_id,action,target_id) VALUES(?,?,?)',
      [req.user.sub,'parent_unlinked',id]);
    res.json({unlinked:true});
  }));

  app.get('/api/family/children',auth(['parent']),api(async(req,res)=>{
    const [rows]=await db.execute(`SELECT u.id AS student_id,u.name,u.country,s.level,s.is_minor,
      (SELECT COUNT(*) FROM enrollments e WHERE e.student_id=u.id) AS courses_count,
      (SELECT COUNT(*) FROM booking_requests b WHERE b.student_id=u.id AND b.status='confirmed' AND b.starts_at>=UTC_TIMESTAMP()) AS upcoming_classes
      FROM guardians g JOIN users u ON u.id=g.student_id AND u.role='student' AND u.is_active=1
      LEFT JOIN student_profiles s ON s.user_id=u.id WHERE g.guardian_id=? ORDER BY u.name LIMIT 30`,[req.user.sub]);
    res.setHeader('Cache-Control','private, no-store').json(rows);
  }));

  async function authorizeChild(req,res){
    const studentId=safeId(req.params.id);if(!studentId){error(res,400,'Invalid child ID');return null;}
    const [[link]]=await db.execute(`SELECT g.student_id FROM guardians g
      JOIN users u ON u.id=g.student_id AND u.is_active=1 AND u.role='student'
      WHERE g.guardian_id=? AND g.student_id=?`,[req.user.sub,studentId]);
    if(!link){error(res,403,'You are not linked to this student');return null;}
    return studentId;
  }
  app.get('/api/family/children/:id/progress',auth(['parent']),api(async(req,res)=>{
    const studentId=await authorizeChild(req,res);if(!studentId)return;
    const [rows]=await db.execute(`SELECT e.id AS enrollment_id,e.course_id,c.title AS course_title,
       t.name AS tutor_name,e.status,
       (SELECT COUNT(*) FROM curriculum_units u WHERE u.course_id=e.course_id AND u.is_published=1) AS published_units,
       (SELECT COUNT(*) FROM lesson_progress lp WHERE lp.enrollment_id=e.id AND lp.status='completed') AS completed_units,
       (SELECT COUNT(*) FROM assignments a WHERE a.enrollment_id=e.id) AS assignments_total,
       (SELECT COUNT(*) FROM hifz_logs h WHERE h.enrollment_id=e.id) AS hifz_entries
       FROM enrollments e JOIN courses c ON c.id=e.course_id JOIN users t ON t.id=e.tutor_id
       WHERE e.student_id=? ORDER BY e.id DESC LIMIT 100`,[studentId]);
    res.setHeader('Cache-Control','private, no-store').json(rows);
  }));
  app.get('/api/family/children/:id/classes',auth(['parent']),api(async(req,res)=>{
    const studentId=await authorizeChild(req,res);if(!studentId)return;
    const [rows]=await db.execute(`SELECT b.id,b.starts_at,b.ends_at,b.status,c.title course_title,
      t.name tutor_name,a.student_attended,a.tutor_attended
      FROM booking_requests b JOIN courses c ON c.id=b.course_id JOIN users t ON t.id=b.tutor_id
      LEFT JOIN attendance a ON a.booking_id=b.id
      WHERE b.student_id=? ORDER BY b.starts_at DESC LIMIT 100`,[studentId]);
    // No Meet link, private tutor chat, payment data, or tutor verification documents are returned.
    res.setHeader('Cache-Control','private, no-store').json(rows);
  }));
  app.delete('/api/family/children/:id',auth(['parent']),api(async(req,res)=>{
    const id=await authorizeChild(req,res);if(!id)return;
    await db.execute('DELETE FROM guardians WHERE guardian_id=? AND student_id=?',[req.user.sub,id]);
    await db.execute('INSERT INTO audit_logs(actor_id,action,target_id) VALUES(?,?,?)',
      [req.user.sub,'parent_disconnected',id]);
    res.json({unlinked:true});
  }));
}
