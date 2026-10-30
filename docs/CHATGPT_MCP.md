# Integração Organiza Isso ↔ ChatGPT (MCP)

## Estado
- Servidor MCP HTTP criado em `api/mcp.js` (deploy Vercel: `/api/mcp`).
- Ferramentas: `listar_atividades`, `listar_grupos`, `listar_pessoas`, `listar_notificacoes`, `criar_atividade`, `concluir_atividade`.
- Acesso **sempre autenticado por JWT da conta do Organiza Isso**. Nunca usa chave `service_role`.
- Criação exige papel `owner`, `admin` ou `editor`, validado pelo banco. Conclusões em grupo e dupla reutilizam os procedimentos existentes de segurança.
- Escritas exigem `confirmado: true` após confirmação explícita do usuário.
- Testes básicos: `node --env-file=.env.local scripts/mcp-smoke.mjs`.

## Pendente para funcionar em ChatGPT Plus
1. **Disponibilizar o host do plugin no ChatGPT Sites.** A ferramenta de publicação do Sites não está conectada nesta sessão. A existência de `/api/mcp` por si só não cria um plugin instalável no Plus.
2. **Habilitar OAuth 2.1 Server no Supabase (dashboard > Authentication > OAuth Server)**. No momento a URL de descoberta OAuth do projeto responde 404.
3. Configurar uma tela de consentimento OAuth no domínio Organiza Isso e o caminho de autorização na configuração do Supabase.
4. Testar login por conta existente, expiração e renovação dos tokens, limites de autorização e tentativas sem permissão.
5. Publicar/instalar o plugin no ChatGPT Sites e validar ferramentas de leitura/escrita com uma conta de teste.

## Segurança
- Não colocar tokens, senhas, publishable keys ou service_role nos arquivos do plugin.
- Não distribuir o endpoint como MCP anônimo; POST em `/api/mcp` exige `Authorization: Bearer <token Supabase Auth>` para `tools/list` e `tools/call`.
- Não conceder ao modelo acesso à função administrativa `execute_sql` do Supabase.
- Nunca usar a conta do proprietário para executar ações de outros usuários.
- Em ações de grupo/dupla, confirmar IDs antes da escrita; nunca supor que dois nomes parecidos identificam a mesma pessoa.
- Após habilitar OAuth, configurar a descoberta OAuth do recurso MCP e testar no cliente final. A existência de um JWT válido não substitui essa etapa.

Referências:
- https://supabase.com/docs/guides/auth/oauth-server/getting-started
- https://help.openai.com/en/articles/20001547-hosting-a-plugin-with-chatgpt-sites
- https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization
