# Estado do turno — 29/08/2026, 12:31Z (backend)

Escrito para sobreviver ao reinício do meu contexto. Ordem: o que está no ar,
o que está pendente, e o que **não** deve ser feito sem entender antes.

## No ar agora

- **v180** na máquina (`fly status`, não `fly releases`) desde 13:08:14Z.
- **Scheduler DESLIGADO** (`INTERNAL_SCHEDULER=0`) desde **12:23:52Z**, por ordem
  do cérebro: a dona não conseguia usar o app e o sync competia com ela.
- **Coletor de métricas desligado** (`METRICS_PORT=-1`) desde ~02:59Z.
- Canais configurados em `SCHEDULER_CANAIS=shopee-sync,mercado-livre-sync,tiktok-sync,amazon-sync`
  (sem efeito enquanto o scheduler estiver desligado).

## O que subiu nesta madrugada/manhã

| Commit | O quê |
|---|---|
| `0ddc01d` | **Uma renovação de sessão em voo por vez** entre requisições (`supabase/renovacaoUnica.ts`) — conserto do 409 que trancou a dona para fora |
| `09ff22a` | **Erro de sistema para de culpar a usuária** nas três telas (login, TikTok, isolamento) |
| `3cc74c6` | Pools separados (usuário 8 / fundo 3) + intervalo por canal medido — ADR-030 |
| `1803543` | Varredura cobre evento `pending` velho + a rede de segurança se anuncia |
| `9790f9a` | Raspagem de métricas não empilha |
| `0a5c722` | `statement_timeout` de 120s por variável |
| `900b775` | Middleware para de responder `/api/health` por atalho |
| `56fb68e` | Health toca o banco e devolve 503 |

## ⚠️ Pendências abertas, em ordem de gravidade

1. **A separação de pools pode ser meia-solução.** Hipótese do cérebro, ainda
   **não derrubada nem confirmada**: os dois pools do app saem pelo **mesmo
   Supavisor** (15 slots para o projeto inteiro). A separação impede o fundo de
   roubar slot *no app*, mas não *no pooler*, que é um andar acima. Isso
   explicaria por que voltou de manhã com carga real sem ter voltado às 4h com
   carga mínima. **Se confirmado, é correção do ADR-030, não nota de rodapé.**
2. **O `statement_timeout` de 120s não está limitando a ETAPA.** Duas evidências:
   `tiktok-sync: HTTP 200 em 129s` e `shopee-sync: HTTP 200 em 170s`. Ou a etapa
   é feita de muitas consultas curtas (e o teto por consulta protege muito menos
   do que contamos), ou o teto não pega naquele caminho. **Descobrir qual — não
   adivinhar.**
3. **Pedido ao painel da Supabase:** o cérebro vai pedir à dona subir o
   `pool_size` de **15 → 30**. `max_connections` é 60 e usava 21, então há folga
   física. Falta minha leitura de risco.
4. **O lote da variação (ADR-029) está NO AR sem o backfill.** Catálogo Shopee
   com **739 linhas, 367 compostas**; itens de pedido com **401 de 22.589**
   compostos. Join hoje: **83 de 85** casam. Aconteceu porque o commit foi para
   a `main` e todo deploy posterior o levou. **Não desfazer sem análise** — o
   cérebro pediu primeiro saber quais são os **2 casos que não casam**.
5. **207+ eventos do ML em `pending`** drenando a 10 por ciclo — mas o scheduler
   está desligado, então **não estão drenando agora**.
6. **Alerta da Shopee** ("abnormal behavior") aberto contra o app — investigação
   interrompida pela emergência do auth. O que já se sabe: `fencedShopeeExternalRead`
   verifica o lease **antes** da chamada externa, então durante a queda do banco
   provavelmente **não** houve chamada. Falta a contagem por endpoint/hora.

## Não faça sem entender

- **Não religue o scheduler** sem decidir *como* — a resposta provavelmente não é
  "religar igual": é menos etapas simultâneas e etapa de fundo que não dure 170s.
- **Não mexa na guarda de isolamento.** Ela fechar quando não consegue verificar
  é o comportamento **certo**; o defeito era a mensagem, e já foi corrigido.
- **Não afrouxe o `statement_timeout` por reflexo** se o sync começar a morrer:
  escrita que precisa de mais de 2 minutos é problema por si só.

## Lições do turno que ainda não estão escritas no ADR-017

- **A décima:** quando o mesmo sintoma aparece em subsistemas que não se
  conhecem, a causa não está em nenhum deles — está no **padrão que os chama**.
  28 transações brigando por 15 slots; N renovações brigando por 1 refresh token.
  O defeito é **a tela pedir N vezes o que precisava pedir uma**.
- **As três telas eram um defeito só:** o tratamento de erro não separava "falha
  nossa" de "problema dela" e, no escuro, escolhia sempre a versão que a culpa —
  em dois casos oferecendo uma ação que piora.
