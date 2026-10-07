import {fileURLToPath} from 'node:url';
import {McpServer} from '@modelcontextprotocol/server';
import {z} from 'zod';
import pkg from '../package.json' with {type:'json'};
import {loadConfig} from './config.mjs';
import {Actions,documentInput,resourceId} from './actions.mjs';
import {operations,operation} from './catalog.mjs';

const read={readOnlyHint:true,destructiveHint:false,openWorldHint:true};
const prepare={readOnlyHint:false,destructiveHint:false,openWorldHint:false};
const result=value=>({content:[{type:'text',text:JSON.stringify(value)}]});
const failure=error=>({isError:true,content:[{type:'text',text:error?.code==='ENOENT'?'Local file not found. Stage the file or prepare a new draft.':error?.code==='EACCES'||error?.code==='EPERM'?'Cannot access the private local files. Check file permissions.':error instanceof Error?error.message:'Operation failed.'}]});
const safe=fn=>async(...args)=>{try{return result(await fn(...args));}catch(error){return failure(error);}};
const uuid=z.string().uuid();

export function serverFactory(configuration=()=>loadConfig({allowMissing:true})){
  const getConfig=typeof configuration==='function'?configuration:async()=>configuration;
  let cached;
  async function connected(){
    // Reload the private connection after setup and before every tool call.
    const config=await getConfig();
    if(config.keysConfigured===false)throw new Error('Morning keys are not saved yet. Run morning-mcp setup and paste them into the local page.');
    if(!cached||cached.config.connectionFingerprint!==config.connectionFingerprint||cached.config.dataDir!==config.dataDir||cached.config.writesEnabled!==config.writesEnabled)cached=new Actions(config);
    return cached;
  }
  return ()=>{
    const server=new McpServer({name:'morning-desk',version:pkg.version},{
      instructions:'Personal Morning MCP. Read and prepare using the account owner’s keys. save_document_draft saves or updates an editable, unissued draft in Morning immediately. Use get_document_draft and preview_document_draft to review it. prepare_issue_document_draft prepares issuance of that exact saved draft; Before issuance, sending or any other business change, show the user the prepared review in plain language and the PDF when present, ask for confirmation in chat, then wait for the user’s explicit reply before calling execute_draft. If declined or unclear, do not execute. Never show raw JSON, request IDs or hashes as the user-facing review. This is an agent instruction, not server-enforced human approval: execute_draft executes directly and cannot verify a chat reply. The host may still require its own tool permission. Never approve on the user’s behalf or retry an executing/needs_check action. No website signup is needed. Check connection_status after local setup; the server reloads saved keys automatically.',
    });
    const tool=(name,description,inputSchema,annotations,fn)=>server.registerTool(name,{description,inputSchema,annotations},safe(fn));
    const accountTool=(name,description,inputSchema,annotations,fn)=>tool(name,description,inputSchema,annotations,async(input,ctx)=>fn(await connected(),input,ctx));

    tool('connection_status','Check local configuration. verifyMorning checks authentication and a read endpoint; it does not create records.',z.object({verifyMorning:z.boolean().default(false)}).strict(),read,async({verifyMorning})=>{
      const config=await getConfig(),configured=config.keysConfigured!==false;
      if(verifyMorning){const actions=await connected();await actions.morning.authenticate();await actions.morning.types();}
      return {environment:config.environment,keysConfigured:configured,morningVerification:verifyMorning?'authentication_and_read_verified':'not_checked',storage:'local private files',writesEnabled:configured&&config.writesEnabled,approval:'chat_confirmation',humanApprovalEnforced:false,approvalExplanation:'The agent must show the review and wait for confirmation in chat before execution. The server checks content and duplicates, but cannot verify the user’s reply.',documentDrafts:'native Morning drafts through API',...(!configured?{message:'Paste your API key ID and secret into the local setup page. Saved keys are picked up automatically.',setupCommand:[process.execPath,fileURLToPath(new URL('../bin/morning-mcp.mjs',import.meta.url)),'setup']}:{})};
    });
    accountTool('search_clients','Find existing Morning clients.',z.object({name:z.string().max(200),page:z.number().int().min(1).default(1)}).strict(),read,(a,{name,page})=>a.morning.searchClients(name,page));
    accountTool('get_client','Read an existing Morning client.',z.object({id:resourceId}).strict(),read,(a,{id})=>a.morning.getClient(id));
    accountTool('search_documents','Find Morning documents. Open status alone does not prove unpaid debt.',z.object({clientId:resourceId.optional(),fromDate:z.iso.date().optional(),toDate:z.iso.date().optional(),page:z.number().int().min(1).default(1),type:z.array(z.number().int()).max(100).optional(),status:z.array(z.number().int()).max(100).optional()}).strict(),read,(a,input)=>a.morning.searchDocuments(input));
    accountTool('get_document','Read a Morning document and download links.',z.object({id:resourceId}).strict(),read,async(a,{id})=>({document:await a.morning.getDocument(id),links:await a.morning.links(id)}));
    accountTool('document_options','Read document types and business defaults. Use prepare_morning_action for full document fields.',z.object({type:z.number().int()}).strict(),read,async(a,{type})=>({types:await a.morning.types(),defaults:await a.morning.info(type)}));
    accountTool('search_expenses','Read expenses or parsed expense drafts. Finalize parsed drafts in Morning.',z.object({drafts:z.boolean().default(false),page:z.number().int().min(1).default(1)}).strict(),read,(a,{drafts,page})=>drafts?a.morning.expenseDrafts(page):a.morning.searchExpenses(page));
    accountTool('save_document_draft','Save an editable, unissued document draft directly in Morning. Does not issue, send email or create a client. Use createDocumentDraft schema for body and client.add=false. draftId updates an existing saved draft. Reuse requestKey only for identical content; check uncertain outcomes before another request.',z.object({requestKey:uuid,title:z.string().trim().min(1).max(200),body:z.record(z.string(),z.json()),draftId:resourceId.optional()}).strict(),{readOnlyHint:false,destructiveHint:false,openWorldHint:true},(a,input)=>a.saveDocumentDraft(input));
    accountTool('search_document_drafts','Find editable document drafts saved in Morning.',z.object({page:z.number().int().min(1).default(1),pageSize:z.number().int().min(1).max(100).default(25)}).strict(),read,(a,input)=>a.morning.read('searchDocumentDrafts',{},input));
    accountTool('get_document_draft','Read an editable document draft saved in Morning. This ID is different from a local approval request ID.',z.object({id:resourceId}).strict(),read,(a,{id})=>a.morning.read('getDocumentDraft',{id}));
    accountTool('preview_document_draft','Generate a local PDF from the current saved Morning draft. Does not issue or email it. Show this preview to the user.',z.object({id:resourceId}).strict(),read,(a,{id})=>a.previewDocumentDraft(id));
    accountTool('prepare_issue_document_draft','Prepare issuance of the exact current saved Morning draft, including its recipients and PDF. Returns a plain-language review and local request id/payloadHash for execute_draft after the user confirms in chat. Nothing issued yet. Changes in Morning require a fresh preparation.',z.object({id:resourceId,requestKey:uuid,title:z.string().trim().min(1).max(200)}).strict(),prepare,(a,input)=>a.prepareIssueDocumentDraft(input));
    accountTool('prepare_document','Legacy shortcut: prepare a local ILS issuance request and PDF, without saving a draft in Morning. Prefer save_document_draft then prepare_issue_document_draft. No document is issued or emailed. Review it before execute_draft. Requests expire after 24 hours.',documentInput,prepare,(a,input)=>a.prepareDocument(input));
    accountTool('stage_expense_file','Stage a PDF/JPEG/PNG locally, not in Morning. Provide an absolute filePath or name plus base64; maximum 20 MB.',z.object({filePath:z.string().max(4000).optional(),name:z.string().max(180).optional(),base64:z.string().max(28*1024*1024).optional()}).strict(),prepare,async(a,input)=>{
      if(input.filePath){if(input.base64!==undefined||input.name!==undefined)throw new Error('Provide only filePath, or name and base64.');return a.stagePath(input.filePath);}
      if(!input.name||!input.base64||!/^[A-Za-z0-9+/]*={0,2}$/.test(input.base64)||input.base64.length%4!==0)throw new Error('Provide a name and valid padded base64, or an absolute filePath.');
      const bytes=Buffer.from(input.base64,'base64');if(bytes.toString('base64')!==input.base64)throw new Error('Invalid base64.');
      return a.stage(input.name,bytes);
    });
    accountTool('prepare_expense_upload','Prepare a staged file for review and chat confirmation. No upload yet. expenseId attaches to an existing expense; otherwise upload creates a parsed expense draft.',z.object({requestKey:uuid,fileId:uuid,title:z.string().trim().min(1).max(200),expenseId:resourceId.optional()}).strict(),prepare,(a,input)=>a.prepareExpense(input));
    accountTool('request_status','Read local draft status. Never retry executing or needs_check requests; check Morning first.',z.object({id:uuid}).strict(),read,(a,{id})=>a.store.status(id));
    tool('api_operations','Discover reviewed Morning operations: published API plus observed native draft endpoints. Reads run immediately; saved editable drafts have a dedicated immediate tool; other changes must be reviewed and confirmed in chat before the agent executes.',z.object({group:z.string().max(100).optional(),mode:z.enum(['read','approval','special']).optional()}).strict(),read,({group,mode})=>operations.filter(o=>(!group||o.group.toLowerCase()===group.toLowerCase())&&(!mode||o.mode===mode)).map(o=>({id:o.id,title:o.title,group:o.group,mode:o.mode,risk:o.risk,humanApprovalEnforced:false,documentation:o.documentation??'published_openapi',...(o.source?{source:o.source}:{}),...(o.special?{requirement:o.special}:{})})));
    tool('api_operation_schema','Get reviewed fields, source and review requirements. Read this before advanced requests.',z.object({operationId:z.string().max(100)}).strict(),read,({operationId})=>({...operation(operationId),humanApprovalEnforced:false}));
    const apiInput=z.object({operationId:z.string().max(100),parameters:z.record(z.string(),z.json()).default({}),body:z.record(z.string(),z.json()).optional()}).strict();
    accountTool('read_morning','Run a reviewed read/preview operation. No arbitrary URLs, tokens, headers or writes.',apiInput,read,(a,input)=>a.morning.read(input.operationId,input.parameters,input.body));
    accountTool('prepare_morning_action','Prepare a reviewed business write: clients, suppliers, items, expenses, documents, payments, charges, merges and deletions. No execution. Use the operation schema first; changes need a fresh requestKey.',apiInput.extend({requestKey:uuid,title:z.string().trim().min(1).max(200)}).strict(),prepare,(a,input)=>a.prepareApi(input));
    accountTool('execute_draft','Execute the exact prepared action directly. First show its review and PDF to the user, ask for confirmation in chat, and wait for their explicit reply. If declined, do not call this tool. No custom dialog or typed code. Human consent is an agent instruction, not enforced by this server. Content/target changes, expiry and duplicate/uncertain requests remain blocked.',z.object({id:uuid,payloadHash:z.string().regex(/^[a-f0-9]{64}$/)}).strict(),{readOnlyHint:false,destructiveHint:true,idempotentHint:false,openWorldHint:true},async(a,{id,payloadHash},ctx)=>a.execute(await a.review(id,payloadHash),{signal:ctx.mcpReq.signal}));
    return server;
  };
}
