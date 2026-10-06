import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import {randomBytes} from 'node:crypto';
import {execFile} from 'node:child_process';
import {defaultConfigPath} from './config.mjs';

export async function saveConfig(configPath,{id,secret,environment},replace=false){
  if(typeof id!=='string'||!id.trim()||id.length>256||typeof secret!=='string'||!secret.trim()||secret.length>1024||!['production','sandbox'].includes(environment))throw new Error('Invalid Morning configuration.');
  await fs.mkdir(path.dirname(configPath),{recursive:true,mode:0o700});
  const temp=`${configPath}.${randomBytes(16).toString('hex')}.tmp`;
  try{
    await fs.writeFile(temp,JSON.stringify({id:id.trim(),secret:secret.trim(),environment},null,2),{flag:'wx',mode:0o600});
    // A hard link atomically refuses to overwrite an existing connection.
    if(replace)await fs.rename(temp,configPath);else await fs.link(temp,configPath);
  }finally{await fs.unlink(temp).catch(()=>{});}
}

const style=`*{box-sizing:border-box}body{margin:0;background:#f4f6f3;color:#20352b;font:17px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif}main{max-width:540px;margin:7vh auto;padding:28px;background:white;border:1px solid #dbe5dd;border-radius:16px}h1{font-size:28px;margin:0 0 12px}p{margin:10px 0}label{display:block;margin:20px 0 6px;font-weight:600}input[type=text],input[type=password]{width:100%;padding:12px;border:1px solid #aebfb4;border-radius:8px;font:16px monospace;direction:ltr;text-align:left}button{width:100%;padding:13px;margin-top:24px;border:0;border-radius:8px;background:#286347;color:white;font:700 17px Arial;cursor:pointer}small{display:block;color:#55685c;font-size:14px}.check{font-weight:400}.error{color:#a32c24}a{color:#286347}details{margin-top:18px}details label{margin:10px 0}@media(max-width:580px){main{margin:24px 12px;padding:22px}}`;

