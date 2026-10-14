// Run on the trusted backend machine, never from a public HTTP request.
import 'dotenv/config';
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
const role=process.env.STAFF_ROLE,email=process.env.STAFF_EMAIL,password=process.env.STAFF_PASSWORD,name=process.env.STAFF_NAME;
if(!['admin','examiner'].includes(role)||!email||!name||!password||password.length<14)throw new Error('Set STAFF_ROLE=admin|examiner, STAFF_NAME, STAFF_EMAIL, STAFF_PASSWORD (14+ chars)');
const c=await mysql.createConnection({host:process.env.DB_HOST,port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME});
try{const hash=await bcrypt.hash(password,12);await c.execute("INSERT INTO users(name,email,password_hash,role,timezone) VALUES(?,?,?,?, 'UTC')",[name,email.toLowerCase(),hash,role]);console.log(`${role} account provisioned`);}finally{await c.end();}
