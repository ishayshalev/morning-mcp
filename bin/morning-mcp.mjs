#!/usr/bin/env node
import fs from 'node:fs/promises';
import readline from 'node:readline/promises';
import {serveStdio,StdioServerTransport} from '@modelcontextprotocol/server/stdio';
import {defaultConfigPath,loadConfig} from '../lib/config.mjs';
import {serverFactory} from '../lib/server.mjs';
import {saveConfig,setupBrowser} from '../lib/setup.mjs';

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
async function setupTerminal(){
  if(!process.stdin.isTTY)throw new Error('Run morning-mcp setup in an interactive terminal.');
  const configPath=defaultConfigPath(),rl=readline.createInterface({input:process.stdin,output:process.stderr});
  let id,environment,replace=false;
  try{
    if(await fs.stat(configPath).catch(()=>null)){const answer=await rl.question('Replace your existing local Morning connection? [y/N] ');if(answer.trim().toLowerCase()!=='y')return;replace=true;}
    id=(await rl.question('Morning API key ID: ')).trim();
    environment=(await rl.question('Environment [production/sandbox] (production): ')).trim()||'production';
  }finally{rl.close();}
  if(!id||!['production','sandbox'].includes(environment))throw new Error('Provide an API key ID and a valid environment.');
  const secret=await hiddenSecret();if(!secret.trim())throw new Error('Secret is required.');
  await saveConfig(configPath,{id,secret,environment},replace);
  process.stderr.write(`Saved private configuration: ${configPath}\nConnect your MCP client using the morning-mcp command. No Morning action was executed.\n`);
}
const command=process.argv[2];
try{
  if(command==='setup'){
    const flags=process.argv.slice(3);
    if(flags.some(flag=>!['--terminal','--no-open'].includes(flag)))throw new Error('Unknown setup option. Use --terminal or --no-open.');
    if(flags.includes('--terminal'))await setupTerminal();else await setupBrowser({openBrowser:!flags.includes('--no-open')});
  }
  else if(command==='--help'||command==='help')process.stderr.write('morning-mcp setup             Open a local browser form for your Morning keys.\nmorning-mcp setup --no-open   Print the local setup link without opening a browser.\nmorning-mcp setup --terminal  Save keys in a private interactive terminal instead.\nmorning-mcp                   Run the personal MCP on stdio.\nEnvironment overrides: MORNING_CLIENT_ID, MORNING_CLIENT_SECRET, MORNING_ENV, MORNING_CONFIG_FILE, MORNING_DATA_DIR, MORNING_WRITES_ENABLED.\n');
  else if(command==='--version')process.stderr.write('0.1.1\n');
  else if(command)throw new Error('Unknown argument. Run morning-mcp --help.');
  else{
    // A 20 MB receipt becomes about 27 MB in base64; keep a bounded allowance.
    const config=await loadConfig(),transport=new StdioServerTransport(process.stdin,process.stdout,{maxBufferSize:30*1024*1024});
    const handle=serveStdio(serverFactory(config),{transport,maxSubscriptions:0,onerror:()=>console.error('Morning MCP transport error. Reconnect your client.')});
    for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>void handle.close());
  }
}catch(error){console.error(error instanceof Error?error.message:'Morning MCP could not start.');process.exitCode=1;}
