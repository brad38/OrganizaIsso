import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
const VERSION = "2025-06-18";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const property = (type, description, extra = {}) => ({ type, description, ...extra });

const tools = [
  { name: "listar_atividades", title: "Listar atividades", description: "Lista atividades e mostra quais estão concluídas pelo usuário autenticado. Use antes de marcar uma conclusão e para encontrar o ID correto.", inputSchema: { type: "object", properties: { busca: property("string", "Busca por título ou disciplina"), pendentes: property("boolean", "Se verdadeiro, retorna só atividades não concluídas"), limite: property("integer", "Quantidade máxima (1 a 100)", { minimum: 1, maximum: 100 }) }, additionalProperties: false } },
  { name: "listar_grupos", title: "Listar meus grupos", description: "Lista os grupos dos quais a conta participa ou é proprietária e seus identificadores para concluir atividades em grupo.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "listar_pessoas", title: "Listar colegas", description: "Lista usuários disponíveis para selecionar a dupla pelo nome e ID, sem presumir identidade quando nomes se repetem.", inputSchema: { type: "object", properties: { busca: property("string", "Nome a pesquisar") }, additionalProperties: false } },
  { name: "listar_notificacoes", title: "Minhas notificações", description: "Mostra as notificações da conta atual no Organiza Isso.", inputSchema: { type: "object", properties: { limite: property("integer", "Máximo de 50 notificações", { minimum: 1, maximum: 50 }) }, additionalProperties: false } },
  { name: "preparar_atividade", title: "Preparar cadastro", description: "Valida os campos obrigatórios e gera uma proposta para aprovação no site. NÃO cadastra nada. Depois que a pessoa aprovar no navegador, chame confirmar_acao.", inputSchema: { type: "object", properties: { titulo: property("string", "Título da atividade"), disciplina: property("string", "Disciplina"), tipo: property("string", "Tipo", { enum: ["Trabalho", "Seminário", "Prova", "Projeto"] }), modalidade: property("string", "Modalidade", { enum: ["Individual", "Em dupla", "Em grupo"] }), prazo: property("string", "Data/hora ISO com fuso explícito"), pontos: property("number", "Pontuação opcional"), descricao: property("string", "Descrição opcional") }, required: ["titulo", "disciplina", "tipo", "modalidade", "prazo"], additionalProperties: false } },
  { name: "preparar_conclusao", title: "Preparar conclusão", description: "Confere modalidade, colegas cadastrados e não cadastrados, prepara descrição personalizada e pede aprovação no site antes de registrar. NÃO conclui nada. Se houver pessoas sem conta, pergunte se os nomes devem entrar na descrição personalizada opcional e só então envie incluir_nomes_na_descricao. Pessoas sem conta nunca recebem conclusão como membros.", inputSchema: { type: "object", properties: { atividade_id: property("string", "UUID da atividade"), nomes_colegas: property("array", "Nomes informados pelo usuário para verificar cadastro", { items: { type: "string" } }), parceiro_id: property("string", "UUID do colega cadastrado para dupla"), grupo_id: property("string", "UUID do grupo existente"), incluir_nomes_na_descricao: property("boolean", "Resposta explícita do usuário sobre incluir nomes de pessoas sem cadastro na descrição opcional"), conclusao_apenas_minha: property("boolean", "Usuário concordou expressamente em registrar apenas sua própria conclusão quando dupla/grupo não pode ser vinculado"), descricao_personalizada: property("string", "Texto opcional do trabalho privado") }, required: ["atividade_id"], additionalProperties: false } },
  { name: "confirmar_acao", title: "Executar ação aprovada", description: "Somente executa uma proposta se a própria pessoa já clicou em Autorizar na página do Organiza Isso. Nunca chame sem explicar o link de aprovação. Não aceita confirmado=true ou dados de ação livres.", inputSchema: { type: "object", properties: { proposta_id: property("string", "UUID gerado pela ferramenta preparar_atividade ou preparar_conclusao") }, required: ["proposta_id"], additionalProperties: false } }
].map(tool => ({
  ...tool,
  securitySchemes: [{ type: "oauth2", scopes: [] }],
  annotations: {
    readOnlyHint: tool.name !== "confirmar_acao",
    destructiveHint: false,
    openWorldHint: false
  }
}));

const RESOURCE_METADATA_URL = "https://organizaisso.vercel.app/.well-known/oauth-protected-resource/api/mcp";
function authenticationChallenge(reason = "Autorização necessária para usar o Organiza Isso.") {
  return `Bearer resource_metadata="${RESOURCE_METADATA_URL}", error="invalid_token", error_description="${reason}"`;
}
function authToolError(message) {
  return {
    ...failure(message),
    _meta: { "mcp/www_authenticate": [authenticationChallenge()] }
  };
}

function reply(id, result) { return { jsonrpc: "2.0", id, result }; }
function err(id, code, message) { return { jsonrpc: "2.0", id, error: { code, message } }; }
function textResult(data) { return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] }; }
function failure(message) { return { content: [{ type: "text", text: message }], isError: true }; }
function checkId(value, label) { if (!UUID.test(value || "")) throw new Error(label + " inválido."); }
function clampText(value, max, label) {
  const result = String(value || "").trim();
  if (result.length > max) throw new Error(label + " é muito longo.");
  return result;
}
function approvalUrl(id) {
  return "https://organizaisso.vercel.app/confirm-action.html?id=" + encodeURIComponent(id);
}
async function prepare(db, userId, actionType, payload, summary) {
  const { data, error } = await db.from("mcp_pending_actions")
    .insert({ user_id: userId, action_type: actionType, payload, summary })
    .select("id,expires_at").single();
  if (error) throw error;
  return {
    estado: "AGUARDANDO_APROVACAO_NO_SITE",
    proposta_id: data.id,
    expira_em: data.expires_at,
    resumo: summary,
    url_para_aprovar: approvalUrl(data.id),
    instrucoes: "Abra a URL e clique em Autorizar no Organiza Isso. Depois volte ao chat e peça para confirmar a proposta. Ainda não foi salvo nada."
  };
}

