import { z } from 'zod';
import { asPositiveId } from './communication_rules.js';
import { notify } from './communication.js';
import { priceForBooking, splitInvoice, supportedCurrencies, minorInt, walletAmounts, invoiceCode } from './finance_rules.js';

const err=(res,status,message)=>res.status(status).json({error:message});
const checkedId=(res,value)=>{const v=asPositiveId(value);if(!v)err(res,400,'Invalid ID');return v;};
const idNumber=value=>String(value);
const claimSchema=z.object({
  method:z.enum(['bank_transfer','jazzcash','easypaisa','external']),
  external_reference:z.string().trim().min(5).max(120).regex(/^[a-zA-Z0-9\-_/. ]+$/),
  note:z.string().trim().max(500).default('')
});
const payoutSchema=z.object({
  amount_minor:z.number().int().positive().max(999999999),
  currency:z.enum(['PKR','USD','GBP','EUR','AED','SAR']),
  payout_method:z.enum(['bank_transfer','jazzcash','easypaisa','paypal','other']),
  payout_note:z.string().trim().max(200).default('')
});
const decisionSchema=z.object({decision:z.enum(['approve','reject']),note:z.string().trim().max(500).default('')});

async function inTransaction(db,callback){
  const cx=await db.getConnection();
  try{await cx.beginTransaction();const result=await callback(cx);await cx.commit();return result;}
  catch(e){await cx.rollback();throw e;}finally{cx.release();}
}
const denial=(status,message)=>({error:message,status});
async function walletBalance(cx,tutorId,currency){
  const [[earned]]=await cx.execute(`SELECT COALESCE(SUM(amount_minor),0) amount FROM finance_earnings
    WHERE tutor_id=? AND currency=?`,[tutorId,currency]);
  const [[reserved]]=await cx.execute(`SELECT COALESCE(SUM(amount_minor),0) amount FROM finance_payout_requests
    WHERE tutor_id=? AND currency=? AND status IN ('requested','approved','sent')`,[tutorId,currency]);
  return walletAmounts(earned.amount,reserved.amount);
}
const invoiceShape=(invoice)=>({...invoice,invoice_number:invoiceCode(invoice.id)});

