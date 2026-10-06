import { validateOperation, operationUrl } from "./catalog.mjs";
class Morning {
  env;
  connection;
  token = "";
  expires = 0;
  constructor(connection) {
    this.connection = connection;
    this.env = connection.environment;
  }
  async authenticate() {
    if (this.token && this.expires > Date.now() + 6e4) return;
    const host = this.env === "production" ? "https://api.morning.co" : "https://api.sandbox.morning.dev";
    const r = await fetch(`${host}/idp/v1/oauth/token`, { method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15e3), body: JSON.stringify({ grant_type: "client_credentials", client_id: this.connection.id, client_secret: this.connection.secret }) });
    if (!r.ok) throw new Error(`Morning authentication failed (${r.status}). Check API access and credentials.`);
    const data = await r.json();
    if (typeof data.accessToken !== "string") throw new Error("Unexpected Morning authentication response.");
    this.token = data.accessToken;
    this.expires = Number(data.expiresAt) * 1e3 || Date.now() + 50 * 6e4;
  }
  async call(id, parameters = {}, body) {
    const { operation: o } = validateOperation(id, parameters, body), url = operationUrl(o, this.env, parameters);
    const headers = { "Content-Type": "application/json" };
    if (o.host !== "reference") {
      await this.authenticate();
      headers.Authorization = `Bearer ${this.token}`;
    }
    const r = await fetch(url, { method: o.method, headers, ...body === void 0 ? {} : { body: JSON.stringify(body) }, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(3e4) });
    if (!r.ok) throw new Error(`Morning returned HTTP ${r.status}. No automatic retry was performed.`);
    if (r.status === 204) return { completed: true };
    const text = await r.text();
    if (!text) return { completed: true };
    try {
      return JSON.parse(text);
    } catch {
      throw new Error("Morning returned an unexpected response. Check the operation in Morning.");
    }
  }
  read(id, parameters = {}, body) {
    if (validateOperation(id, parameters, body).operation.mode !== "read") throw new Error("This operation requires owner approval.");
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
  // Internal write helper; native confirmation and a persistent claim gate execution.
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
    const signed = await r.json();
    const url = new URL(signed.url);
    if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443") || !/^(s3[.-][a-z0-9.-]+\.amazonaws\.com|[a-z0-9.-]+\.s3[.-][a-z0-9.-]+\.amazonaws\.com)$/.test(url.hostname)) throw new Error("Morning returned an unexpected storage host.");
    if (typeof signed.maxFileSize !== "number" || bytes.byteLength > signed.maxFileSize) throw new Error("File exceeds Morning's upload limit.");
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