async function validateCreation(args, db, id) {
  const title = clampText(args.titulo, 180, "Título");
  const subject = clampText(args.disciplina, 180, "Disciplina");
  if (!title || !subject) throw new Error("Informe título e disciplina.");
  if (!["Trabalho", "Seminário", "Prova", "Projeto"].includes(args.tipo))
    throw new Error("Informe o tipo: Trabalho, Seminário, Prova ou Projeto.");
  if (!["Individual", "Em dupla", "Em grupo"].includes(args.modalidade))
    throw new Error("Informe a modalidade: Individual, Em dupla ou Em grupo.");
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d)?(?:Z|[+-]\d\d:\d\d)$/.test(args.prazo || "") ||
      !Number.isFinite(Date.parse(args.prazo))) throw new Error("Informe data e horário completos com fuso.");
  if (args.pontos != null && (!Number.isFinite(args.pontos) || args.pontos < 0))
    throw new Error("Pontuação inválida.");
  const { data: role, error } = await db.from("profiles").select("role").eq("id", id).single();
  if (error) throw error;
  if (!["owner", "admin", "editor"].includes(role?.role))
    throw new Error("Sua conta não tem permissão para cadastrar atividades gerais.");
  const payload = {
    titulo: title, disciplina: subject, tipo: args.tipo, modalidade: args.modalidade,
    prazo: args.prazo, pontos: args.pontos ?? null,
    descricao: clampText(args.descricao, 4000, "Descrição") || null
  };
  return prepare(db, id, "create_activity", payload, {
    acao: "Cadastrar atividade", titulo: title, disciplina: subject, tipo: args.tipo,
    modalidade: args.modalidade, prazo: args.prazo, pontos: payload.pontos,
    descricao: payload.descricao,
    aviso: "Será cadastrada para os usuários do mural. O cadastro dispara uma notificação de nova atividade."
  });
}

