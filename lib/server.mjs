import {randomBytes,randomUUID} from 'node:crypto';
import {McpServer,inputRequired,inputResponse,acceptedContent,createRequestStateCodec} from '@modelcontextprotocol/server';
import {z} from 'zod';
import {Actions,documentInput} from './actions.mjs';
import {operations,operation} from './catalog.mjs';
const read={readOnlyHint:true,destructiveHint:false,openWorldHint:true};
const prepare={readOnlyHint:false,destructiveHint:false,openWorldHint:false};
const result=value=>({content:[{type:'text',text:JSON.stringify(value)}]});
const safe=fn=>async(...args)=>{try{return result(await fn(...args));}catch(error){return {isError:true,content:[{type:'text',text:error instanceof Error?error.message:'Operation failed.'}]};}};
const approvalSchema=z.object({confirm:z.boolean().meta({title:'I approve this exact action'}),confirmation:z.string().optional().meta({title:'For card charges type CHARGE; for deletions/merges type CONFIRM'})}).strict();
const uuid=z.string().uuid();
export function serverFactory(config){
  const actions=new Actions(config),codec=createRequestStateCodec({key:randomBytes(32),ttlSeconds:600});
  return ()=>{
    const server=new McpServer({name:'morning-desk',version:'0.1.0'},{instructions:'Personal Morning MCP. Read and prepare using the account owner’s keys. Every Morning write uses execute_draft, which requests human confirmation through MCP elicitation. Never approve on the user’s behalf or retry an executing/needs_check action. No website signup is needed.',requestState:{verify:codec.verify}});
    const tool=(name,description,inputSchema,annotations,fn)=>server.registerTool(name,{description,inputSchema,annotations},safe(fn));
    tool('connection_status','Check local configuration. verifyMorning checks authentication and a read endpoint; it does not create records.',z.object({verifyMorning:z.boolean().default(false)}).strict(),read,async({verifyMorning})=>{if(verifyMorning){await actions.morning.authenticate();await actions.morning.types();}return {environment:config.environment,keysConfigured:true,morningVerification:verifyMorning?'authentication_and_read_verified':'not_checked',storage:'local private files',writesEnabled:config.writesEnabled,approval:'Human confirmation through the MCP client. Unsupported clients cannot execute writes.'};});
    tool('search_clients','Find existing Morning clients.',z.object({name:z.string().max(200),page:z.number().int().min(1).default(1)}).strict(),read,({name,page})=>actions.morning.searchClients(name,page));
    tool('get_client','Read an existing Morning client.',z.object({id:uuid}).strict(),read,({id})=>actions.morning.getClient(id));
    tool('search_documents','Find Morning documents. Open status alone does not prove unpaid debt.',z.object({clientId:uuid.optional(),fromDate:z.iso.date().optional(),toDate:z.iso.date().optional(),page:z.number().int().min(1).default(1),type:z.array(z.number().int()).optional(),status:z.array(z.number().int()).optional()}).strict(),read,input=>actions.morning.searchDocuments(input));
    tool('get_document','Read a Morning document and download links.',z.object({id:uuid}).strict(),read,async({id})=>({document:await actions.morning.getDocument(id),links:await actions.morning.links(id)}));
    tool('document_options','Read document types and business defaults. Use prepare_morning_action for full document fields.',z.object({type:z.number().int()}).strict(),read,async({type})=>({types:await actions.morning.types(),defaults:await actions.morning.info(type)}));
    tool('search_expenses','Read expenses or parsed expense drafts. Finalize parsed drafts in Morning.',z.object({drafts:z.boolean().default(false),page:z.number().int().min(1).default(1)}).strict(),read,({drafts,page})=>drafts?actions.morning.expenseDrafts(page):actions.morning.searchExpenses(page));
    tool('prepare_document','Prepare an ILS invoice request and local PDF preview. No document is issued or emailed. Review it before execute_draft. Requests expire after 24 hours.',documentInput,prepare,input=>actions.prepareDocument(input));
    tool('stage_expense_file','Stage a PDF/JPEG/PNG locally, not in Morning. Provide an absolute filePath or name plus base64; maximum 20 MB.',z.object({filePath:z.string().max(4000).optional(),name:z.string().max(180).optional(),base64:z.string().max(28*1024*1024).optional()}).strict(),prepare,async input=>{
      if(input.filePath){if(input.base64!==undefined||input.name!==undefined)throw new Error('Provide only filePath, or name and base64.');return actions.stagePath(input.filePath);}
      if(!input.name||!input.base64||!/^[A-Za-z0-9+/]*={0,2}$/.test(input.base64)||input.base64.length%4!==0)throw new Error('Provide a name and valid padded base64, or an absolute filePath.');
      const bytes=Buffer.from(input.base64,'base64');if(bytes.toString('base64')!==input.base64)throw new Error('Invalid base64.');return actions.stage(input.name,bytes);
    });
    tool('prepare_expense_upload','Prepare a staged file for approval. No upload yet. expenseId attaches to an existing expense; otherwise upload creates a parsed expense draft.',z.object({requestKey:uuid,fileId:uuid,title:z.string().trim().min(1).max(200),expenseId:uuid.optional()}).strict(),prepare,input=>actions.prepareExpense(input));
    tool('request_status','Read local draft status. Never retry executing or needs_check requests; check Morning first.',z.object({id:uuid}).strict(),read,({id})=>actions.store.status(id));
    tool('api_operations','Discover the reviewed Morning API. Reads run immediately; every business change requires native human confirmation.',z.object({group:z.string().optional(),mode:z.enum(['read','approval','special']).optional()}).strict(),read,({group,mode})=>operations.filter(o=>(!group||o.group.toLowerCase()===group.toLowerCase())&&(!mode||o.mode===mode)).map(o=>({id:o.id,title:o.title,group:o.group,mode:o.mode,risk:o.risk,...(o.special?{requirement:o.special}:{})})));
    tool('api_operation_schema','Get exact documented fields and approval requirements. Read this before advanced requests.',z.object({operationId:z.string().max(100)}).strict(),read,({operationId})=>operation(operationId));
    const apiInput=z.object({operationId:z.string().max(100),parameters:z.record(z.string(),z.json()).default({}),body:z.record(z.string(),z.json()).optional()}).strict();
    tool('read_morning','Run a reviewed read/preview operation. No arbitrary URLs, tokens, headers or writes.',apiInput,read,input=>actions.morning.read(input.operationId,input.parameters,input.body));
    tool('prepare_morning_action','Prepare any documented business write: clients, suppliers, items, expenses, documents, payments, charges, merges and deletions. No execution. Use the operation schema first; changes need a fresh requestKey.',apiInput.extend({requestKey:uuid,title:z.string().trim().min(1).max(200)}).strict(),prepare,input=>actions.prepareApi(input));
    server.registerTool('execute_draft',{
      description:'Execute the exact prepared draft only after a human accepts the MCP confirmation dialog. Provide the reviewed id and payloadHash. Never retry an uncertain result. No agent-provided approved flag is accepted.',
      inputSchema:z.object({id:uuid,payloadHash:z.string().regex(/^[a-f0-9]{64}$/)}).strict(),
      annotations:{readOnlyHint:false,destructiveHint:true,idempotentHint:false,openWorldHint:true},
      _meta:{'anthropic/requiresUserInteraction':true},
    },async({id,payloadHash},ctx)=>{
      try{
        if(!config.writesEnabled)throw new Error('Writes disabled by MORNING_WRITES_ENABLED=false.');
        const d=await actions.review(id,payloadHash),state=ctx.mcpReq.requestState();
        // A confirmation is valid only in the signed continuation for this draft/hash.
        const bound=state?.id===id&&state?.payloadHash===payloadHash&&typeof state?.approvalKey==='string';
        if(bound){
          const response=inputResponse(ctx.mcpReq.inputResponses,state.approvalKey);
          if(response.kind!=='missing'){
            const approval=acceptedContent(ctx.mcpReq.inputResponses,state.approvalKey,approvalSchema);
            if(response.kind!=='elicit'||response.action!=='accept'||approval?.confirm!==true)return result({id,status:'not_approved',message:'No Morning action executed.'});
            const required=d.payload.risk==='charge'?'CHARGE':d.payload.risk==='destructive'?'CONFIRM':'';
            if(required&&approval.confirmation!==required)throw new Error(`Type ${required} in the confirmation dialog after review.`);
            return result(await actions.execute(d));
          }
        }
        const approvalKey=`approve_${randomUUID()}`;
        return inputRequired({inputRequests:{[approvalKey]:inputRequired.elicit({message:actions.approvalMessage(d),requestedSchema:approvalSchema})},requestState:await codec.mint({id,payloadHash,approvalKey})});
      }catch(error){return {isError:true,content:[{type:'text',text:error instanceof Error?error.message:'Approval/execution failed.'}]};}
    });
    return server;
  };
}
