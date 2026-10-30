import assert from "node:assert/strict";
import handler from "../api/mcp.js";
import metadata from "../api/mcp/oauth-protected-resource.js";

function invoke(fn, method, body, headers = {}) {
  const res = {
    statusCode: 200, headers: {}, data: null,
    setHeader(k,v) { this.headers[k]=v; return this; },
    status(c) { this.statusCode=c; return this; },
    json(v) { this.data=v; return this; },
    end() { return this; }
  };
  return Promise.resolve(fn({ method, body, headers }, res)).then(() => res);
}

const base = { jsonrpc: "2.0", id: 1 };
const init = await invoke(handler, "POST", {...base, method: "initialize", params: {}});
assert.equal(init.statusCode, 200);
assert.equal(init.data.result.serverInfo.name, "organiza-isso");

const tools = await invoke(handler, "POST", {...base, method: "tools/list"});
assert.equal(tools.statusCode, 200);
assert.equal(tools.data.result.tools.length, 6);
assert.ok(tools.data.result.tools.every(t => t.securitySchemes?.[0]?.type === "oauth2"));

const request = {...base, method: "tools/call", params: {name:"listar_atividades",arguments:{}}};
const missing = await invoke(handler, "POST", request);
assert.equal(missing.statusCode, 200);
assert.equal(missing.data.result.isError, true);
assert.match(missing.headers["WWW-Authenticate"], /resource_metadata/);
assert.ok(missing.data.result._meta["mcp/www_authenticate"][0].includes("error_description"));

const invalid = await invoke(handler, "POST", request, {authorization: "Bearer invalido"});
assert.equal(invalid.statusCode, 200);
assert.equal(invalid.data.result.isError, true);
assert.ok(invalid.data.result._meta["mcp/www_authenticate"]);

const notAllowed = await invoke(handler, "GET", null);
assert.equal(notAllowed.statusCode, 405);

const resource = await invoke(metadata, "GET");
assert.equal(resource.statusCode, 200);
assert.equal(resource.data.authorization_servers.length, 1);
assert.match(resource.data.resource, /^https:\/\//);
console.log("MCP smoke OK: public discovery, OAuth tool schemas, auth challenge, protected resource.");
