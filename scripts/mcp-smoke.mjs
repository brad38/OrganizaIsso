import assert from "node:assert/strict";
import handler from "../api/mcp.js";

function invoke(method, body, headers = {}) {
  const res = {
    statusCode: 200, headers: {}, data: null,
    setHeader(k,v) { this.headers[k]=v; return this; },
    status(c) { this.statusCode=c; return this; },
    json(v) { this.data=v; return this; },
    end() { return this; }
  };
  return Promise.resolve(handler({ method, body, headers }, res)).then(() => res);
}

const base = { jsonrpc: "2.0", id: 1 };
const init = await invoke("POST", {...base,method:"initialize",params:{}});
assert.equal(init.statusCode, 200);
assert.equal(init.data.result.serverInfo.name, "organiza-isso");
assert.equal(init.data.result.capabilities.tools.listChanged, false);
const missing = await invoke("POST", {...base,method:"tools/list"});
assert.equal(missing.statusCode, 401);
assert.ok(missing.headers["WWW-Authenticate"]);
const invalid = await invoke("POST", {...base,method:"tools/list"}, {authorization:"Bearer invalido"});
assert.equal(invalid.statusCode, 401);
const notAllowed = await invoke("GET", null);
assert.equal(notAllowed.statusCode, 405);
console.log("MCP smoke: initialize, unauthorized, invalid token, method guard OK");