async function prepareCompletion(args, db, id) {
  checkId(args.atividade_id, "Atividade");
  const { data: activity, error: actError } = await db.from("activities")
    .select("id,title,subject,modality").eq("id",args.atividade_id).single();
  if (actError) throw actError;
  const modality = activity.modality;
  const names = [...new Set(
    (Array.isArray(args.nomes_colegas) ? args.nomes_colegas : [])
      .map(n => clampText(n, 100, "Nome do colega")).filter(Boolean)
  )];
  if (names.length > 25) throw new Error("Informe no máximo 25 colegas.");
  const directory = names.length
    ? await db.from("user_directory").select("user_id,display_name").limit(200)
    : { data: [], error: null };
  if (directory.error) throw directory.error;
  const found = [], unknown = [];
  for (const name of names) {
    const matching = (directory.data || []).filter(row =>
      row.display_name.trim().toLocaleLowerCase("pt-BR") === name.toLocaleLowerCase("pt-BR"));
    if (matching.length > 1) return {
      estado: "ESCOLHER_PESSOA",
      mensagem: "Mais de uma conta tem o nome " + name + ". Use listar_pessoas e escolha o ID correto antes de continuar."
    };
    if (matching.length) {
      found.push({ nome: name, id: matching[0].user_id });
    } else {
      const term = name.toLocaleLowerCase("pt-BR");
      const candidates = (directory.data || []).filter(row => {
        const display = row.display_name.trim().toLocaleLowerCase("pt-BR");
        return display.includes(term) || term.includes(display);
      });
      if (candidates.length) return {
        estado: "ESCOLHER_PESSOA",
        mensagem: "O nome " + name + " pode corresponder a uma conta cadastrada. Confirme a identidade antes de tratar como pessoa sem cadastro.",
        candidatos: candidates.map(x => ({id:x.user_id, nome:x.display_name}))
      };
      unknown.push(name);
    }
  }
  if (unknown.length && typeof args.incluir_nomes_na_descricao !== "boolean") {
    return {
      estado: "AGUARDANDO_DECISAO_SOBRE_NOMES",
      pessoas_nao_cadastradas: unknown,
      pessoas_encontradas: found,
      pergunta: "Estas pessoas não estão no Organiza Isso: " + unknown.join(", ") +
        ". Deseja colocar os nomes na Descrição personalizada (opcional)?",
      instrucoes: "Pergunte ao usuário e só repita preparar_conclusao após receber sim ou não. Nenhum registro foi feito."
    };
  }

  let mode;
  let partnerId = args.parceiro_id || null, teamId = args.grupo_id || null;
  if (modality === "Individual") {
    if (partnerId || teamId || names.length) return {
      estado: "MODALIDADE_INDIVIDUAL",
      mensagem: "Esta atividade é individual. Confirme com o usuário que só sua própria conclusão será registrada, sem participantes."
    };
    mode = "individual";
  } else if (modality === "Em dupla") {
    if (teamId) throw new Error("Esta atividade é em dupla, não em grupo.");
    if (!partnerId && found.length === 1 && unknown.length === 0) partnerId = found[0].id;
    if (partnerId) {
      checkId(partnerId,"ID do parceiro");
      if (partnerId === id) throw new Error("Não é possível ser sua própria dupla.");
      const { data: peer, error } = await db.from("user_directory")
        .select("user_id,display_name").eq("user_id", partnerId).maybeSingle();
      if (error) throw error;
      if (!peer) throw new Error("O colega informado não está cadastrado.");
      if (found.some(x => x.id !== partnerId)) throw new Error("O colega cadastrado informado não corresponde ao parceiro selecionado.");
      mode = "pair";
    } else {
      if (!args.conclusao_apenas_minha) return {
        estado: "AGUARDANDO_DECISAO_SOBRE_CONCLUSAO_PESSOAL",
        mensagem: "Não existe dupla cadastrada selecionada. Posso registrar somente sua conclusão, mantendo a atividade como 'Em dupla' e anotando os nomes opcionais na sua Descrição personalizada?",
        instrucoes: "Se o usuário aceitar, chame novamente com conclusao_apenas_minha=true; isso não marca outras contas como concluídas."
      };
      mode = "personal_only";
    }
  } else if (modality === "Em grupo") {
    if (partnerId) throw new Error("Esta atividade é em grupo, não em dupla.");
    if (teamId) {
      checkId(teamId, "ID do grupo");
      const { data: teams, error } = await db.from("topic_teams")
        .select("id,name,owner_id").eq("id",teamId).maybeSingle();
      if (error) throw error;
      if (!teams) throw new Error("Grupo não encontrado.");
      const { data: membership, error: e2 } = await db.from("topic_team_members")
        .select("user_id,status").eq("team_id",teamId).eq("status","accepted");
      if (e2) throw e2;
      const members = new Set([teams.owner_id,...(membership || []).map(m=>m.user_id)]);
      if (!members.has(id)) throw new Error("Você não pertence a esse grupo.");
      if (found.some(x=>!members.has(x.id))) return {
        estado: "ESCOLHER_GRUPO",
        mensagem: "Uma pessoa cadastrada informada não integra esse grupo. Selecione o grupo correto ou peça para registrar somente a sua conclusão."
      };
      mode = "group";
    } else {
      if (!args.conclusao_apenas_minha) return {
        estado: "AGUARDANDO_DECISAO_SOBRE_CONCLUSAO_PESSOAL",
        mensagem: "Nenhum grupo cadastrado foi selecionado. Deseja registrar somente sua conclusão e anotar os colegas sem cadastro na Descrição personalizada (opcional)?",
        instrucoes: "Se o usuário aceitar, chame novamente com conclusao_apenas_minha=true; nenhum grupo será marcado como concluído."
      };
      mode = "personal_only";
    }
  } else throw new Error("Modalidade da atividade não reconhecida.");
  let note = clampText(args.descricao_personalizada, 1600, "Descrição personalizada");
  if (unknown.length && args.incluir_nomes_na_descricao === true) {
    note = [note, "Realizada com: " + unknown.join(", ") + " (sem cadastro no Organiza Isso)."]
      .filter(Boolean).join("\n");
  }
  if (note.length > 2000) throw new Error("Descrição personalizada excede 2000 caracteres.");
  const payload = {
    atividade_id: activity.id, modo: mode,
    parceiro_id: mode === "pair" ? partnerId : null,
    grupo_id: mode === "group" ? teamId : null,
    descricao_personalizada: note || null
  };
  return prepare(db, id, "complete_activity", payload, {
    acao: "Marcar atividade como concluída", atividade: activity.title,
    disciplina: activity.subject, modalidade: modality, modo_de_registro: mode,
    pessoas_cadastradas_encontradas: found.map(x=>x.nome),
    pessoas_sem_cadastro: unknown,
    nomes_incluidos_na_descricao: unknown.length > 0 && args.incluir_nomes_na_descricao === true,
    descricao_personalizada: note || null,
    aviso: mode === "personal_only"
      ? "Apenas sua conta será marcada como concluída. Não será criada dupla nem grupo fictício."
      : "Somente participantes reais e autorizados serão marcados conforme as regras do site."
  });
}


