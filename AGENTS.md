# Convenções de interface — Organiza Isso

## Tamanho de popups e bottom sheets

**Regra obrigatória para novas implementações e alterações:** modais, popups de detalhes e bottom sheets que mostram informações variáveis (atividades, descrições, listagens, prévias, participantes e afins) devem ter **dimensões estáveis para uma mesma resolução e estado de interação**, independentemente de o conteúdo ser curto ou longo.

- Nunca deixar o texto determinar a altura total da janela usando apenas `height: auto`.
- Usar altura definida ou limitada por `dvh`/`VisualViewport` em cada breakpoint, com `min-height: 0` e `overflow-y: auto` na região de conteúdo ou descrição.
- Cabeçalho, controle de fechar e rodapé de ações devem permanecer acessíveis; rolagem acontece no texto/lista, sem aumentar a janela.
- No mobile, respeitar safe areas e o teclado virtual Android/iOS. Recalcular contra `VisualViewport` quando houver campos de texto.
- Uma expansão **acionada explicitamente pelo usuário** (como a alça do compartilhamento) pode alternar entre dois tamanhos definidos, sem depender da quantidade de informação.
- Exceção: diálogos breves com informação fixa, como confirmação simples ou alerta, podem ter altura ajustada ao conteúdo.

## Referências atuais

- Detalhes de atividade: modelo em `card-popup.html`, largura desktop 640 px, altura desktop 560 px (limitada à viewport); no celular, folha de altura 92dvh. A descrição deve rolar internamente.
- Compartilhamento: desktop 880 × 640 px (limitado à viewport); mobile altura compacta previsível `min(80dvh, 620px)`, com opção de expansão voluntária pela alça. A prévia/lista rola internamente.
- Para testar: comparar a geometria da mesma popup com conteúdo curto e longo na **mesma resolução**; o tamanho externo deve permanecer igual e os botões não podem ficar encobertos.

Preserve funcionalidades, permissões, filtros e integração com o Supabase ao alterar o layout.
