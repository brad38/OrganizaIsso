# Integração Organiza Isso (ChatGPT e Claude)

Servidor MCP: `https://organizaisso.vercel.app/api/mcp`.

## Ferramentas
- Consultas: `listar_atividades`, `listar_grupos`, `listar_pessoas`, `listar_notificacoes`, `verificar_permissao_cadastro`.
- Preparação: `preparar_atividade`, `preparar_edicao`, `preparar_conclusao`.
- Execução: `confirmar_acao`, com `proposta_id` e `confirmado_na_conversa: true` depois de confirmação explícita da pessoa.

## Confirmação na própria conversa (sem abrir outra aba)
1. O assistente verifica as permissões da conta OAuth quando necessário e reúne os dados.
2. Uma das ferramentas `preparar_*` valida e cria uma proposta da conta, com resumo e expiração de 20 minutos. Nenhum dado da atividade é gravado.
3. O assistente apresenta o resumo completo **na conversa** e pergunta se a pessoa confirma aquela operação específica.
4. Se a resposta for negativa, ambígua ou inexistente, **não executa**. Se a pessoa confirmar explicitamente na conversa, o assistente chama `confirmar_acao` com o ID da proposta e `confirmado_na_conversa: true`.
5. O MCP registra a aprovação da proposta por meio da RPC do próprio usuário e executa a RPC aplicável; o banco verifica propriedade, prazo, permissões e impede repetir a mesma gravação.
6. O assistente só comunica sucesso quando a resposta for `sucesso: true`, e consulta a atividade novamente quando apropriado.

**Nota de segurança:** a confirmação na conversa é afirmada pelo cliente MCP, não comprovada independentemente pelo banco por meio de outra interface. Assim, o controle depende de o assistente respeitar a resposta do usuário. A proteção OAuth/RLS e as permissões do banco permanecem ativas. É uma troca deliberada de conveniência por uma aprovação menos independente.

A página antiga `confirm-action.html` pode continuar acessível para propostas anteriores, mas não faz parte do fluxo novo e não deve ser enviada pelo assistente.

## Regras mantidas
- Cadastro e edição globais exigem papel `owner`, `admin` ou `editor`. Sempre consultar `verificar_permissao_cadastro` antes de pedir campos.
- Edição conserva o ID, modalidade, prazo, pontuação e participantes; nunca cria atividade duplicada.
- Conclusões em dupla/grupo conferem IDs reais. Para colegas sem conta, perguntar antes de anotar nomes na Descrição personalizada (opcional); nunca criar membros fictícios.
- A função `trg_notify_new_activity` gera avisos quando uma nova atividade é cadastrada. Push depende de inscrição válida no dispositivo.

## Testes
- `node --env-file=.env.local scripts/mcp-smoke.mjs` testa a descoberta do MCP, permissão, propostas, confirmação ausente/afirmativa, edição e conclusão.
- Claude e ChatGPT usam o mesmo servidor MCP; após atualizar a versão, abra conversa nova para recarregar ferramentas.