export { validateCreation, prepareCompletion };

async function run(name, args, db, user) {
  const id = user.id;
  if (name === "listar_atividades") {
    const limit = Math.min(100, Math.max(1, Number(args.limite || 30)));
    const { data, error } = await db.from("activities").select("id,title,subject,type,modality,due_at,additional_due_dates,points,description").order("due_at", { ascending: true }).limit(300);
    if (error) throw error;
    const { data: done, error: doneError } = await db.from("activity_completions").select("activity_id").eq("user_id", id);
    if (doneError) throw doneError;
    const ids = new Set((done || []).map(row => row.activity_id));
    const search = String(args.busca || "").trim().toLocaleLowerCase("pt-BR");
    return (data || []).filter(x =>
      (!args.pendentes || !ids.has(x.id)) &&
      (!search || (x.title + " " + x.subject).toLocaleLowerCase("pt-BR").includes(search))
    ).slice(0, limit).map(x => ({ ...x, concluida_por_mim: ids.has(x.id) }));
  }

  if (name === "listar_grupos") {
    const [{ data: owned, error: e1 }, { data: member, error: e2 }] = await Promise.all([
      db.from("topic_teams").select("id,name,owner_id").eq("owner_id", id),
      db.from("topic_team_members").select("team_id,status").eq("user_id", id).eq("status", "accepted")
    ]);
    if (e1 || e2) throw e1 || e2;
    const teamIds = [...new Set((member || []).map(row => row.team_id))];
    let joined = [];
    if (teamIds.length) {
      const { data, error } = await db.from("topic_teams").select("id,name,owner_id").in("id", teamIds);
      if (error) throw error;
      joined = data || [];
    }
    return [...new Map([...(owned || []), ...joined].map(row => [row.id, row])).values()];
  }

  if (name === "listar_pessoas") {
    let q = db.from("user_directory").select("user_id,display_name").limit(100);
    if (args.busca) q = q.ilike("display_name", "%" + String(args.busca).replace(/[%_,]/g, "") + "%");
    const { data, error } = await q;
    if (error) throw error;
    return (data || []).filter(row => row.user_id !== id);
  }

  if (name === "listar_notificacoes") {
    const limit = Math.min(50, Math.max(1, Number(args.limite || 20)));
    const { data, error } = await db.from("user_notifications").select("id,kind,message,read_at,created_at").eq("user_id", id).order("created_at", { ascending: false }).limit(limit);
    if (error) throw error;
    return data || [];
  }

  if (name === "preparar_atividade") {
    return validateCreation(args, db, id);
  }
  if (name === "preparar_conclusao") {
    return prepareCompletion(args, db, id);
  }
  if (name === "confirmar_acao") {
    checkId(args.proposta_id, "ID da proposta");
    const { data: proposal, error: readError } = await db.from("mcp_pending_actions")
      .select("id,expires_at,approved_at,consumed_at").eq("id",args.proposta_id).eq("user_id",id).maybeSingle();
    if (readError) throw readError;
    if (!proposal) throw new Error("Proposta não encontrada nesta conta.");
    if (proposal.consumed_at) return {estado:"JA_EXECUTADA",mensagem:"Essa proposta já foi executada."};
    if (new Date(proposal.expires_at).getTime() <= Date.now()) throw new Error("A proposta expirou. Prepare uma nova.");
    if (!proposal.approved_at) return {
      estado:"AGUARDANDO_APROVACAO_NO_SITE",
      url_para_aprovar:approvalUrl(proposal.id),
      mensagem:"Abra a URL, entre na sua conta e clique em Autorizar. Ainda não houve gravação."
    };
    const { data, error } = await db.rpc("execute_mcp_pending_action", { p_id: proposal.id });
    if (error) throw error;
    return data;
  }
  throw new Error("Ferramenta desconhecida.");
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Access-Control-Allow-Origin", "https://chatgpt.com");
  res.setHeader("Access-Control-Allow-Headers", "authorization,content-type,mcp-protocol-version,mcp-session-id");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST (MCP Streamable HTTP)" });
  if (!SUPABASE_URL || !SUPABASE_KEY) return res.status(503).json({ error: "Configuração do Supabase indisponível." });

  const request = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  if (!request || request.jsonrpc !== "2.0" || typeof request.method !== "string") return res.status(400).json(err(request?.id ?? null, -32600, "Invalid Request"));
  if (request.method === "notifications/initialized") return res.status(202).end();

  // Descoberta MCP nao pode exigir autenticacao: ChatGPT precisa conhecer as
  // ferramentas e securitySchemes antes de apresentar a conexao OAuth.
  if (request.method === "initialize") return res.status(200).json(reply(request.id, {
    protocolVersion: VERSION, capabilities: { tools: { listChanged: false } },
    serverInfo: { name: "organiza-isso", version: "0.3.0" },
    instructions: "Ações de escrita exigem confirmação explícita. Cada ferramenta requer login OAuth no Organiza Isso."
  }));
  if (request.method === "ping") return res.status(200).json(reply(request.id, {}));
  if (request.method === "tools/list") return res.status(200).json(reply(request.id, { tools }));
  if (request.method !== "tools/call") return res.status(200).json(err(request.id, -32601, "Método não suportado."));

  const name = request.params?.name;
  const args = request.params?.arguments || {};
  if (!tools.some(tool => tool.name === name)) return res.status(200).json(err(request.id, -32602, "Ferramenta desconhecida."));

  // As operações efetivas continuam protegidas pelo token do usuário.
  const match = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || "");
  if (!match) {
    res.setHeader("WWW-Authenticate", authenticationChallenge());
    return res.status(200).json(reply(request.id, authToolError("Conecte sua conta do Organiza Isso para continuar.")));
  }

  const token = match[1].trim();
  const db = createClient(SUPABASE_URL, SUPABASE_KEY, {
    global: { headers: { Authorization: "Bearer " + token } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });
  const { data: auth, error: authError } = await db.auth.getUser(token);
  if (authError || !auth?.user || auth.user.is_anonymous) {
    res.setHeader("WWW-Authenticate", authenticationChallenge());
    return res.status(200).json(reply(request.id, authToolError("A autorização expirou ou é inválida. Conecte novamente.")));
  }

  try {
    const data = await run(name, args, db, auth.user);
    return res.status(200).json(reply(request.id, textResult(data)));
  } catch (e) {
    console.error("mcp tool error", name, e?.code || e?.message);
    return res.status(200).json(reply(request.id, failure(e?.message || "Erro ao executar ação.")));
  }
}
