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

const style=`*{box-sizing:border-box}body{margin:0;background:#f4f6f3;color:#20352b;font:17px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif}main{max-width:540px;margin:7vh auto;padding:28px;background:white;border:1px solid #dbe5dd;border-radius:16px}h1{font-size:28px;margin:0 0 12px}p{margin:10px 0}label{display:block;margin:20px 0 6px;font-weight:600}input[type=text],input[type=password]{width:100%;padding:12px;border:1px solid #aebfb4;border-radius:8px;font:16px monospace;direction:ltr;text-align:left}[hidden]{display:none!important}button:disabled{opacity:.65;cursor:wait}#success{padding:12px 16px;background:#e9f3ec;border-radius:8px}button{width:100%;padding:13px;margin-top:24px;border:0;border-radius:8px;background:#286347;color:white;font:700 17px Arial;cursor:pointer}small{display:block;color:#55685c;font-size:14px}.check{font-weight:400}.error{color:#a32c24}a{color:#286347}details{margin-top:18px}details label{margin:10px 0}@media(max-width:580px){main{margin:24px 12px;padding:22px}}`;

const formScript=`
const form=document.querySelector('form');
if(form){
 const button=form.querySelector('button'),status=document.getElementById('status'),success=document.getElementById('success');
 const route=form.getAttribute('action');
 async function request(url,options={}){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
  try{const response=await fetch(url,{...options,signal:controller.signal,credentials:'omit',cache:'no-store',headers:{Accept:'application/json',...options.headers}});return {...await response.json(),ok:response.ok};}finally{clearTimeout(timer);}
 }
 function confirmed(){
  form.reset();form.hidden=true;status.hidden=true;success.hidden=false;
  document.querySelector('h1').textContent='המפתחות נשמרו';document.getElementById('intro').hidden=true;
  success.focus();
  request(route+'/complete',{method:'POST'}).catch(()=>{});
 }
 form.addEventListener('submit',async event=>{
  event.preventDefault();if(button.disabled||!form.reportValidity())return;
  const body=new URLSearchParams(new FormData(form)),inputs=[...form.querySelectorAll('input')];inputs.forEach(input=>input.disabled=true);
  button.disabled=true;button.textContent='שומר…';status.hidden=false;status.className='';status.textContent='שומר את המפתחות במחשב שלכם…';
  try{
   const result=await request(route,{method:'POST',body});
   if(!result.ok||!result.saved)throw new Error(result.message||'השמירה לא הצליחה. נסו שוב.');
   confirmed();
  }catch(error){
   try{const result=await request(route+'/status');if(result.ok&&result.saved){confirmed();return;}}catch{}
   status.className='error';status.textContent=error.name==='AbortError'?'לא התקבל אישור שמירה בזמן. בדקו שהחיבור המקומי עדיין פעיל ונסו שוב.':/[\u0590-\u05ff]/.test(error.message)?error.message:'לא התקבל אישור שמירה. בדקו שהחיבור המקומי עדיין פעיל ונסו שוב.';
  }finally{inputs.forEach(input=>input.disabled=false);button.disabled=false;button.textContent='שמירה וחיבור';}
 });
}
`;
function page({route,nonce,exists,error='',done=false}){
  const confirmation='<div id="success" role="status" tabindex="-1"'+(done?'':' hidden')+'><p><strong>המפתחות נשמרו במחשב שלכם.</strong></p><p>אפשר לסגור את החלון ולחזור לסוכן כדי לבדוק את החיבור למורנינג.</p><p>לא בוצעה פעולה בחשבון מורנינג.</p></div>';
  const content=done?`<h1>המפתחות נשמרו</h1>${confirmation}`:`<h1>חיבור מורנינג</h1><div id="intro"><p>מדביקים את שני הערכים ממורנינג ושומרים.</p><p><a href="https://app.greeninvoice.co.il/settings/developers/api" target="_blank" rel="noreferrer">פתיחת עמוד המפתחות במורנינג</a></p></div><form method="post" action="${route}" autocomplete="off"><label for="id">מזהה מפתח</label><input id="id" name="id" type="text" required maxlength="256" autocomplete="off" spellcheck="false" autocapitalize="none"><label for="secret">מפתח סודי</label><input id="secret" name="secret" type="password" required maxlength="1024" autocomplete="off" spellcheck="false"><small>הסוד מופיע במורנינג פעם אחת, מיד אחרי יצירת המפתח.</small>${exists?'<label class="check"><input type="checkbox" name="replace" value="yes" required> להחליף את החיבור הקיים במחשב הזה</label>':''}<button type="submit">שמירה וחיבור</button></form><p id="status" role="status"${error?'':' hidden'} class="error">${error}</p>${confirmation}<p><small>המפתחות נשמרים בקובץ פרטי במחשב, ללא הצפנה. דף ההגדרה לא שולח אותם לשירות חיצוני. לא מדביקים אותם בצ׳אט.</small></p>`;
  return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>חיבור מורנינג</title><style nonce="${nonce}">${style}</style></head><body><main>${content}</main><script nonce="${nonce}">${formScript}</script></body></html>`;
}

export async function setupBrowser({configPath=defaultConfigPath(),openBrowser=true,timeoutMs=600_000,onReady}={}){
  const token=randomBytes(32).toString('hex'),nonce=randomBytes(16).toString('hex'),route=`/setup/${token}`;
  let origin,authority,busy=false,completed=false,timer,confirmationTimer,resolveDone,rejectDone;
  const done=new Promise((resolve,reject)=>{resolveDone=resolve;rejectDone=reject;});
  const exists=async()=>Boolean(await fs.stat(configPath).catch(error=>{if(error.code==='ENOENT')return null;throw error;}));
  const server=http.createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Content-Security-Policy',`default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`);
    const reply=(status,body)=>{res.writeHead(status,{'Content-Type':'text/html; charset=utf-8'});res.end(body);};
    const json=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));};
    const wantsJson=req.headers.accept?.includes('application/json');
    const failure=async(status,message)=>wantsJson?json(status,{saved:false,message}):reply(status,page({route,nonce,exists:await exists(),error:message}));
    const finish=()=>{clearTimeout(timer);clearTimeout(confirmationTimer);server.close();server.closeIdleConnections();resolveDone();};
    try{
      // Exact Host prevents DNS rebinding; the random route and strict Origin check prevent cross-site saves.
      if(req.headers.host!==authority||![route,route+'/status',route+'/complete'].includes(req.url))return reply(404,'Not found');
      if(req.url===route+'/status'&&req.method==='GET')return json(200,{saved:completed});
      if(req.url===route+'/complete'&&req.method==='POST'){
        if(req.headers.origin!==origin||!completed)return json(403,{saved:false});
        res.once('finish',finish);return json(200,{saved:true});
      }
      if(req.url!==route)return reply(404,'Not found');
      if(req.method==='GET')return reply(200,page({route,nonce,exists:await exists(),done:completed}));
      if(req.method!=='POST')return reply(405,'Method not allowed');
      if(req.headers.origin!==origin||req.headers['content-type']?.split(';')[0]!=='application/x-www-form-urlencoded')return json(403,{saved:false,message:'בקשת השמירה חסומה. פתחו את הקישור המקומי מחדש.'});
      if(completed)return wantsJson?json(200,{saved:true}):reply(200,page({route,nonce,done:true}));
      if(busy)return failure(409,'השמירה כבר מתבצעת. המתינו רגע ונסו שוב.');
      if(Number(req.headers['content-length'])>8192)return failure(413,'הערכים שהוזנו ארוכים מדי.');
      let body='',length=0;
      for await(const chunk of req){length+=chunk.length;if(length>8192){await failure(413,'הערכים שהוזנו ארוכים מדי.');return;}body+=chunk.toString('utf8');}
      const fields=new URLSearchParams(body),id=fields.get('id'),secret=fields.get('secret');
      if(!id?.trim()||id.length>256||!secret?.trim()||secret.length>1024)return failure(400,'צריך להדביק מזהה מפתח ומפתח סודי תקינים.');
      const replace=fields.get('replace')==='yes';
      if(await exists()&&!replace)return failure(409,'כבר קיים חיבור. צריך לסמן החלפה כדי לעדכן אותו.');
      if(busy||completed)return failure(409,'השמירה כבר מתבצעת. המתינו רגע ונסו שוב.');
      busy=true;
      try{await saveConfig(configPath,{id,secret,environment:'production'},replace);}
      catch{busy=false;return failure(500,'השמירה לא הצליחה. בדקו הרשאות לתיקיית ההגדרה ונסו שוב.');}
      completed=true;clearTimeout(timer);
      // Keep the server alive until the browser has rendered confirmation, with a bounded fallback.
      confirmationTimer=setTimeout(finish,120_000);
      return wantsJson?json(200,{saved:true}):reply(200,page({route,nonce,done:true}));
    }catch{if(!res.headersSent)json(500,{saved:false,message:'לא התקבל אישור שמירה. נסו שוב.'});else res.destroy();}

  });
  server.requestTimeout=15_000;server.headersTimeout=10_000;
  const stop=()=>{clearTimeout(timer);clearTimeout(confirmationTimer);server.close();server.closeAllConnections();rejectDone(new Error('Setup cancelled.'));};
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
  }finally{clearTimeout(timer);clearTimeout(confirmationTimer);process.off('SIGINT',stop);process.off('SIGTERM',stop);server.close();server.closeAllConnections();}
}
