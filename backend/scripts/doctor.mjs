#!/usr/bin/env node
/** Offline readiness checker; does NOT run a database or external HTTP requests. */
import {existsSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(fileURLToPath(new URL('../',import.meta.url)));
const out=[];
const add=(name,pass,detail='')=>out.push({name,pass,detail});
add('Node.js >=22',Number(process.versions.node.split('.')[0])>=22,process.version);
for(const path of ['schema.sql','migrations/006_parent_access.sql','src/family.js','src/finance.js','src/communication.js'])
  add(path,existsSync(resolve(root,path)));
const envFile=resolve(root,'.env');
add('Environment file',existsSync(envFile),existsSync(envFile)?'Found':'Copy .env.example to .env, then configure credentials');
if(existsSync(envFile)){
 const env=Object.fromEntries(readFileSync(envFile,'utf8').split('\n').filter(x=>x&&!x.startsWith('#')&&x.includes('=')).map(x=>{const ix=x.indexOf('=');return [x.slice(0,ix).trim(),x.slice(ix+1).trim()]}));
 add('JWT_SECRET configured',(env.JWT_SECRET||'').length>=48 && !env.JWT_SECRET.startsWith('replace_'),'Never commit .env');
 add('MySQL settings present',['DB_HOST','DB_USER','DB_NAME','DB_PASSWORD'].every(k=>Boolean(env[k])));
}
for(const row of out)console.log(`${row.pass?'OK  ':'WARN'} ${row.name}${row.detail?' - '+row.detail:''}`);
if(out.some(x=>!x.pass))process.exitCode=1;
