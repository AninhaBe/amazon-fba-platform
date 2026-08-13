# Gate contínuo de saúde do SellerCore

Este gate detecta regressões assim que frentes concorrentes passam a coexistir. Ele
complementa testes unitários e smoke tests de deploy já documentados; não redefine a
arquitetura, as regras dos marketplaces nem o gate de cutover da migração.

## Quando executar

Execute o gate:

- imediatamente após integrar duas ou mais frentes no mesmo working tree;
- após resolver conflitos ou alterar contratos compartilhados (tipos, exports, modelos,
  componentes, rotas, autenticação, banco, cache ou conectores);
- novamente após corrigir uma regressão encontrada pelo próprio gate;
- antes de entregar um lote integrado para QA independente.

Testes isolados executados por devs ou subagents continuam úteis como evidência da
frente, mas não satisfazem este gate. A validação precisa usar o estado integrado real do
working tree.

## Camadas de validação

Registre separadamente cada camada realmente exercitada:

| Camada | O que comprova |
|---|---|
| **Local** | Build/compilação e aplicação integrada em `localhost:3000`, sem alegar sessão ou dado externo. |
| **Local autenticada** | Fluxos protegidos com sessão válida e isolamento do workspace no servidor local. |
| **Marketplace real** | Leitura real autorizada do canal, no ambiente indicado, sem mutação externa. Não equivale a produção. |
| **Produção** | Comportamento observado no domínio/serviço de produção; exige autorização específica para testar esse ambiente. |
| **Banco remoto** | Leitura/integração comprovada contra o banco remoto nomeado. Não deve ser inferida porque a UI abriu. |

Uma camada não comprovada deve aparecer como `BLOCKED` ou “não executada”, com motivo;
nunca como `PASS` presumido. Diferencie dados sintéticos, cache e resposta real do canal.

## Checklist integrado mínimo

### Aplicação em `localhost:3000`

- [ ] O comando de qualidade aplicável e o build/compilação terminam sem erro.
- [ ] O servidor inicia a partir do working tree integrado e permanece saudável durante
      o exercício; não basta o build estático.
- [ ] Não há erro de imports/exports, módulo ausente, chunk, hidratação ou exceção não
      tratada no terminal e no browser.
- [ ] As páginas e rotas alteradas carregam; navegação entre frentes integradas não
      quebra layout, estado, sessão ou contrato compartilhado.
- [ ] APIs internas afetadas respondem com status e shape esperados, incluindo caminhos
      autenticado, vazio, erro e indisponibilidade pertinentes.
- [ ] A integração entre mudanças é exercitada por um fluxo ponta a ponta representativo,
      não apenas por chamadas isoladas.

### TikTok Shop e Shopee

- [ ] `/tiktok` e `/shopee` carregam no estado integrado, inclusive seus estados honestos
      de desconectado, pendente, parcial ou sem cobertura quando aplicáveis.
- [ ] Com sessão e autorização legítimas disponíveis, os fluxos de leitura consomem dado
      real disponível e preservam `null ≠ 0`; cache, seed e fixture são identificados como
      tais na evidência.
- [ ] O exercício é estritamente read-only: não publicar/editar anúncio ou produto, não
      alterar estoque/preço/pedido, não disparar fulfillment, cancelamento, reembolso,
      mensagem, OAuth/revogação ou sync manual com efeito externo.
- [ ] Logs, screenshots e respostas são sanitizados: sem PII de comprador, tokens,
      cookies, secrets, authorization headers, URLs assinadas ou payloads completos
      desnecessários.
- [ ] Se credenciais, conexão real, whitelist, aprovação Go Live ou dado não estiverem
      disponíveis, marcar a etapa correspondente `BLOCKED`; isso não invalida o que
      passou localmente, mas impede alegar validação real daquele canal.

## Resultado e evidência mínima

Use um único resultado para cada execução:

- **PASS** — todos os itens aplicáveis passaram e cada camada alegada tem evidência.
- **FAIL** — houve quebra, regressão, resultado incorreto ou risco de segurança/privacidade.
  É bloqueante imediatamente.
- **BLOCKED** — não foi possível concluir por dependência externa ou acesso ausente. O
  motivo, o item afetado e o que ainda não foi comprovado devem ficar explícitos.

O registro mínimo contém:

1. data/hora, responsável, identificação do working tree (branch/commit quando houver) e
   frentes integradas;
2. comandos executados e seus exit codes, sem copiar segredos;
3. URL/rota e fluxo exercitados, status observado e camada de validação;
4. origem do dado (`sintético`, `cache`, `banco remoto` ou `marketplace real`), quando
   relevante;
5. resumo sanitizado de logs e, se útil, screenshot redigido;
6. resultado `PASS`, `FAIL` ou `BLOCKED`, bloqueios e responsável pelo próximo passo.

Evidência deve permitir reprodução sem armazenar PII ou segredo. “Testes passaram” sem
comandos, escopo e camadas não é evidência suficiente.

## Responsabilidades

| Papel | Responsabilidade |
|---|---|
| **Coordinator** | Identifica o momento de integração, nomeia o dono do gate, interrompe novas integrações em `FAIL` e delega a correção com prioridade bloqueante. |
| **Dev** | Entrega testes da frente, informa riscos/contratos alterados, corrige regressões atribuídas e fornece passos reproduzíveis. |
| **Frontend** | Valida páginas, navegação, runtime/hidratação, estados de carregamento/erro/vazio/parcial e ausência de PII no browser. |
| **QA** | Executa a avaliação independente final em escopo próprio; pode reutilizar evidências, mas não considerar o gate contínuo como substituto de QA. |

Quem integra pode acumular papéis, exceto que a aprovação de QA final deve continuar
independente. Em `FAIL`, o Coordinator registra a regressão, atribui correção ao Dev ou
Frontend adequado e exige uma nova execução integrada completa após o reparo — não
somente o teste que falhou.

## Limites de segurança

O gate não autoriza acesso novo, alteração de produção, escrita em marketplace ou banco,
uso de credencial de terceiros, deploy ou mudança de configuração. Ações que excedam a
autorização existente permanecem bloqueadas e devem ser reportadas como tal. Consulte o
[`padrão de proteção de dados pessoais`](./compliance/personal-information-protection-standard.md)
para tratamento de evidências e dados dos canais.