export function registerFinance(app,{db,auth,api}){
  app.get('/api/finance/booking-quotes/:id',auth(['student','tutor','admin']),api(async(req,res)=>{
    const id=checkedId(res,req.params.id);if(!id)return;
    const [[q]]=await db.execute(`SELECT q.booking_id,q.amount_minor,q.currency,q.commission_bps,b.student_id,b.tutor_id
      FROM finance_booking_quotes q JOIN booking_requests b ON b.id=q.booking_id WHERE q.booking_id=?`,[id]);
    if(!q)return err(res,404,'No locked price for this booking');
    if(req.user.role!=='admin'&&![q.student_id,q.tutor_id].some(x=>idNumber(x)===req.user.sub))return err(res,403,'Not your booking');
    res.json({booking_id:q.booking_id,amount_minor:Number(q.amount_minor),currency:q.currency,free:Number(q.amount_minor)===0});
  }));

  app.post('/api/finance/invoices',auth(['student']),api(async(req,res)=>{
    const p=z.object({booking_id:z.number().int().positive()}).parse(req.body);
    const result=await inTransaction(db,async cx=>{
      const [[b]]=await cx.execute('SELECT id,student_id,tutor_id,status FROM booking_requests WHERE id=? FOR UPDATE',[p.booking_id]);
      if(!b)return denial(404,'Booking does not exist');
      if(idNumber(b.student_id)!==req.user.sub)return denial(403,'Not your booking');
      if(!['confirmed','completed'].includes(b.status))return denial(409,'Only confirmed classes can be invoiced');
      const [[quote]]=await cx.execute('SELECT amount_minor,currency,commission_bps FROM finance_booking_quotes WHERE booking_id=?',[b.id]);
      if(!quote)return denial(409,'Legacy booking has no price snapshot. Admin must reconcile this booking outside this flow.');
      if(Number(quote.amount_minor)<=0)return denial(409,'This lesson is free; no payment required');
      const [r]=await cx.execute(`INSERT INTO finance_invoices(booking_id,student_id,tutor_id,amount_minor,currency,commission_bps)
        VALUES(?,?,?,?,?,?) ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)`,
      [b.id,b.student_id,b.tutor_id,quote.amount_minor,quote.currency,quote.commission_bps]);
      const [[invoice]]=await cx.execute('SELECT * FROM finance_invoices WHERE id=?',[r.insertId]);
      return invoiceShape(invoice);
    });
    if(result.error)return err(res,result.status,result.error);
    res.status(200).json(result);
  }));

  app.get('/api/finance/invoices',auth(['student','admin']),api(async(req,res)=>{
    const sql=`SELECT i.id,i.booking_id,i.student_id,i.tutor_id,i.amount_minor,i.currency,i.status,
      i.paid_at,i.created_at,b.starts_at,b.ends_at,c.title course_title
      FROM finance_invoices i JOIN booking_requests b ON b.id=i.booking_id
      JOIN courses c ON c.id=b.course_id ${req.user.role==='student'?'WHERE i.student_id=?':''}
      ORDER BY i.id DESC LIMIT 200`;
    const [rows]=await db.execute(sql,req.user.role==='student'?[req.user.sub]:[]);
    res.json(rows.map(invoiceShape));
  }));

  app.get('/api/finance/invoices/:id',auth(['student','admin']),api(async(req,res)=>{
    const id=checkedId(res,req.params.id);if(!id)return;
    const [[invoice]]=await db.execute(`SELECT i.*,b.starts_at,b.ends_at,c.title course_title
      FROM finance_invoices i JOIN booking_requests b ON b.id=i.booking_id
      JOIN courses c ON c.id=b.course_id WHERE i.id=?`,[id]);
    if(!invoice)return err(res,404,'Invoice not found');
    if(req.user.role==='student'&&idNumber(invoice.student_id)!==req.user.sub)return err(res,403,'Invoice not yours');
    const [claims]=await db.execute(`SELECT id,method,external_reference,note,status,review_note,created_at,reviewed_at
      FROM finance_payment_claims WHERE invoice_id=? ORDER BY id DESC LIMIT 25`,[id]);
    res.set('Cache-Control','no-store').json({...invoiceShape(invoice),claims});
  }));

  app.post('/api/finance/invoices/:id/claims',auth(['student']),api(async(req,res)=>{
    const id=checkedId(res,req.params.id);if(!id)return;
    const p=claimSchema.parse(req.body);
    const result=await inTransaction(db,async cx=>{
      const [[i]]=await cx.execute('SELECT id,student_id,status FROM finance_invoices WHERE id=? FOR UPDATE',[id]);
      if(!i)return denial(404,'Invoice not found');
      if(idNumber(i.student_id)!==req.user.sub)return denial(403,'Invoice not yours');
      if(i.status!=='issued')return denial(409,'Invoice already submitted, paid or void');
      const [r]=await cx.execute(`INSERT INTO finance_payment_claims(invoice_id,student_id,method,external_reference,note)
        VALUES(?,?,?,?,?)`,[id,req.user.sub,p.method,p.external_reference,p.note]);
      await cx.execute("UPDATE finance_invoices SET status='under_review' WHERE id=?",[id]);
      return {id:r.insertId,status:'submitted',message:'Reference recorded. Payment is NOT confirmed until admin verifies funds.'};
    });
    if(result.error)return err(res,result.status,result.error);
    res.status(201).json(result);
  }));

  app.get('/api/finance/admin/claims',auth(['admin']),api(async(req,res)=>{
    const [rows]=await db.execute(`SELECT pc.id,pc.invoice_id,pc.method,pc.external_reference,pc.note,
      pc.status,pc.review_note,pc.created_at,i.amount_minor,i.currency,i.booking_id,
      u.name student_name,u.email student_email
      FROM finance_payment_claims pc JOIN finance_invoices i ON i.id=pc.invoice_id
      JOIN users u ON u.id=pc.student_id ORDER BY pc.id DESC LIMIT 200`);
    res.json(rows);
  }));

  app.patch('/api/finance/admin/claims/:id',auth(['admin']),api(async(req,res)=>{
    const id=checkedId(res,req.params.id);if(!id)return;
    const p=decisionSchema.parse(req.body);
    if(p.decision==='reject'&&p.note.length<5)return err(res,400,'Rejection reason required');
    const result=await inTransaction(db,async cx=>{
      const [[pre]]=await cx.execute('SELECT invoice_id FROM finance_payment_claims WHERE id=?',[id]);
      if(!pre)return denial(404,'Claim not found');
      const [[i]]=await cx.execute('SELECT id,status,student_id,booking_id FROM finance_invoices WHERE id=? FOR UPDATE',[pre.invoice_id]);
      const [[claim]]=await cx.execute('SELECT id,status FROM finance_payment_claims WHERE id=? FOR UPDATE',[id]);
      if(i.status!=='under_review'||claim.status!=='submitted')return denial(409,'Claim already resolved');
      const status=p.decision==='approve'?'approved':'rejected';
      await cx.execute(`UPDATE finance_payment_claims SET status=?,reviewer_id=?,review_note=?,reviewed_at=UTC_TIMESTAMP() WHERE id=?`,
        [status,req.user.sub,p.note,id]);
      if(status==='approved')await cx.execute(`UPDATE finance_invoices SET status='paid',paid_at=UTC_TIMESTAMP(),reviewed_by=? WHERE id=?`,[req.user.sub,i.id]);
      else await cx.execute("UPDATE finance_invoices SET status='issued' WHERE id=?",[i.id]);
      await notify(cx,{user_id:i.student_id,type:'system',title:status==='approved'?'Payment verified':'Payment reference rejected',body:status==='approved'?'Your invoice payment has been verified by the academy.':'Review the finance invoice and submit a corrected reference.',booking_id:i.booking_id,dedupe_key:`finance_claim_${id}_${status}`});
      await cx.execute('INSERT INTO audit_logs(actor_id,action,target_id,details) VALUES(?,?,?,?)',
        [req.user.sub,`finance_claim_${status}`,i.id,JSON.stringify({claim_id:id,review_note:p.note})]);
      return {invoice_id:i.id,claim_id:id,status};
    });
    if(result.error)return err(res,result.status,result.error);
    res.json(result);
  }));

  app.get('/api/finance/admin/releasable',auth(['admin']),api(async(_req,res)=>{
    const [rows]=await db.execute(`SELECT i.id,i.booking_id,i.tutor_id,i.amount_minor,i.currency,i.commission_bps,
      b.ends_at FROM finance_invoices i JOIN booking_requests b ON b.id=i.booking_id
      JOIN attendance a ON a.booking_id=b.id
      LEFT JOIN finance_earnings e ON e.invoice_id=i.id
      WHERE i.status='paid' AND b.status='completed' AND b.ends_at<=UTC_TIMESTAMP()
        AND a.student_attended=1 AND a.tutor_attended=1 AND e.id IS NULL
      ORDER BY i.id LIMIT 200`);
    res.json(rows.map(invoiceShape));
  }));

  app.post('/api/finance/admin/invoices/:id/release',auth(['admin']),api(async(req,res)=>{
    const id=checkedId(res,req.params.id);if(!id)return;
    const result=await inTransaction(db,async cx=>{
      // Tutor profile serializes new earnings against concurrent withdrawal requests.
      const [[pre]]=await cx.execute('SELECT tutor_id FROM finance_invoices WHERE id=?',[id]);
      if(!pre)return denial(404,'Invoice not found');
      await cx.execute('SELECT user_id FROM tutor_profiles WHERE user_id=? FOR UPDATE',[pre.tutor_id]);
      const [[i]]=await cx.execute('SELECT * FROM finance_invoices WHERE id=? FOR UPDATE',[id]);
      if(i.status!=='paid')return denial(409,'Admin must verify payment first');
      const [[booking]]=await cx.execute(`SELECT b.status,b.ends_at,a.student_attended,a.tutor_attended,
        (b.ends_at<=UTC_TIMESTAMP()) ended FROM booking_requests b
        LEFT JOIN attendance a ON a.booking_id=b.id WHERE b.id=? FOR UPDATE`,[i.booking_id]);
      if(!booking||booking.status!=='completed'||!booking.ended||!booking.student_attended||!booking.tutor_attended)
        return denial(409,'Class must be completed with both participants attending before releasing earnings');
      const [[found]]=await cx.execute('SELECT id FROM finance_earnings WHERE invoice_id=?',[id]);
      if(found)return denial(409,'Earnings already released');
      const split=splitInvoice(Number(i.amount_minor),Number(i.commission_bps));
      if(!split)return denial(409,'Invalid locked invoice monetary values');
      const [r]=await cx.execute(`INSERT INTO finance_earnings(invoice_id,booking_id,tutor_id,gross_minor,commission_minor,amount_minor,currency,released_by)
        VALUES(?,?,?,?,?,?,?,?)`,[id,i.booking_id,i.tutor_id,i.amount_minor,split.commission_minor,split.tutor_minor,i.currency,req.user.sub]);
      await notify(cx,{user_id:i.tutor_id,type:'system',title:'Class earnings released',body:'Open Finance to view your available tutoring earnings.',booking_id:i.booking_id,dedupe_key:`finance_earning_released_${id}`});
      await cx.execute('INSERT INTO audit_logs(actor_id,action,target_id,details) VALUES(?,?,?,?)',
        [req.user.sub,'finance_earning_release',id,JSON.stringify({earning_id:r.insertId})]);
      return {earning_id:r.insertId,invoice_id:id,...split,currency:i.currency};
    });
    if(result.error)return err(res,result.status,result.error);
    res.status(201).json(result);
  }));

  app.get('/api/finance/wallet',auth(['tutor']),api(async(req,res)=>{
    const balances=[];
    for(const currency of supportedCurrencies){
      const bal=await walletBalance(db,req.user.sub,currency);
      if(bal&&(bal.earned_minor||bal.reserved_minor))balances.push({currency,...bal});
    }
    const [earnings]=await db.execute(`SELECT id,invoice_id,booking_id,gross_minor,commission_minor,amount_minor,currency,released_at
      FROM finance_earnings WHERE tutor_id=? ORDER BY id DESC LIMIT 100`,[req.user.sub]);
    const [payouts]=await db.execute(`SELECT id,amount_minor,currency,payout_method,payout_note,status,
      external_reference,admin_note,created_at FROM finance_payout_requests WHERE tutor_id=? ORDER BY id DESC LIMIT 100`,[req.user.sub]);
    res.json({balances,earnings,payouts});
  }));

  app.post('/api/finance/payouts',auth(['tutor']),api(async(req,res)=>{
    const p=payoutSchema.parse(req.body);
    if(!minorInt(p.amount_minor))return err(res,400,'Invalid amount');
    const result=await inTransaction(db,async cx=>{
      const [[t]]=await cx.execute('SELECT user_id,approval_status FROM tutor_profiles WHERE user_id=? FOR UPDATE',[req.user.sub]);
      if(!t||t.approval_status!=='active')return denial(403,'Active tutor account required');
      const bal=await walletBalance(cx,req.user.sub,p.currency);
      if(!bal||bal.available_minor<p.amount_minor)return denial(409,'Not enough released earnings for this currency');
      const [r]=await cx.execute(`INSERT INTO finance_payout_requests(tutor_id,currency,amount_minor,payout_method,payout_note)
        VALUES(?,?,?,?,?)`,[req.user.sub,p.currency,p.amount_minor,p.payout_method,p.payout_note]);
      return {id:r.insertId,status:'requested',available_minor:bal.available_minor-p.amount_minor};
    });
    if(result.error)return err(res,result.status,result.error);
    res.status(201).json(result);
  }));

  app.get('/api/finance/admin/payouts',auth(['admin']),api(async(_req,res)=>{
    const [rows]=await db.execute(`SELECT p.*,u.name tutor_name,u.email tutor_email
      FROM finance_payout_requests p JOIN users u ON u.id=p.tutor_id ORDER BY p.id DESC LIMIT 200`);
    res.json(rows);
  }));

  app.patch('/api/finance/admin/payouts/:id',auth(['admin']),api(async(req,res)=>{
    const id=checkedId(res,req.params.id);if(!id)return;
    const p=z.object({action:z.enum(['approve','reject','mark_sent']),
      external_reference:z.string().trim().max(120).default(''),note:z.string().trim().max(500).default('')}).parse(req.body);
    if(p.action==='mark_sent'&&p.external_reference.length<5)return err(res,400,'External payout reference required');
    if(p.action==='reject'&&p.note.length<5)return err(res,400,'Rejection reason required');
    const result=await inTransaction(db,async cx=>{
      const [[pre]]=await cx.execute('SELECT tutor_id FROM finance_payout_requests WHERE id=?',[id]);
      if(!pre)return denial(404,'Payout request not found');
      await cx.execute('SELECT user_id FROM tutor_profiles WHERE user_id=? FOR UPDATE',[pre.tutor_id]);
      const [[request]]=await cx.execute('SELECT * FROM finance_payout_requests WHERE id=? FOR UPDATE',[id]);
      const next=p.action==='approve'?'approved':p.action==='reject'?'rejected':'sent';
      if((next==='approved'&&request.status!=='requested')||
         (next==='sent'&&request.status!=='approved')||
         (next==='rejected'&&!['requested','approved'].includes(request.status)))
         return denial(409,'Invalid payout transition');
      await cx.execute(`UPDATE finance_payout_requests SET status=?,reviewed_by=?,admin_note=?,
        external_reference=IF(?='sent',?,external_reference),reviewed_at=UTC_TIMESTAMP() WHERE id=?`,
        [next,req.user.sub,p.note,next,p.external_reference,id]);
      await notify(cx,{user_id:request.tutor_id,type:'system',title:`Withdrawal ${next}`,body:'Check your payout status and reference in Finance.',dedupe_key:`finance_payout_${id}_${next}`});
      await cx.execute('INSERT INTO audit_logs(actor_id,action,target_id,details) VALUES(?,?,?,?)',
        [req.user.sub,`finance_payout_${next}`,id,JSON.stringify({note:p.note})]);
      return {id,status:next};
    });
    if(result.error)return err(res,result.status,result.error);
    res.json(result);
  }));

  app.get('/api/finance/admin/report',auth(['admin']),api(async(_req,res)=>{
    const [invoices]=await db.execute(`SELECT currency,status,COUNT(*) invoice_count,
      CAST(COALESCE(SUM(amount_minor),0) AS CHAR) amount_minor FROM finance_invoices GROUP BY currency,status`);
    const [earnings]=await db.execute(`SELECT currency,COUNT(*) released_classes,
      CAST(COALESCE(SUM(commission_minor),0) AS CHAR) academy_commission_minor,
      CAST(COALESCE(SUM(amount_minor),0) AS CHAR) tutor_earnings_minor FROM finance_earnings GROUP BY currency`);
    const [payouts]=await db.execute(`SELECT currency,status,COUNT(*) request_count,
      CAST(COALESCE(SUM(amount_minor),0) AS CHAR) amount_minor FROM finance_payout_requests GROUP BY currency,status`);
    res.json({invoices,earnings,payouts,mode:'manual_verification_only'});
  }));
}
