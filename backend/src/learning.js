import {z} from 'zod';
import {positiveId,normalizeHifzRange,validIsoDay,canReadEnrollment,canManageEnrollment,percent} from './learning_rules.js';

const ident = z.number().int().positive();
const short = z.string().trim().min(2).max(180);
const details = z.string().trim().max(5000);
const unitTypes=['qaida','nazra','hifz','tajweed','uloom','general'];
const attendanceBody=z.object({student_attended:z.boolean(),tutor_attended:z.boolean(),teacher_notes:z.string().trim().max(2000).default('')});
const assignmentBody=z.object({title:short,instructions:z.string().trim().min(2).max(5000),due_at:z.string().datetime({offset:true}).nullable().optional()});
const isoSql=(raw)=>new Date(raw).toISOString().slice(0,19).replace('T',' ');
const error=(res,code,message)=>res.status(code).json({error:message});

export function registerLearning(app,{db,auth,api}) {
  async function loadEnrollment(id){
    if(!positiveId(id))return null;
    const [[e]]=await db.execute(`SELECT e.id,e.student_id,e.tutor_id,e.course_id,e.status,c.title AS course_title,
      s.name AS student_name,t.name AS tutor_name,c.slug AS course_slug
      FROM enrollments e JOIN courses c ON c.id=e.course_id JOIN users s ON s.id=e.student_id
      JOIN users t ON t.id=e.tutor_id WHERE e.id=?`,[id]);
    return e||null;
  }
  async function member(req,res,id,manage=false){
    const e=await loadEnrollment(id);
    if(!e){error(res,404,'Enrollment not found');return null;}
    if(!(manage?canManageEnrollment(req.user,e):canReadEnrollment(req.user,e))){error(res,403,'Not allowed for this enrollment');return null;}
    return e;
  }
  const askId=(req,res,key='id')=>{
    const id=positiveId(req.params[key]);
    if(!id)error(res,400,`Invalid ${key}`);
    return id;
  };

  // Public, published curriculum; admin may view drafts. Curriculum text is academy-owned metadata.
  app.get('/api/learning/courses/:id/units',api(async(req,res)=>{
    const course=askId(req,res);if(!course)return;
    const [rows]=await db.execute(`SELECT id,course_id,title,unit_type,sort_order,learning_objectives
      FROM curriculum_units WHERE course_id=? AND is_published=1 ORDER BY sort_order,id LIMIT 500`,[course]);
    res.json(rows);
  }));
  app.get('/api/admin/learning/courses/:id/units',auth(['admin']),api(async(req,res)=>{
    const course=askId(req,res);if(!course)return;
    const [rows]=await db.execute('SELECT * FROM curriculum_units WHERE course_id=? ORDER BY sort_order,id LIMIT 500',[course]);res.json(rows);
  }));
  app.post('/api/admin/learning/courses/:id/units',auth(['admin']),api(async(req,res)=>{
    const course=askId(req,res);if(!course)return;
    const p=z.object({title:short,unit_type:z.enum(unitTypes),sort_order:z.number().int().min(0).max(100000),learning_objectives:details,is_published:z.boolean().default(false)}).parse(req.body);
    const [[active]]=await db.execute('SELECT id FROM courses WHERE id=? AND is_active=1',[course]);
    if(!active)return error(res,404,'Course unavailable');
    const [r]=await db.execute('INSERT INTO curriculum_units(course_id,title,unit_type,sort_order,learning_objectives,is_published) VALUES(?,?,?,?,?,?)',
      [course,p.title,p.unit_type,p.sort_order,p.learning_objectives,p.is_published]);
    res.status(201).json({id:r.insertId,...p});
  }));
  app.patch('/api/admin/learning/units/:id',auth(['admin']),api(async(req,res)=>{
    const id=askId(req,res);if(!id)return;
    const p=z.object({title:short.optional(),sort_order:z.number().int().min(0).max(100000).optional(),
      learning_objectives:details.optional(),is_published:z.boolean().optional()}).strict().parse(req.body);
    const entries=Object.entries(p);if(!entries.length)return error(res,400,'No fields supplied');
    const [r]=await db.execute(`UPDATE curriculum_units SET ${entries.map(([k])=>`${k}=?`).join(',')} WHERE id=?`,[...entries.map(([,v])=>v),id]);
    if(!r.affectedRows)return error(res,404,'Unit not found');res.json({updated:true});
  }));

  app.get('/api/learning/enrollments',auth(['student','tutor','admin']),api(async(req,res)=>{
    let condition='';let args=[];
    if(req.user.role==='student'){condition=' WHERE e.student_id=?';args=[req.user.sub];}
    if(req.user.role==='tutor'){condition=' WHERE e.tutor_id=?';args=[req.user.sub];}
    const [rows]=await db.execute(`SELECT e.id,e.student_id,e.tutor_id,e.course_id,e.status,
      st.name AS student_name,tu.name AS tutor_name,c.title AS course_title,c.slug AS course_slug
      FROM enrollments e JOIN users st ON st.id=e.student_id JOIN users tu ON tu.id=e.tutor_id
      JOIN courses c ON c.id=e.course_id ${condition} ORDER BY e.id DESC LIMIT 200`,args);
    res.json(rows);
  }));
  app.post('/api/learning/enrollments',auth(['tutor']),api(async(req,res)=>{
    const p=z.object({booking_id:ident}).parse(req.body);
    const cx=await db.getConnection();
    try{
      await cx.beginTransaction();
      const [[t]]=await cx.execute("SELECT approval_status FROM tutor_profiles WHERE user_id=? FOR UPDATE",[req.user.sub]);
      if(!t||t.approval_status!=='active'){await cx.rollback();return error(res,403,'Verified active tutor required');}
      const [[b]]=await cx.execute(`SELECT student_id,tutor_id,course_id,status FROM booking_requests
        WHERE id=? AND tutor_id=? AND status IN ('confirmed','completed') FOR UPDATE`,[p.booking_id,req.user.sub]);
      if(!b){await cx.rollback();return error(res,404,'A confirmed class booking is required');}
      const [[approved]]=await cx.execute('SELECT course_id FROM tutor_courses WHERE tutor_id=? AND course_id=? AND approved=1',[req.user.sub,b.course_id]);
      if(!approved){await cx.rollback();return error(res,403,'Course is not approved for tutor');}
      await cx.execute(`INSERT INTO enrollments(student_id,tutor_id,course_id,status) VALUES(?,?,?,'active')
        ON DUPLICATE KEY UPDATE status=IF(status='paused','active',status)`,[b.student_id,b.tutor_id,b.course_id]);
      const [[e]]=await cx.execute('SELECT id,status FROM enrollments WHERE student_id=? AND tutor_id=? AND course_id=?',
        [b.student_id,b.tutor_id,b.course_id]);
      await cx.commit();res.status(201).json({id:e.id,status:e.status});
    }catch(err){await cx.rollback();throw err;}finally{cx.release();}
  }));
  app.get('/api/learning/enrollments/:id',auth(['student','tutor','admin']),api(async(req,res)=>{
    const e=await member(req,res,req.params.id);if(e)res.json(e);
  }));

  app.get('/api/learning/enrollments/:id/progress',auth(['student','tutor','admin']),api(async(req,res)=>{
    const e=await member(req,res,req.params.id);if(!e)return;
    const [rows]=await db.execute(`SELECT u.id AS unit_id,u.title,u.unit_type,u.sort_order,
      COALESCE(p.status,'not_started') AS status,p.score,p.tutor_notes,p.updated_at
      FROM curriculum_units u LEFT JOIN lesson_progress p ON p.unit_id=u.id AND p.enrollment_id=?
      WHERE u.course_id=? AND u.is_published=1 ORDER BY u.sort_order,u.id LIMIT 500`,[e.id,e.course_id]);
    res.json(rows);
  }));
  app.put('/api/learning/enrollments/:id/progress/:unitId',auth(['tutor']),api(async(req,res)=>{
    const e=await member(req,res,req.params.id,true);if(!e)return;
    const unit=askId(req,res,'unitId');if(!unit)return;
    const p=z.object({status:z.enum(['not_started','in_progress','completed','needs_revision']),score:z.number().int().min(0).max(100).nullable(),tutor_notes:z.string().trim().max(3000).default('')}).parse(req.body);
    const [[u]]=await db.execute('SELECT id FROM curriculum_units WHERE id=? AND course_id=? AND is_published=1',[unit,e.course_id]);
    if(!u)return error(res,404,'Unit not in this course');
    await db.execute(`INSERT INTO lesson_progress(enrollment_id,unit_id,status,score,tutor_notes) VALUES(?,?,?,?,?)
      ON DUPLICATE KEY UPDATE status=VALUES(status),score=VALUES(score),tutor_notes=VALUES(tutor_notes),updated_at=CURRENT_TIMESTAMP`,
      [e.id,unit,p.status,p.score,p.tutor_notes]);res.json({saved:true});
  }));

  app.get('/api/learning/enrollments/:id/assignments',auth(['student','tutor','admin']),api(async(req,res)=>{
    const e=await member(req,res,req.params.id);if(!e)return;
    const [rows]=await db.execute(`SELECT a.id,a.title,a.instructions,a.due_at,a.status,
      s.submission_text,s.submitted_at,s.teacher_feedback,s.grade,s.reviewed_at
      FROM assignments a LEFT JOIN assignment_submissions s ON s.assignment_id=a.id
      WHERE a.enrollment_id=? ORDER BY a.id DESC LIMIT 200`,[e.id]);res.json(rows);
  }));
  app.post('/api/learning/enrollments/:id/assignments',auth(['tutor']),api(async(req,res)=>{
    const e=await member(req,res,req.params.id,true);if(!e)return;
    const p=assignmentBody.parse(req.body);
    const due=p.due_at?isoSql(p.due_at):null;
    if(due&&new Date(p.due_at)<new Date())return error(res,400,'Due time must be in the future');
    const [r]=await db.execute('INSERT INTO assignments(enrollment_id,title,instructions,due_at) VALUES(?,?,?,?)',[e.id,p.title,p.instructions,due]);
    res.status(201).json({id:r.insertId,status:'assigned'});
  }));
  app.post('/api/learning/assignments/:id/submit',auth(['student']),api(async(req,res)=>{
    const id=askId(req,res);if(!id)return;
    const p=z.object({submission_text:z.string().trim().min(2).max(10000)}).parse(req.body);
    const cx=await db.getConnection();
    try{
      await cx.beginTransaction();
      const [[a]]=await cx.execute(`SELECT a.id,a.status,e.student_id,e.status AS enrollment_status
        FROM assignments a JOIN enrollments e ON e.id=a.enrollment_id WHERE a.id=? FOR UPDATE`,[id]);
      if(!a){await cx.rollback();return error(res,404,'Assignment not found');}
      if(String(a.student_id)!==req.user.sub){await cx.rollback();return error(res,403,'Not your assignment');}
      if(a.enrollment_status!=='active'||a.status==='reviewed'){await cx.rollback();return error(res,409,'Cannot submit at this stage');}
      await cx.execute(`INSERT INTO assignment_submissions(assignment_id,submission_text) VALUES(?,?)
        ON DUPLICATE KEY UPDATE submission_text=VALUES(submission_text),submitted_at=CURRENT_TIMESTAMP,teacher_feedback=NULL,grade=NULL,reviewed_at=NULL`,[id,p.submission_text]);
      await cx.execute("UPDATE assignments SET status='submitted' WHERE id=?",[id]);await cx.commit();res.json({status:'submitted'});
    }catch(err){await cx.rollback();throw err;}finally{cx.release();}
  }));
  app.patch('/api/learning/assignments/:id/review',auth(['tutor']),api(async(req,res)=>{
    const id=askId(req,res);if(!id)return;
    const p=z.object({teacher_feedback:z.string().trim().min(2).max(5000),grade:z.number().int().min(0).max(100)}).parse(req.body);
    const cx=await db.getConnection();
    try{
      await cx.beginTransaction();
      const [[a]]=await cx.execute(`SELECT a.status,e.tutor_id,e.status enrollment_status FROM assignments a
        JOIN enrollments e ON e.id=a.enrollment_id WHERE a.id=? FOR UPDATE`,[id]);
      if(!a){await cx.rollback();return error(res,404,'Assignment not found');}
      if(String(a.tutor_id)!==req.user.sub||a.enrollment_status!=='active'){await cx.rollback();return error(res,403,'Not your active student');}
      if(a.status!=='submitted'){await cx.rollback();return error(res,409,'Assignment must be submitted first');}
      await cx.execute('UPDATE assignment_submissions SET teacher_feedback=?,grade=?,reviewed_at=UTC_TIMESTAMP() WHERE assignment_id=?',[p.teacher_feedback,p.grade,id]);
      await cx.execute("UPDATE assignments SET status='reviewed' WHERE id=?",[id]);await cx.commit();res.json({status:'reviewed'});
    }catch(err){await cx.rollback();throw err;}finally{cx.release();}
  }));

  app.get('/api/learning/enrollments/:id/hifz',auth(['student','tutor','admin']),api(async(req,res)=>{
    const e=await member(req,res,req.params.id);if(!e)return;
    const [rows]=await db.execute('SELECT id,log_date,category,from_surah,to_surah,mistakes,notes FROM hifz_logs WHERE enrollment_id=? ORDER BY log_date DESC,id DESC LIMIT 200',[e.id]);res.json(rows);
  }));
  app.post('/api/learning/enrollments/:id/hifz',auth(['tutor']),api(async(req,res)=>{
    const e=await member(req,res,req.params.id,true);if(!e)return;
    if(e.course_slug!=='hifz-ul-quran')return error(res,400,'Hifz logs require a Hifz enrollment');
    const p=z.object({log_date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),category:z.enum(['sabaq','sabqi','manzil']),
      from_surah:z.number().int(),to_surah:z.number().int(),mistakes:z.number().int(),notes:z.string().trim().max(3000).default('')}).parse(req.body);
    if(!normalizeHifzRange(p)||!validIsoDay(p.log_date)||p.log_date>new Date().toISOString().slice(0,10))
      return error(res,400,'Invalid Hifz date, Surah range or mistake count');
    const [r]=await db.execute(`INSERT INTO hifz_logs(enrollment_id,log_date,category,from_surah,to_surah,mistakes,notes)
      VALUES(?,?,?,?,?,?,?)`,[e.id,p.log_date,p.category,p.from_surah,p.to_surah,p.mistakes,p.notes]);
    res.status(201).json({id:r.insertId,category:p.category});
  }));

  app.patch('/api/learning/bookings/:id/attendance',auth(['tutor']),api(async(req,res)=>{
    const id=askId(req,res);if(!id)return;
    const p=attendanceBody.parse(req.body);
    const cx=await db.getConnection();
    try{
      await cx.beginTransaction();
      const [[b]]=await cx.execute('SELECT tutor_id,ends_at,status FROM booking_requests WHERE id=? FOR UPDATE',[id]);
      if(!b){await cx.rollback();return error(res,404,'Booking not found');}
      if(String(b.tutor_id)!==req.user.sub){await cx.rollback();return error(res,403,'Not your class');}
      if(b.status!=='confirmed'&&b.status!=='completed'){await cx.rollback();return error(res,409,'Only confirmed/completed class can be recorded');}
      const [[hasStarted]]=await cx.execute('SELECT (starts_at<=UTC_TIMESTAMP()) started,(ends_at<=UTC_TIMESTAMP()) ended FROM booking_requests WHERE id=?',[id]);
      if(!hasStarted.started){await cx.rollback();return error(res,409,'Class has not started');}
      await cx.execute(`INSERT INTO attendance(booking_id,student_attended,tutor_attended,teacher_notes) VALUES(?,?,?,?)
        ON DUPLICATE KEY UPDATE student_attended=VALUES(student_attended),tutor_attended=VALUES(tutor_attended),teacher_notes=VALUES(teacher_notes)`,
        [id,p.student_attended,p.tutor_attended,p.teacher_notes]);
      if(hasStarted.ended)await cx.execute("UPDATE booking_requests SET status='completed' WHERE id=? AND status='confirmed'",[id]);
      await cx.commit();res.json({saved:true,completed:Boolean(hasStarted.ended)});
    }catch(err){await cx.rollback();throw err;}finally{cx.release();}
  }));
  app.get('/api/learning/bookings/:id/attendance',auth(['student','tutor','admin']),api(async(req,res)=>{
    const id=askId(req,res);if(!id)return;
    const [[b]]=await db.execute(`SELECT b.student_id,b.tutor_id,b.status,a.student_attended,a.tutor_attended,a.teacher_notes
      FROM booking_requests b LEFT JOIN attendance a ON a.booking_id=b.id WHERE b.id=?`,[id]);
    if(!b)return error(res,404,'Class not found');
    if(req.user.role!=='admin'&&String(b.student_id)!==req.user.sub&&String(b.tutor_id)!==req.user.sub)return error(res,403,'Not your class');
    res.json(b);
  }));
  app.get('/api/learning/enrollments/:id/summary',auth(['student','tutor','admin']),api(async(req,res)=>{
    const e=await member(req,res,req.params.id);if(!e)return;
    const [[s]]=await db.execute(`SELECT
      (SELECT COUNT(*) FROM curriculum_units u WHERE u.course_id=? AND u.is_published=1) AS total_units,
      (SELECT COUNT(*) FROM lesson_progress p JOIN curriculum_units u ON u.id=p.unit_id WHERE p.enrollment_id=? AND u.is_published=1 AND p.status='completed') AS done_units,
      (SELECT COUNT(*) FROM assignments a WHERE a.enrollment_id=?) AS total_assignments,
      (SELECT COUNT(*) FROM assignments a WHERE a.enrollment_id=? AND a.status='reviewed') AS reviewed_assignments,
      (SELECT COUNT(*) FROM hifz_logs h WHERE h.enrollment_id=?) AS hifz_entries,
      (SELECT COUNT(*) FROM booking_requests b WHERE b.student_id=? AND b.tutor_id=? AND b.course_id=? AND b.status='completed') AS completed_classes`,
      [e.course_id,e.id,e.id,e.id,e.id,e.student_id,e.tutor_id,e.course_id]);
    res.json({...s,completion_percent:percent(Number(s.done_units),Number(s.total_units))});
  }));
}