function page({route,nonce,exists,error='',done=false}){
  const content=done?`<h1>המפתחות נשמרו</h1><p>המפתחות נשמרו במחשב שלכם. אפשר לסגור את החלון ולחזור לסוכן.</p><p>לא בוצעה פעולה בחשבון מורנינג.</p>`:`<h1>חיבור מורנינג</h1><p>מדביקים את שני הערכים ממורנינג ושומרים.</p><p><a href="https://app.greeninvoice.co.il/settings/developers/api" target="_blank" rel="noreferrer">פתיחת עמוד המפתחות במורנינג</a></p>${error?`<p class="error" role="alert">${error}</p>`:''}<form method="post" action="${route}" autocomplete="off"><label for="id">מזהה מפתח</label><input id="id" name="id" type="text" required maxlength="256" autocomplete="off" spellcheck="false" autocapitalize="none"><label for="secret">מפתח סודי</label><input id="secret" name="secret" type="password" required maxlength="1024" autocomplete="off" spellcheck="false"><small>הסוד מופיע במורנינג פעם אחת, מיד אחרי יצירת המפתח.</small><details><summary>חשבון בדיקה</summary><label class="check"><input type="checkbox" name="sandbox" value="yes"> המפתחות האלה מחשבון sandbox</label></details>${exists?'<label class="check"><input type="checkbox" name="replace" value="yes" required> להחליף את החיבור הקיים במחשב הזה</label>':''}<button type="submit">שמירה וחיבור</button></form><p><small>המפתחות נשמרים בקובץ פרטי במחשב, ללא הצפנה. דף ההגדרה לא שולח אותם לשירות חיצוני. לא מדביקים אותם בצ׳אט.</small></p>`;
  return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>חיבור מורנינג</title><style nonce="${nonce}">${style}</style></head><body><main>${content}</main></body></html>`;
}

export async function setupBrowser({configPath=defaultConfigPath(),openBrowser=true,timeoutMs=600_000,onReady}={}){
  const token=randomBytes(32).toString('hex'),nonce=randomBytes(16).toString('hex'),route=`/setup/${token}`;
  let origin,authority,busy=false,completed=false,timer,resolveDone,rejectDone;
  const done=new Promise((resolve,reject)=>{resolveDone=resolve;rejectDone=reject;});
  const exists=async()=>Boolean(await fs.stat(configPath).catch(error=>{if(error.code==='ENOENT')return null;throw error;}));
  const server=http.createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Content-Security-Policy',`default-src 'none'; style-src 'nonce-${nonce}'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`);
    const reply=(status,body)=>{res.writeHead(status,{'Content-Type':'text/html; charset=utf-8'});res.end(body);};
    try{
      // Exact Host prevents DNS rebinding. No CORS and a strict Origin check block cross-site submissions.
      if(req.headers.host!==authority||req.url!==route||completed)return reply(404,'Not found');
      if(req.method==='GET')return reply(200,page({route,nonce,exists:await exists()}));
      if(req.method!=='POST')return reply(405,'Method not allowed');
      if(req.headers.origin!==origin||req.headers['content-type']?.split(';')[0]!=='application/x-www-form-urlencoded')return reply(403,'Forbidden');
      if(busy)return reply(409,'Setup already saving');
      if(Number(req.headers['content-length'])>8192)return reply(413,'Request too large');
      let body='',length=0;
      for await(const chunk of req){length+=chunk.length;if(length>8192){reply(413,'Request too large');return;}body+=chunk.toString('utf8');}
      const fields=new URLSearchParams(body),id=fields.get('id'),secret=fields.get('secret');
      if(!id?.trim()||id.length>256||!secret?.trim()||secret.length>1024)return reply(400,page({route,nonce,exists:await exists(),error:'צריך להדביק מזהה מפתח ומפתח סודי תקינים.'}));
      const replace=fields.get('replace')==='yes';
      if(await exists()&&!replace)return reply(409,page({route,nonce,exists:true,error:'כבר קיים חיבור. צריך לסמן החלפה כדי לעדכן אותו.'}));
      if(busy||completed)return reply(409,'Setup already saving');
      busy=true;
      try{await saveConfig(configPath,{id,secret,environment:fields.get('sandbox')==='yes'?'sandbox':'production'},replace);}
      catch{busy=false;return reply(500,page({route,nonce,exists:await exists(),error:'השמירה לא הצליחה. בדקו הרשאות לתיקיית ההגדרה ונסו שוב.'}));}
      completed=true;clearTimeout(timer);
      res.once('finish',()=>{server.close();server.closeIdleConnections();resolveDone();});
      reply(200,page({route,nonce,done:true}));
    }catch{if(!res.headersSent)reply(500,'Setup could not complete.');else res.destroy();}
  });
  server.requestTimeout=15_000;server.headersTimeout=10_000;
  const stop=()=>{clearTimeout(timer);server.close();server.closeAllConnections();rejectDone(new Error('Setup cancelled.'));};
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  authority=`127.0.0.1:${server.address().port}`;origin=`http://${authority}`;
  const url=`${origin}${route}`;
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
  timer=setTimeout(()=>{server.close();server.closeAllConnections();rejectDone(new Error('Setup expired. Run setup again.'));},timeoutMs);
  try{
    process.stderr.write(`Open this local setup page (expires in 10 minutes):\n${url}\n`);
    if(onReady)await onReady({url});
    if(openBrowser){
      const opener=process.platform==='darwin'?'open':process.platform==='linux'?'xdg-open':null;
      if(opener)execFile(opener,[url],{timeout:5000},error=>{if(error)process.stderr.write('Open the local link above in your browser.\n');});
    }
    await done;
    process.stderr.write('Private configuration saved locally. No Morning action was executed.\n');
  }finally{clearTimeout(timer);process.off('SIGINT',stop);process.off('SIGTERM',stop);server.close();server.closeAllConnections();}
}
