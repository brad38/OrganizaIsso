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
  { name: "criar_atividade", title: "Cadastrar uma atividade", description: "AÇÃO DE ESCRITA. Cria uma atividade global. Somente contas owner/admin/editor podem cadastrar. Confirme explicitamente os dados com o usuário antes de chamar.", inputSchema: { type: "object", properties: { titulo: property("string", "Título da atividade"), disciplina: property("string", "Disciplina exatamente como cadastrada"), tipo: property("string", "Trabalho, Seminário, Prova ou Projeto", { enum: ["Trabalho", "Seminário", "Prova", "Projeto"] }), modalidade: property("string", "Modalidade", { enum: ["Individual", "Em dupla", "Em grupo"] }), prazo: property("string", "Data/hora ISO 8601 com offset explícito, por exemplo 2026-11-02T19:00:00-03:00"), pontos: property("number", "Pontuação da atividade, se houver"), descricao: property("string", "Descrição opcional"), confirmado: property("boolean", "Deve ser true somente depois de o usuário confirmar os dados") }, required: ["titulo", "disciplina", "tipo", "modalidade", "prazo", "confirmado"], additionalProperties: false } },
  { name: "concluir_atividade", title: "Marcar atividade como concluída", description: "AÇÃO DE ESCRITA. Marca conclusão individual, em dupla ou grupo, respeitando a modalidade original. Use listar_atividades, listar_pessoas ou listar_grupos para confirmar IDs e solicite autorização antes da ação.", inputSchema: { type: "object", properties: { atividade_id: property("string", "UUID exato da atividade"), parceiro_id: property("string", "UUID do colega, obrigatório apenas para Em dupla"), grupo_id: property("string", "UUID do grupo, obrigatório apenas para Em grupo"), confirmado: property("boolean", "Deve ser true depois da confirmação explícita da pessoa") }, required: ["atividade_id", "confirmado"], additionalProperties: false } }
];

