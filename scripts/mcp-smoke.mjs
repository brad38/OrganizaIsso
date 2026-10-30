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
const init = await invoke(handler, "POST", {...base,method:"initialize",params:{}});
assert.equal(init.statusCode, 401);
assert.match(init.headers["WWW-Authenticate"], /resource_metadata/);

const missing = await invoke(handler, "POST", {...base,method:"tools/list"});
assert.equal(missing.statusCode, 401);

const invalid = await invoke(handler, "POST", {...base,method:"tools/list"}, {authorization:"Bearer invalido"});
assert.equal(invalid.statusCode, 401);

const notAllowed = await invoke(handler, "GET", null);
assert.equal(notAllowed.statusCode, 405);

const resource = await invoke(metadata, "GET");
assert.equal(resource.statusCode, 200);
assert.equal(resource.data.authorization_servers.length, 1);
assert.match(resource.data.resource, /^https:\/\//);
console.log("MCP smoke: OAuth challenge, invalid JWT, protected resource metadata OK");
