import assert from "node:assert/strict";
import handler, { validateCreation, prepareCompletion, resolveToolName } from "../api/mcp.js";
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
assert.equal(init.statusCode, 200);
assert.equal(init.data.result.serverInfo.version, "0.3.1");
const tools = await invoke(handler, "POST", {...base,method:"tools/list"});
assert.equal(tools.statusCode, 200);
assert.equal(tools.data.result.tools.length, 7);
assert.equal(resolveToolName("criar_atividade"), "preparar_atividade");
assert.equal(resolveToolName("concluir_atividade"), "preparar_conclusao");
assert.equal(resolveToolName("confirmar_acao"), "confirmar_acao");
const oldCreate = {...base, method:"tools/call", params:{
  name:"criar_atividade",
  arguments:{
    titulo:"Teste legado", disciplina:"Redes",tipo:"Trabalho",
    modalidade:"Em grupo",prazo:"2026-11-30T23:59:00-03:00",
    confirmado:true
  }
}};
const legacyAuthChallenge = await invoke(handler,"POST",oldCreate);
assert.equal(legacyAuthChallenge.statusCode,200);
assert.equal(legacyAuthChallenge.data.result.isError,true);
assert.match(legacyAuthChallenge.headers["WWW-Authenticate"],/resource_metadata/);
const oldCompletion = await invoke(handler,"POST",{
  ...base, method:"tools/call", params:{
    name:"concluir_atividade",arguments:{atividade_id:"22222222-2222-4222-8222-222222222222",confirmado:true}
  }
});
assert.equal(oldCompletion.statusCode,200);
assert.equal(oldCompletion.data.result.isError,true);
assert.match(oldCompletion.headers["WWW-Authenticate"],/resource_metadata/);
assert.equal(tools.data.result.tools.find(t=>t.name==="confirmar_acao").annotations.readOnlyHint,false);
assert.equal(tools.data.result.tools.find(t=>t.name==="criar_atividade"),undefined);
assert.ok(tools.data.result.tools.every(t => t.securitySchemes?.[0]?.type === "oauth2"));
const request = {...base, method:"tools/call",params:{name:"confirmar_acao",arguments:{proposta_id:"fake"}}};
const missing = await invoke(handler,"POST",request);
assert.equal(missing.data.result.isError,true);
assert.match(missing.headers["WWW-Authenticate"],/resource_metadata/);
const invalid = await invoke(handler,"POST",request,{authorization:"Bearer invalid"});
assert.equal(invalid.data.result.isError,true);
assert.equal((await invoke(metadata,"GET")).statusCode,200);

await assert.rejects(
  ()=>validateCreation({titulo:"Tarefa",disciplina:"Redes",tipo:"Trabalho",modalidade:"Em dupla"},null,"uid"),
  /Informe data e horário/
);

const id="11111111-1111-4111-8111-111111111111";
const activity="22222222-2222-4222-8222-222222222222";
let staged=null;
const db={
 from(table) {
  if(table==="activities") return { select:()=>({eq:()=>({
   single:async()=>({data:{id:activity,title:"Trabalho de Redes",subject:"Redes",modality:"Em dupla"},error:null})
  })})};
  if(table==="user_directory") return {select:()=>({limit:async()=>({data:[],error:null})})};
  if(table==="mcp_pending_actions")return {insert(row){staged=row;return {select:()=>({
   single:async()=>({data:{id:"33333333-3333-4333-8333-333333333333",expires_at:"2099-01-01T00:00:00Z"},error:null})
  })}}};
  throw new Error("unexpected table "+table);
 }
};
const initial={atividade_id:activity,nomes_colegas:["Fernanda Sem Conta"]};
const one=await prepareCompletion(initial,db,id);
assert.equal(one.estado,"AGUARDANDO_DECISAO_SOBRE_NOMES");
assert.equal(staged,null);
const two=await prepareCompletion({...initial,incluir_nomes_na_descricao:true},db,id);
assert.equal(two.estado,"AGUARDANDO_DECISAO_SOBRE_CONCLUSAO_PESSOAL");
assert.equal(staged,null);
const three=await prepareCompletion({...initial,incluir_nomes_na_descricao:true,conclusao_apenas_minha:true},db,id);
assert.equal(three.estado,"AGUARDANDO_APROVACAO_NO_SITE");
assert.equal(staged.payload.modo,"personal_only");
assert.match(staged.payload.descricao_personalizada,/Fernanda Sem Conta/);
assert.equal(staged.user_id,id);
assert.equal(staged.action_type,"complete_activity");
console.log("MCP smoke OK: discovery, OAuth, missing fields, unknown people, personal-only fallback, approval proposal.");
