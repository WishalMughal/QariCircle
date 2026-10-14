import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { z } from 'zod';
import { canTransition, gradeTutor, isoUtc } from './rules.js';

const languages = z.array(z.string().regex(/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})?$/)).min(1).max(8)
  .refine(v => new Set(v).size === v.length, 'Duplicate languages');
const courseIds = z.array(z.number().int().positive()).min(1).max(20)
  .refine(v => new Set(v).size === v.length, 'Duplicate course IDs');
const profileSchema = z.object({
  bio: z.string().trim().min(30).max(3000), teaching_experience_years: z.number().int().min(0).max(80),
  hourly_rate: z.number().min(0).max(99999), currency: z.string().regex(/^[A-Za-z]{3}$/),
  languages, course_ids: courseIds
});
const scoreSchema = z.object({
  recitation_score:z.number().int().min(0).max(30), tajweed_score:z.number().int().min(0).max(25),
  subject_score:z.number().int().min(0).max(20), demo_score:z.number().int().min(0).max(15),
  communication_score:z.number().int().min(0).max(10), notes:z.string().max(3000).optional()
});
const positiveId = (v)=>Number.isSafeInteger(Number(v)) && Number(v)>0?Number(v):null;
const fileMagic = (bytes) => {
  if(bytes.subarray(0,5).toString()==='%PDF-')return {type:'application/pdf',ext:'.pdf'};
  if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return {type:'image/png',ext:'.png'};
  if(bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff)return {type:'image/jpeg',ext:'.jpg'};
  return null;
};
const fileLocation = path.resolve(process.env.PRIVATE_UPLOAD_DIR||'./private_uploads');
fs.mkdirSync(fileLocation,{recursive:true,mode:0o700});
const uploader = multer({
  storage:multer.diskStorage({destination:(_req,_file,cb)=>cb(null,fileLocation),filename:(_req,_file,cb)=>cb(null,randomUUID())}),
  limits:{fileSize:5*1024*1024,files:1,fields:1},
  fileFilter:(_req,file,cb)=>cb(null,['image/jpeg','image/png','application/pdf'].includes(file.mimetype))
});

