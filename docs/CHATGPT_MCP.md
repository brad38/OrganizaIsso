# Integração Organiza Isso (ChatGPT e Claude)

Servidor remoto MCP: `https://organizaisso.vercel.app/api/mcp`.

## Ferramentas
- Consultas: `listar_atividades`, `listar_grupos`, `listar_pessoas`, `listar_notificacoes`.
- Preparação de gravações: `preparar_atividade`, `preparar_conclusao`.
- Execução após aprovação externa: `confirmar_acao`.

## Aprovação obrigatória em duas etapas
1. O assistente verifica dados obrigatórios e modalidade; não salva atividades nem conclusões.
2. A proposta é armazenada em `mcp_pending_actions` com usuário, prazo de 20 minutos e resumo imutável (não existe permissão UPDATE para usuários).
3. O assistente entrega `https://organizaisso.vercel.app/confirm-action.html?id=<UUID>`.
4. O usuário entra no site com **a mesma conta**, lê os detalhes e clica em Autorizar.
5. O assistente chama `confirmar_acao`; `execute_mcp_pending_action` valida aprovação, propriedade e prazo e executa a ação em transação atômica. A proposta só é executada uma vez.
6. Se não aprovada, a chamada apenas retorna que aguarda aprovação. Não existe mais atalho `confirmado: true`.

## Colegas sem conta
- `preparar_conclusao` compara nomes informados com `user_directory`.
- Nomes sem cadastro causam pergunta explícita: incluir na Descrição personalizada (opcional)?
- Somente após o sim os nomes são incluídos em `private_activity_works.custom_description`.
- Sem dupla/grupo cadastrado, somente a conclusão da própria pessoa pode ser marcada e apenas se ela aceitar claramente esse fallback.
- Nunca criar contas ou atribuir conclusão a quem não tem conta. Nomes parecidos/duplicados exigem seleção de ID.

## Push de novas atividades
- Trigger `trg_notify_new_activity` em `activities` gera mensagem `new_activity` para perfis cadastrados (somente INSERT).
- O trigger existente em `user_notifications` encaminha para `send-web-push`; somente usuários com assinatura push ativa recebem notificação no celular.
- Validado em transação revertida: nenhuma atividade nem notificação de teste ficou no banco.
- A entrega real ao aparelho deve ser verificada no próximo cadastro real. A funcionalidade do aparelho exige permissão push ativa.

## Segurança e testes
- MCP usa token OAuth do próprio usuário com Supabase RLS, não chave administrativa.
- As RPCs de conclusão e criação seguem validando permissões e participações existentes.
- `node --env-file=.env.local scripts/mcp-smoke.mjs` exercita fluxo de entrada, obrigatoriedade e colegas sem cadastro.
- Clientes Claude e ChatGPT usam o mesmo servidor. Após atualizar, reconecte/recarregue o MCP para ver as novas ferramentas.

Referências:
- https://supabase.com/docs/guides/database/postgres/row-level-security
- https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization
