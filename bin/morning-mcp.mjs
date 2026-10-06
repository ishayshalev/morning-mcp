#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline/promises';
import {serveStdio,StdioServerTransport} from '@modelcontextprotocol/server/stdio';
import {defaultConfigPath,loadConfig} from '../lib/config.mjs';
import {serverFactory} from '../lib/server.mjs';

async function hiddenSecret(){
  if(!process.stdin.isTTY)throw new Error('Run setup in an interactive terminal.');
  process.stderr.write('Morning secret (hidden): ');process.stdin.setRawMode(true);process.stdin.resume();
  return new Promise((resolve,reject)=>{
    let text='';
    const finish=(error)=>{process.stdin.off('data',onData);process.stdin.setRawMode(false);process.stdin.pause();process.stderr.write('\n');error?reject(error):resolve(text);};
    const onData=chunk=>{for(const char of chunk.toString('utf8')){if(char==='\u0003'){finish(new Error('Setup cancelled.'));return;}if(char==='\r'||char==='\n'){finish();return;}if(char==='\u007f'||char==='\b')text=Array.from(text).slice(0,-1).join('');else if(char>=' '&&text.length<1024)text+=char;}};
    process.stdin.on('data',onData);
  });
}
async function setup(){
  if(!process.stdin.isTTY)throw new Error('Run morning-mcp setup in an interactive terminal.');
  const configPath=defaultConfigPath(),rl=readline.createInterface({input:process.stdin,output:process.stderr});
  let id,environment;
  try{
    if(await fs.stat(configPath).catch(()=>null)){const answer=await rl.question('Replace your existing local Morning connection? [y/N] ');if(answer.trim().toLowerCase()!=='y')return;}
    id=(await rl.question('Morning API key ID: ')).trim();
    environment=(await rl.question('Environment [production/sandbox] (production): ')).trim()||'production';
  }finally{rl.close();}
  if(!id||!['production','sandbox'].includes(environment))throw new Error('Provide an API key ID and a valid environment.');
  const secret=await hiddenSecret();if(!secret.trim())throw new Error('Secret is required.');
  await fs.mkdir(path.dirname(configPath),{recursive:true,mode:0o700});
  const temp=`${configPath}.${process.pid}.tmp`;
  try{await fs.writeFile(temp,JSON.stringify({id,secret,environment},null,2),{flag:'wx',mode:0o600});await fs.rename(temp,configPath);}finally{await fs.unlink(temp).catch(()=>{});}
  process.stderr.write(`Saved private configuration: ${configPath}\nConnect your MCP client using the morning-mcp command. No Morning action was executed.\n`);
}
const command=process.argv[2];
try{
  if(command==='setup')await setup();
  else if(command==='--help'||command==='help')process.stderr.write('morning-mcp setup  Save your own Morning API key/secret locally.\nmorning-mcp        Run the personal MCP on stdio.\nEnvironment overrides: MORNING_CLIENT_ID, MORNING_CLIENT_SECRET, MORNING_ENV, MORNING_CONFIG_FILE, MORNING_DATA_DIR, MORNING_WRITES_ENABLED.\n');
  else if(command==='--version')process.stderr.write('0.1.0\n');
  else if(command)throw new Error('Unknown argument. Run morning-mcp --help.');
  else{
    // A 20 MB receipt becomes about 27 MB in base64; keep a bounded allowance.
    const config=await loadConfig(),transport=new StdioServerTransport(process.stdin,process.stdout,{maxBufferSize:30*1024*1024});
    const handle=serveStdio(serverFactory(config),{transport,maxSubscriptions:0,onerror:()=>console.error('Morning MCP transport error. Reconnect your client.')});
    for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>void handle.close());
  }
}catch(error){console.error(error instanceof Error?error.message:'Morning MCP could not start.');process.exitCode=1;}