export function registerPhase2(app,{db,auth,api,fail}) {
  app.get('/api/tutor/profile',auth(['tutor']),api(async(req,res)=>{
    const [[profiles],[lang],[courses],[docs]] = await Promise.all([
      db.execute('SELECT bio,teaching_experience_years,hourly_rate,currency,approval_status,verification_notes FROM tutor_profiles WHERE user_id=?',[req.user.sub]),
      db.execute('SELECT language_code FROM tutor_languages WHERE tutor_id=? ORDER BY language_code',[req.user.sub]),
      db.execute('SELECT course_id,approved FROM tutor_courses WHERE tutor_id=? ORDER BY course_id',[req.user.sub]),
      db.execute('SELECT id,document_type,status,uploaded_at FROM tutor_documents WHERE tutor_id=? ORDER BY id DESC',[req.user.sub])
    ]);
    if(!profiles.length)return fail(res,404,'Tutor profile not found');
    res.json({...profiles[0],languages:lang.map(x=>x.language_code),courses,documents:docs});
  }));

  app.put('/api/tutor/profile',auth(['tutor']),api(async(req,res)=>{
    const p = profileSchema.parse(req.body);
    const cx=await db.getConnection();
    try{
      await cx.beginTransaction();
      const [[t]]=await cx.execute('SELECT approval_status FROM tutor_profiles WHERE user_id=? FOR UPDATE',[req.user.sub]);
      if(!t || !['draft','rejected'].includes(t.approval_status)){await cx.rollback();return fail(res,409,'Profile editing is allowed only in draft or rejected state');}
      const [found]=await cx.query(`SELECT id FROM courses WHERE is_active=1 AND id IN (${p.course_ids.map(()=>'?').join(',')})`,p.course_ids);
      if(found.length!==p.course_ids.length){await cx.rollback();return fail(res,400,'Invalid or inactive course');}
      await cx.execute("UPDATE tutor_profiles SET bio=?,teaching_experience_years=?,hourly_rate=?,currency=?,approval_status='draft',verification_notes=NULL WHERE user_id=?",[p.bio,p.teaching_experience_years,p.hourly_rate,p.currency.toUpperCase(),req.user.sub]);
      await cx.execute('DELETE FROM tutor_languages WHERE tutor_id=?',[req.user.sub]);
      for(const lang of p.languages)await cx.execute('INSERT INTO tutor_languages(tutor_id,language_code) VALUES(?,?)',[req.user.sub,lang]);
      await cx.execute('DELETE FROM tutor_courses WHERE tutor_id=?',[req.user.sub]);
      for(const course of p.course_ids)await cx.execute('INSERT INTO tutor_courses(tutor_id,course_id,approved) VALUES(?,?,0)',[req.user.sub,course]);
      await cx.commit();res.json({status:'draft',message:'Profile saved. Upload a certificate then submit.'});
    }catch(e){await cx.rollback();throw e;}finally{cx.release();}
  }));

  app.post('/api/tutor/documents',auth(['tutor']),uploader.single('file'),api(async(req,res)=>{
    if(!req.file)return fail(res,400,'PDF, PNG or JPEG document required');
    try{
      const p=z.object({document_type:z.enum(['identity','qualification','tajweed_certificate','hifz_certificate'])}).parse(req.body);
      const fd=fs.openSync(req.file.path,'r');const bytes=Buffer.alloc(8);
      try{fs.readSync(fd,bytes,0,8,0);}finally{fs.closeSync(fd);}
      const type=fileMagic(bytes);
      if(!type || type.type!==req.file.mimetype)return fail(res,400,'Invalid document signature');
      const [[t]]=await db.execute('SELECT approval_status FROM tutor_profiles WHERE user_id=?',[req.user.sub]);
      if(!t||!['draft','rejected'].includes(t.approval_status))return fail(res,409,'Documents may only be uploaded in draft state');
      const [r]=await db.execute('INSERT INTO tutor_documents(tutor_id,document_type,private_storage_key) VALUES(?,?,?)',[req.user.sub,p.document_type,req.file.filename]);
      res.status(201).json({id:r.insertId,type:p.document_type,status:'pending'});return;
    } finally { // A stored DB reference owns the file; otherwise remove it.
      // Kept files are identified by their DB key, not a public URL.
      const [rows]=await db.execute('SELECT id FROM tutor_documents WHERE private_storage_key=? LIMIT 1',[req.file.filename]);
      if(!rows.length)fs.promises.unlink(req.file.path).catch(()=>{});
    }
  }));

  app.post('/api/tutor/submit',auth(['tutor']),api(async(req,res)=>{
    const cx=await db.getConnection();
    try{
      await cx.beginTransaction();
      const [[t]]=await cx.execute('SELECT bio,approval_status FROM tutor_profiles WHERE user_id=? FOR UPDATE',[req.user.sub]);
      if(!t || !['draft','rejected'].includes(t.approval_status)){await cx.rollback();return fail(res,409,'Profile cannot be submitted in this state');}
      const [[counts]]=await cx.execute(`SELECT
        (SELECT COUNT(*) FROM tutor_languages WHERE tutor_id=?) AS languages_count,
        (SELECT COUNT(*) FROM tutor_courses WHERE tutor_id=?) AS courses_count,
        (SELECT COUNT(*) FROM tutor_documents WHERE tutor_id=?) AS documents_count`,[req.user.sub,req.user.sub,req.user.sub]);
      if(!t.bio || counts.languages_count<1 || counts.courses_count<1 || counts.documents_count<1){await cx.rollback();return fail(res,400,'Complete profile, languages, courses and at least one document');}
      await cx.execute("UPDATE tutor_profiles SET approval_status='pending_review' WHERE user_id=?",[req.user.sub]);
      await cx.commit();res.json({status:'pending_review'});
    }catch(e){await cx.rollback();throw e;}finally{cx.release();}
  }));

  app.get('/api/admin/tutors',auth(['admin']),api(async(req,res)=>{
    const status=typeof req.query.status==='string'?req.query.status:'';
    const allowed=['pending_review','documents_approved','test_scheduled','passed','retest','rejected','active','suspended'];
    if(status&&!allowed.includes(status))return fail(res,400,'Invalid status filter');
    const sql=`SELECT u.id,u.name,u.email,u.country,t.approval_status,t.teaching_experience_years,
      (SELECT COUNT(*) FROM tutor_documents d WHERE d.tutor_id=u.id) documents_count,
      (SELECT COUNT(*) FROM tutor_courses c WHERE c.tutor_id=u.id AND c.approved=1) approved_courses
      FROM tutor_profiles t JOIN users u ON u.id=t.user_id ${status?'WHERE t.approval_status=?':''} ORDER BY u.id DESC LIMIT 100`;
    const [rows]=await db.execute(sql,status?[status]:[]);res.json(rows);
  }));
  app.get('/api/admin/tutors/:id',auth(['admin']),api(async(req,res)=>{
    const id=positiveId(req.params.id);if(!id)return fail(res,400,'Invalid tutor ID');
    const [[profiles],[docs],[courses],[langs],[tests]]=await Promise.all([
      db.execute('SELECT u.id,u.name,u.email,t.* FROM tutor_profiles t JOIN users u ON u.id=t.user_id WHERE u.id=?',[id]),
      db.execute('SELECT id,document_type,status,uploaded_at FROM tutor_documents WHERE tutor_id=? ORDER BY id',[id]),
      db.execute('SELECT c.id,c.title,t.approved FROM tutor_courses t JOIN courses c ON c.id=t.course_id WHERE t.tutor_id=?',[id]),
      db.execute('SELECT language_code FROM tutor_languages WHERE tutor_id=?',[id]),
      db.execute('SELECT id,examiner_id,test_at,result,notes FROM tutor_tests WHERE tutor_id=? ORDER BY id DESC',[id])
    ]);
    if(!profiles.length)return fail(res,404,'Tutor not found');
    res.json({...profiles[0],documents:docs,courses,languages:langs,tests});
  }));
  app.get('/api/admin/examiners',auth(['admin']),api(async(_req,res)=>{
    const [rows]=await db.execute("SELECT id,name,email FROM users WHERE role='examiner' AND is_active=1 ORDER BY name LIMIT 100");res.json(rows);
  }));
  app.patch('/api/admin/documents/:id/review',auth(['admin']),api(async(req,res)=>{
    const id=positiveId(req.params.id);if(!id)return fail(res,400,'Invalid document ID');
    const p=z.object({status:z.enum(['approved','rejected'])}).parse(req.body);
    const [r]=await db.execute(`UPDATE tutor_documents d JOIN tutor_profiles t ON t.user_id=d.tutor_id SET d.status=?
      WHERE d.id=? AND t.approval_status='pending_review'`,[p.status,id]);
    if(!r.affectedRows)return fail(res,409,'Document not reviewable');
    res.json({status:p.status});
  }));
  app.get('/api/documents/:id/download',auth(['admin','tutor']),api(async(req,res)=>{
    const id=positiveId(req.params.id);if(!id)return fail(res,400,'Invalid document ID');
    const [rows]=await db.execute('SELECT tutor_id,document_type,private_storage_key FROM tutor_documents WHERE id=?',[id]);
    if(!rows.length)return fail(res,404,'File not found');
    const d=rows[0];if(req.user.role==='tutor'&&String(d.tutor_id)!==String(req.user.sub))return fail(res,403,'Forbidden');
    const safe=path.basename(d.private_storage_key);
    if(safe!==d.private_storage_key)return fail(res,404,'File unavailable');
    const fullPath=path.join(fileLocation,safe);
    if(!fs.existsSync(fullPath))return fail(res,404,'File unavailable');
    const fd=fs.openSync(fullPath,'r');const bytes=Buffer.alloc(8);
    try{fs.readSync(fd,bytes,0,8,0);}finally{fs.closeSync(fd);}
    const type=fileMagic(bytes);if(!type)return fail(res,422,'Unrecognized file');
    res.setHeader('Content-Type',type.type);res.setHeader('Content-Disposition',`attachment; filename="${d.document_type}${type.ext}"`);
    res.setHeader('Cache-Control','no-store');res.sendFile(fullPath);
  }));

  app.post('/api/admin/tutors/:id/review',auth(['admin']),api(async(req,res)=>{
    const id=positiveId(req.params.id);if(!id)return fail(res,400,'Invalid tutor ID');
    const p=z.object({decision:z.enum(['approve_documents','reject','suspend','resume']),notes:z.string().max(1500).optional()}).parse(req.body);
    const next={approve_documents:'documents_approved',reject:'rejected',suspend:'suspended',resume:'active'}[p.decision];
    const cx=await db.getConnection();
    try{
      await cx.beginTransaction();const [[t]]=await cx.execute('SELECT approval_status FROM tutor_profiles WHERE user_id=? FOR UPDATE',[id]);
      if(!t||!canTransition(t.approval_status,next) ||(next==='rejected'&& !['pending_review','documents_approved','test_scheduled','passed','retest'].includes(t.approval_status))){await cx.rollback();return fail(res,409,'Invalid tutor status transition');}
      if(next==='documents_approved'){
        const [[a]]=await cx.execute("SELECT SUM(status='approved') approved, SUM(status='pending') pending FROM tutor_documents WHERE tutor_id=?",[id]);
        if(!a.approved || a.pending){await cx.rollback();return fail(res,400,'At least one approved document and no pending documents required');}
      }
      if(next==='active'){
        const [[test]]=await cx.execute("SELECT COUNT(*) total FROM tutor_tests WHERE tutor_id=? AND result='passed'",[id]);
        if(!test.total){await cx.rollback();return fail(res,409,'Tutor has not passed a verified exam');}
      }
      await cx.execute('UPDATE tutor_profiles SET approval_status=?,verification_notes=? WHERE user_id=?',[next,p.notes||null,id]);
      await cx.execute('INSERT INTO audit_logs(actor_id,action,target_id) VALUES(?,?,?)',[req.user.sub,`tutor_${next}`,id]);
      await cx.commit();res.json({status:next});
    }catch(e){await cx.rollback();throw e;}finally{cx.release();}
  }));
  app.patch('/api/admin/tutors/:id/courses/:courseId',auth(['admin']),api(async(req,res)=>{
    const tutorId=positiveId(req.params.id),courseId=positiveId(req.params.courseId);
    if(!tutorId||!courseId)return fail(res,400,'Invalid IDs');
    const p=z.object({approved:z.boolean()}).parse(req.body);
    const [r]=await db.execute(`UPDATE tutor_courses tc JOIN tutor_profiles tp ON tp.user_id=tc.tutor_id SET tc.approved=?
      WHERE tc.tutor_id=? AND tc.course_id=? AND tp.approval_status IN ('documents_approved','test_scheduled','passed','active','suspended','retest')`,[p.approved,tutorId,courseId]);
    if(!r.affectedRows)return fail(res,409,'Course not reviewable');res.json({approved:p.approved});
  }));
  app.post('/api/admin/tutors/:id/tests',auth(['admin']),api(async(req,res)=>{
    const id=positiveId(req.params.id);if(!id)return fail(res,400,'Invalid tutor ID');
    const p=z.object({examiner_id:z.number().int().positive(),test_at:z.string()}).parse(req.body);
    const start=isoUtc(p.test_at);if(!start||new Date(p.test_at)<=new Date())return fail(res,400,'Provide a future ISO date');
    const cx=await db.getConnection();
    try{
      await cx.beginTransaction();
      const [[t]]=await cx.execute('SELECT approval_status FROM tutor_profiles WHERE user_id=? FOR UPDATE',[id]);
      if(!t||!canTransition(t.approval_status,'test_scheduled')){await cx.rollback();return fail(res,409,'Tutor must pass document review first');}
      const [[examiner]]=await cx.execute("SELECT id FROM users WHERE id=? AND role='examiner' AND is_active=1",[p.examiner_id]);
      if(!examiner){await cx.rollback();return fail(res,400,'Examiner account not found');}
      const [r]=await cx.execute('INSERT INTO tutor_tests(tutor_id,examiner_id,test_at) VALUES(?,?,?)',[id,p.examiner_id,start]);
      await cx.execute("UPDATE tutor_profiles SET approval_status='test_scheduled' WHERE user_id=?",[id]);
      await cx.execute('INSERT INTO audit_logs(actor_id,action,target_id) VALUES(?,?,?)',[req.user.sub,'tutor_test_scheduled',id]);
      await cx.commit();res.status(201).json({id:r.insertId,status:'test_scheduled'});
    }catch(e){await cx.rollback();throw e;}finally{cx.release();}
  }));
  app.get('/api/examiner/tests',auth(['examiner']),api(async(req,res)=>{
    const [rows]=await db.execute(`SELECT tt.id,tt.tutor_id,u.name tutor_name,tt.test_at,tt.result
      FROM tutor_tests tt JOIN users u ON u.id=tt.tutor_id WHERE tt.examiner_id=? ORDER BY tt.test_at DESC LIMIT 100`,[req.user.sub]);
    res.json(rows);
  }));
  app.patch('/api/examiner/tests/:id/result',auth(['examiner']),api(async(req,res)=>{
    const id=positiveId(req.params.id);if(!id)return fail(res,400,'Invalid test ID');
    const p=scoreSchema.parse(req.body);const grade=gradeTutor(p);
    const cx=await db.getConnection();
    try{
      await cx.beginTransaction();
      const [[test]]=await cx.execute('SELECT tutor_id,result,examiner_id FROM tutor_tests WHERE id=? FOR UPDATE',[id]);
      if(!test||String(test.examiner_id)!==String(req.user.sub)||test.result!=='scheduled'){await cx.rollback();return fail(res,409,'Test not available for grading');}
      const [[t]]=await cx.execute('SELECT approval_status FROM tutor_profiles WHERE user_id=? FOR UPDATE',[test.tutor_id]);
      if(!t||!canTransition(t.approval_status,grade.result)){await cx.rollback();return fail(res,409,'Tutor status changed');}
      await cx.execute(`UPDATE tutor_tests SET recitation_score=?,tajweed_score=?,subject_score=?,demo_score=?,communication_score=?,result=?,notes=? WHERE id=?`,[p.recitation_score,p.tajweed_score,p.subject_score,p.demo_score,p.communication_score,grade.result,p.notes||null,id]);
      await cx.execute('UPDATE tutor_profiles SET approval_status=? WHERE user_id=?',[grade.result,test.tutor_id]);
      await cx.execute('INSERT INTO audit_logs(actor_id,action,target_id,details) VALUES(?,?,?,?)',[req.user.sub,'tutor_test_graded',test.tutor_id,JSON.stringify({test_id:id,total:grade.total,result:grade.result})]);
      await cx.commit();res.json({total:grade.total,result:grade.result});
    }catch(e){await cx.rollback();throw e;}finally{cx.release();}
  }));
  app.post('/api/admin/tutors/:id/activate',auth(['admin']),api(async(req,res)=>{
    const id=positiveId(req.params.id);if(!id)return fail(res,400,'Invalid tutor ID');
    const cx=await db.getConnection();try{
      await cx.beginTransaction();
      const [[t]]=await cx.execute('SELECT approval_status FROM tutor_profiles WHERE user_id=? FOR UPDATE',[id]);
      if(!t||!canTransition(t.approval_status,'active')){await cx.rollback();return fail(res,409,'Tutor has not passed the exam');}
      const [[c]]=await cx.execute('SELECT COUNT(*) count FROM tutor_courses WHERE tutor_id=? AND approved=1',[id]);
      const [[ex]]=await cx.execute("SELECT COUNT(*) count FROM tutor_tests WHERE tutor_id=? AND result='passed'",[id]);
      if(!c.count||!ex.count){await cx.rollback();return fail(res,409,'An approved course and a passed exam are required');}
      await cx.execute("UPDATE tutor_profiles SET approval_status='active' WHERE user_id=?",[id]);
      await cx.execute('INSERT INTO audit_logs(actor_id,action,target_id) VALUES(?,?,?)',[req.user.sub,'tutor_active',id]);
      await cx.commit();res.json({status:'active'});
    }catch(e){await cx.rollback();throw e;}finally{cx.release();}
  }));
  app.get('/api/dashboard',auth(),api(async(req,res)=>{
    const id=req.user.sub,role=req.user.role;
    if(role==='tutor'){
      const [[profile],[counts],[classes]]=await Promise.all([
        db.execute('SELECT approval_status,verification_notes FROM tutor_profiles WHERE user_id=?',[id]),
        db.execute(`SELECT COUNT(*) AS total, SUM(status='requested') AS requested, SUM(status='confirmed') AS confirmed FROM booking_requests WHERE tutor_id=?`,[id]),
        db.execute('SELECT id,student_id,course_id,starts_at,status FROM booking_requests WHERE tutor_id=? ORDER BY starts_at DESC LIMIT 5',[id])
      ]);return res.json({role,profile:profile[0],counts:counts[0],upcoming:classes});
    }
    if(role==='student'){
      const [[profile],[counts],[classes]]=await Promise.all([
        db.execute('SELECT level,preferred_language,is_minor FROM student_profiles WHERE user_id=?',[id]),
        db.execute(`SELECT COUNT(*) total,SUM(status='confirmed') confirmed FROM booking_requests WHERE student_id=?`,[id]),
        db.execute('SELECT id,tutor_id,course_id,starts_at,status FROM booking_requests WHERE student_id=? ORDER BY starts_at DESC LIMIT 5',[id])
      ]);return res.json({role,profile:profile[0],counts:counts[0],upcoming:classes});
    }
    if(role==='parent'){
      const [[r]]=await db.execute('SELECT COUNT(*) children FROM guardians WHERE guardian_id=?',[id]);
      return res.json({role,counts:r});
    }
    if(role==='examiner'){
      const [[r]]=await db.execute("SELECT COUNT(*) total,SUM(result='scheduled') scheduled FROM tutor_tests WHERE examiner_id=?",[id]);
      return res.json({role,counts:r});
    }
    const [[r]]=await db.execute(`SELECT
      (SELECT COUNT(*) FROM users WHERE role='student') students,
      (SELECT COUNT(*) FROM tutor_profiles WHERE approval_status='active') active_tutors,
      (SELECT COUNT(*) FROM tutor_profiles WHERE approval_status='pending_review') pending_tutors,
      (SELECT COUNT(*) FROM booking_requests) bookings`);
    res.json({role,counts:r});
  }));
}
