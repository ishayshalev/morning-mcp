import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
export const defaultConfigPath=()=>path.resolve(process.env.MORNING_CONFIG_FILE??path.join(os.homedir(),'.morning-mcp','config.json'));
export async function loadConfig({allowMissing=false}={}){
  let saved={};
  const fromEnv=process.env.MORNING_CLIENT_ID!==undefined||process.env.MORNING_CLIENT_SECRET!==undefined;
  if(!fromEnv){
    try{saved=JSON.parse(await fs.readFile(defaultConfigPath(),'utf8'));}catch(error){if(error.code!=='ENOENT')throw new Error('Could not read Morning configuration. Run setup to replace it.');}
    if(!saved||typeof saved!=='object'||Array.isArray(saved))throw new Error('Invalid Morning configuration. Run setup to replace it.');
  }
  const id=fromEnv?process.env.MORNING_CLIENT_ID:saved.id,secret=fromEnv?process.env.MORNING_CLIENT_SECRET:saved.secret;
  const environment=process.env.MORNING_ENV??saved.environment??'production';
  if(!['sandbox','production'].includes(environment))throw new Error('MORNING_ENV must be production or sandbox.');
  const writesEnabled=process.env.MORNING_WRITES_ENABLED!=='false';
  if(allowMissing&&!fromEnv&&id===undefined&&secret===undefined)return {environment,keysConfigured:false,writesEnabled};
  if(typeof id!=='string'||!id.trim()||typeof secret!=='string'||!secret.trim())throw new Error('Run morning-mcp setup, or provide both MORNING_CLIENT_ID and MORNING_CLIENT_SECRET.');
  const connectionFingerprint=createHash('sha256').update(JSON.stringify({id,secret,environment})).digest('hex');
  const account=createHash('sha256').update(JSON.stringify({id,environment})).digest('hex').slice(0,24);
  return {id,secret,environment,keysConfigured:true,connectionFingerprint,dataDir:path.join(path.resolve(process.env.MORNING_DATA_DIR??path.join(os.homedir(),'.morning-mcp','data')),account),writesEnabled};
}
