import { validateOperation, operationUrl } from "./catalog.mjs";
async function responseJson(response,limit=24*1024*1024){
  const declared=Number(response.headers.get('content-length'));
  if(declared>limit){await response.body?.cancel();throw new Error('Morning response exceeded the size limit.');}
  if(!response.body)return null;
  const chunks=[];let size=0;
  for await(const chunk of response.body){size+=chunk.byteLength;if(size>limit)throw new Error('Morning response exceeded the size limit.');chunks.push(Buffer.from(chunk));}
  const text=Buffer.concat(chunks,size).toString('utf8');
  if(!text)return null;
  try{return JSON.parse(text);}catch{throw new Error('Morning returned an unexpected response. Check the operation in Morning.');}
}
class Morning {
  env;
  connection;
  token = "";
  expires = 0;
  authenticationPromise = null;
  constructor(connection) {
    this.connection = connection;
    this.env = connection.environment;
  }
  async authenticate() {
    if (this.token && this.expires > Date.now() + 6e4) return;
    if(!this.authenticationPromise)this.authenticationPromise=this.obtainToken().finally(()=>{this.authenticationPromise=null;});
    await this.authenticationPromise;
  }
  async obtainToken(){
    const host = this.env === "production" ? "https://api.morning.co" : "https://api.sandbox.morning.dev";
    const r = await fetch(`${host}/idp/v1/oauth/token`, { method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15e3), body: JSON.stringify({ grant_type: "client_credentials", client_id: this.connection.id, client_secret: this.connection.secret }) });
    if (!r.ok){
      const error=await responseJson(r,32768).catch(()=>null);
      const reasons={invalid_client:'Check the API key ID and secret.',invalid_grant:'The API key is expired, revoked, or still awaiting approval.',unauthorized_client:'Check that the Morning subscription includes API access.'};
      throw new Error(`Morning authentication failed (${r.status}). ${reasons[error?.error]??'Check API access and credentials.'}`);
    }
    const data = await responseJson(r,32768);
    if (typeof data?.accessToken !== "string"||!data.accessToken||data.accessToken.length>16384||/[\r\n]/.test(data.accessToken)||!Number.isFinite(data.expiresAt)||data.expiresAt*1000<=Date.now()) throw new Error("Unexpected Morning authentication response.");
    this.token = data.accessToken;
    this.expires = Math.min(data.expiresAt*1000,Date.now()+50*6e4);
  }
  async call(id, parameters = {}, body) {
    const { operation: o } = validateOperation(id, parameters, body), url = operationUrl(o, this.env, parameters);
    const headers = { "Content-Type": "application/json" };
    if (o.host !== "reference") {
      await this.authenticate();
      headers.Authorization = `Bearer ${this.token}`;
    }
    const r = await fetch(url, { method: o.method, headers, ...body === void 0 ? {} : { body: JSON.stringify(body) }, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(3e4) });
    if (!r.ok){if(r.status===401){this.token='';this.expires=0;}throw new Error(`Morning returned HTTP ${r.status}. No automatic retry was performed.`);}
    if (r.status === 204) return { completed: true };
    return await responseJson(r)??{completed:true};
  }
  read(id, parameters = {}, body) {
    if (validateOperation(id, parameters, body).operation.mode !== "read") throw new Error("This write operation requires a prepared request and chat approval before execution.");
    return this.call(id, parameters, body);
  }
  searchClients(name, page = 1) {
    return this.read("searchClients", {}, { name, page, pageSize: 25 });
  }
  getClient(id) {
    return this.read("getClient", { id });
  }
  searchDocuments(filters) {
    return this.read("searchDocuments", {}, { ...filters, pageSize: 25 });
  }
  getDocument(id) {
    return this.read("getDocument", { id });
  }
  getExpense(id){return this.read('getExpense',{id});}
  links(id) {
    return this.read("getDocumentDownloadLinks", { id });
  }
  types() {
    return this.read("getDocumentTypes");
  }
  info(type) {
    return this.read("getDocumentInformation", { type });
  }
  searchExpenses(page = 1) {
    return this.read("searchExpenses", {}, { page, pageSize: 25 });
  }
  expenseDrafts(page = 1) {
    return this.read("searchExpenseDrafts", {}, { page, pageSize: 25 });
  }
  preview(payload) {
    return this.read("addPreviewDocument", {}, payload);
  }
  // Internal write helper; prepared-content checks and a persistent claim gate execution.
  issue(payload) {
    return this.call("addDocument", {}, payload);
  }
  async uploadExpense(bytes, name, type, expenseId) {
    const signingHost = this.env === "production" ? "https://api.morning.co" : "https://api.sandbox.d.greeninvoice.co.il";
    await this.authenticate();
    const endpoint = new URL(`${signingHost}/file-upload/v1/url`);
    endpoint.searchParams.set("context", "expense");
    endpoint.searchParams.set("data", JSON.stringify(expenseId ? { id: expenseId, source: 5, state: "expense" } : { source: 5 }));
    const r = await fetch(endpoint, { headers: { Authorization: `Bearer ${this.token}`, "Content-Type": "application/json" }, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15e3) });
    if (!r.ok) throw new Error(`Morning upload preparation failed (${r.status}).`);
    const signed = await responseJson(r,256*1024);
    const url = new URL(signed.url);
    if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443") || !/^(s3[.-][a-z0-9.-]+\.amazonaws\.com|[a-z0-9.-]+\.s3[.-][a-z0-9.-]+\.amazonaws\.com)$/.test(url.hostname)) throw new Error("Morning returned an unexpected storage host.");
    if (!Number.isSafeInteger(signed.maxFileSize)||signed.maxFileSize<=0||bytes.byteLength > signed.maxFileSize) throw new Error("File exceeds Morning's upload limit.");
    if(!signed.fields||typeof signed.fields!=='object'||Array.isArray(signed.fields)||!Object.keys(signed.fields).length||Object.entries(signed.fields).some(([key,value])=>key.toLowerCase()==='file'||typeof value!=='string'))throw new Error('Morning returned invalid upload fields.');
    const form = new FormData();
    for (const [key, value] of Object.entries(signed.fields)) form.append(key, value);
    form.append("file", new Blob([new Uint8Array(bytes)], { type }), name);
    const uploaded = await fetch(url, { method: "POST", body: form, redirect: "error", signal: AbortSignal.timeout(45e3) });
    if (!uploaded.ok) throw new Error(`Morning file upload returned HTTP ${uploaded.status}.`);
    return { uploaded: true, processing: "pending", ...expenseId ? { expenseId } : {}, message: expenseId ? "File submitted to Morning for attachment to the approved expense. Processing is not yet verified." : "Morning will process this file into an expense draft. Review and finish recording it in Morning.", environment: this.env };
  }
}
export {
  Morning
};