function reply(id, result) { return { jsonrpc: "2.0", id, result }; }
function err(id, code, message) { return { jsonrpc: "2.0", id, error: { code, message } }; }
function textResult(data) { return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] }; }
function failure(message) { return { content: [{ type: "text", text: message }], isError: true }; }
function checkId(value, label) { if (!UUID.test(value || "")) throw new Error(label + " inválido."); }
function requireConfirmation(args) { if (args.confirmado !== true) throw new Error("Confirmação explícita do usuário é necessária antes de gravar."); }

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

  if (name === "criar_atividade") {
    requireConfirmation(args);
    const title = String(args.titulo || "").trim(), subject = String(args.disciplina || "").trim();
    if (!title || !subject || title.length > 180 || subject.length > 180) throw new Error("Título ou disciplina ausente/inválido.");
    if (!["Trabalho", "Seminário", "Prova", "Projeto"].includes(args.tipo)) throw new Error("Tipo inválido.");
    if (!["Individual", "Em dupla", "Em grupo"].includes(args.modalidade)) throw new Error("Modalidade inválida.");
    if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d)?(?:Z|[+-]\d\d:\d\d)$/.test(args.prazo) || !Number.isFinite(Date.parse(args.prazo))) throw new Error("Prazo precisa ter data e fuso horário explícitos.");
    if (args.pontos != null && (!Number.isFinite(args.pontos) || args.pontos < 0)) throw new Error("Pontuação inválida.");
    const { data: role, error: roleError } = await db.from("profiles").select("role").eq("id", id).single();
    if (roleError) throw roleError;
    if (!["owner", "admin", "editor"].includes(role?.role)) throw new Error("Sua conta não tem permissão para cadastrar atividades gerais.");
    const { data, error } = await db.rpc("save_activity_with_topic_links", {
      p_activity_id: null, p_title: title, p_subject: subject, p_type: args.tipo,
      p_modality: args.modalidade, p_due_at: args.prazo, p_additional_due_dates: [],
      p_points: args.pontos ?? null, p_description: args.descricao || null, p_topic_ids: []
    });
    if (error) throw error;
    return { sucesso: true, atividade_id: data, titulo: title, disciplina: subject };
  }

  if (name === "concluir_atividade") {
    requireConfirmation(args);
    checkId(args.atividade_id, "ID da atividade");
    const { data: activity, error: actError } = await db.from("activities").select("id,title,modality").eq("id", args.atividade_id).single();
    if (actError) throw actError;
    if (!activity) throw new Error("Atividade não encontrada.");
    if (activity.modality === "Individual") {
      if (args.parceiro_id || args.grupo_id) throw new Error("Conclusão individual não aceita dupla/grupo.");
      const { error } = await db.from("activity_completions").upsert(
        { user_id: id, activity_id: activity.id }, { onConflict: "user_id,activity_id", ignoreDuplicates: true }
      );
      if (error) throw error;
    } else if (activity.modality === "Em dupla") {
      if (args.grupo_id) throw new Error("Essa atividade é em dupla, não em grupo.");
      checkId(args.parceiro_id, "ID da dupla");
      const { error } = await db.rpc("complete_activity_with_partner", {
        p_activity_id: activity.id, p_partner_user_id: args.parceiro_id, p_completed: true
      });
      if (error) throw error;
    } else if (activity.modality === "Em grupo") {
      if (args.parceiro_id) throw new Error("Essa atividade é em grupo, não em dupla.");
      checkId(args.grupo_id, "ID do grupo");
      const { error } = await db.rpc("complete_activity_with_group", {
        p_activity_id: activity.id, p_team_id: args.grupo_id, p_completed: true
      });
      if (error) throw error;
    } else {
      throw new Error("Modalidade não reconhecida.");
    }
    return { sucesso: true, atividade_id: activity.id, titulo: activity.title, modalidade: activity.modality };
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

  // O cliente MCP precisa de um JWT de usuario emitido pelo Supabase OAuth 2.1.
  // Nunca aceite credenciais administrativas ou identidade recebida nos argumentos.
  const authChallenge = 'Bearer resource_metadata="https://organizaisso.vercel.app/api/mcp/oauth-protected-resource"';
  const match = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || "");
  if (!match) {
    res.setHeader("WWW-Authenticate", authChallenge);
    return res.status(401).json(err(request.id ?? null, -32001, "Autenticação necessária."));
  }
  const token = match[1].trim();
  const db = createClient(SUPABASE_URL, SUPABASE_KEY, {
    global: { headers: { Authorization: "Bearer " + token } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });
  const { data: auth, error: authError } = await db.auth.getUser(token);
  if (authError || !auth?.user || auth.user.is_anonymous) {
    res.setHeader("WWW-Authenticate", authChallenge);
    return res.status(401).json(err(request.id ?? null, -32001, "Sessão inválida."));
  }

  if (request.method === "initialize") return res.status(200).json(reply(request.id, {
    protocolVersion: VERSION, capabilities: { tools: { listChanged: false } },
    serverInfo: { name: "organiza-isso", version: "0.1.0" },
    instructions: "Ferramentas de atividade do Organiza Isso. Antes de ações de escrita, confirme IDs, prazo, grupo/dupla e solicite aprovação explícita."
  }));
  if (request.method === "ping") return res.status(200).json(reply(request.id, {}));
  if (request.method === "tools/list") return res.status(200).json(reply(request.id, { tools }));
  if (request.method === "tools/call") {
    const name = request.params?.name;
    const args = request.params?.arguments || {};
    if (!tools.some(tool => tool.name === name)) return res.status(200).json(err(request.id, -32602, "Ferramenta desconhecida."));
    try {
      const data = await run(name, args, db, auth.user);
      return res.status(200).json(reply(request.id, textResult(data)));
    } catch (e) {
      console.error("mcp tool error", name, e?.code || e?.message);
      return res.status(200).json(reply(request.id, failure(e?.message || "Erro ao executar ação.")));
    }
  }
  return res.status(200).json(err(request.id, -32601, "Método não suportado."));
}
