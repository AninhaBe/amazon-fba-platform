# Auditoria de empilhamento de avisos — quatro canais e a central

**Status:** inventário e medição. **Nada corrigido.** · **Data:** 01/09/2026

## Por que agora

Em dois dias estas telas ganharam declaração de base, marca de estimativa (no
agregado e na linha), sinalização de custo não cadastrado, pendências por canal,
a mensagem do NEXO e as faixas de estado. **Cada um entrou certo, um de cada
vez, e ninguém olhou o conjunto.**

## 1. Inventário — o que pede atenção hoje

### Faixas (largura inteira, antes do conteúdo)

| peça | gatilho | onde |
|---|---|---|
| `ConnectionBroken` | conexão caída ou expirada | Amazon, ML, Shopee, TikTok |
| `AvisoDeSyncInterrompido` | sync parou no meio | TikTok |
| `EstadoDoSync` | sync rodando / atrasado | ML |
| `NexoDoDia` | narração do dia existe | os quatro |
| `BriefingLead` | janela = 30 dias e faturamento > 0 | os quatro |
| `SincronizacaoCompleta` | primeira carga terminou | os quatro |

### Dentro dos cartões

| peça | gatilho | quantos por tela |
|---|---|---|
| `declaracaoDeBase` (`sub`) | base do lucro ≠ faturamento | 1–2 |
| `MarcaDeEstimativa` (agregado) | há pedido com tarifa estimada | 1 |
| `MarcaDeEstimativa` (linha) | a linha tem tarifa estimada | **1 por pedido** |
| `SinaisDoResultado` | até **3** sinais, sem limite | ver §2 |
| pendência "Cadastrar alíquota" | alíquota ausente | 2 (CTA + rodapé) |
| `AindaConsolidando` / janela do canal | dia ainda muda | por canal, na aba de Ads |

### A central

Disciplinada, e serve de referência: **uma** frase de alerta, escolhida por
prioridade (`detectarAlerta`), mais a narração. Não empilha.

## 2. A medição que mais importa: o MESMO aviso, repetido

`sinaisDoResultado()` devolve **até 3** sinais (custo não cadastrado, tarifa não
postada, pedido não conciliado). `SinaisDoResultado` renderiza **todos**, sem
corte. E a lista é passada para **vários cartões da mesma faixa**:

| tela | pontos que renderizam a MESMA lista | marcas visíveis no pior caso |
|---|---|---|
| Mercado Livre | 3 (`Lucro`, `Margem`, painel de baixo) | **9** |
| Shopee | 4 (`Resultado`, `Margem`, e dois no fluxo) | **12** |
| Amazon | 1 | 3 |
| TikTok | 1 | 3 |

Nove a doze marcas "⚠" dizendo **três coisas**. Não é excesso de informação: é a
mesma informação três ou quatro vezes, o que é pior — treina a pessoa a varrer a
faixa inteira sem ler nenhuma.

## 3. O pior caso REAL (não teórico)

Conta da Ana, hoje, no dashboard do **Mercado Livre**, período "Hoje":

1. `ConnectionBroken` — faixa (as conexões Amazon estão com token revogado; o ML
   cai no mesmo caminho quando a autorização expira);
2. `EstadoDoSync` — faixa;
3. `NexoDoDia` — faixa com a narração;
4. `BriefingLead` — frase de abertura;
5. `SincronizacaoCompleta` — faixa;
6. `declaracaoDeBase` no `sub` da Margem — *"sobre R$ X apurados de R$ Y"*;
7. **9 marcas** de `SinaisDoResultado` (3 sinais × 3 cartões);
8. pendência "Cadastrar alíquota", duas vezes;
9. na tabela de pedidos: `MarcaDeEstimativa` **em cada linha estimada** — hoje,
   todo pedido do dia.

**Total antes do primeiro número: 5 faixas empilhadas.** Depois delas, 12
elementos pedindo atenção na faixa de KPIs. E a tabela abaixo marca cada linha.

⚠️ E note o que isso faz com a peça mais nova: a marca de estimativa foi
desenhada para **não** competir com alarme — tinta terciária, sem cor de aviso.
Ela cumpre a regra e mesmo assim desaparece, porque acima dela há cinco faixas e
nove "⚠". **A hierarquia não é propriedade de cada peça; é do conjunto.**

## 4. Hierarquia proposta — um de cada, no máximo

| categoria | o que é | quem entra hoje | regra |
|---|---|---|---|
| **ALARME** | pede ação dela, e ela pode agir agora | `ConnectionBroken`, custo não cadastrado, alíquota ausente | **1 por tela**, o de maior prioridade, com número e link |
| **INFORMAÇÃO** | muda como o número é lido, e não há o que fazer | `declaracaoDeBase`, `MarcaDeEstimativa`, tarifa não postada | **1 por número**, colada a ele — nunca em faixa |
| **PROGRESSO** | some sozinho | `SincronizacaoCompleta`, `EstadoDoSync`, `AvisoDeSyncInterrompido` | **1 por tela**, e some ao terminar |

Fora da hierarquia, por serem conteúdo e não aviso: `NexoDoDia` e `BriefingLead`
— são a leitura do dia, não um pedido de atenção. Mas ocupam o mesmo topo, e
entram na conta de quanto se atravessa antes do primeiro número.

### Os três cortes que a hierarquia implica

1. **`SinaisDoResultado` aparece UMA vez por tela**, não uma por cartão. Os
   sinais são do resultado, não de cada número — repeti-los não acrescenta
   informação nenhuma. (De 9–12 marcas para 3.)
2. **Alarme escolhido por prioridade, como a central já faz.** Conexão caída
   torna o resto irrelevante: sem dado, custo não cadastrado não é o problema
   dela.
3. **Progresso não divide espaço com progresso.** `EstadoDoSync` e
   `SincronizacaoCompleta` descrevem o mesmo eixo; duas faixas para isso é uma
   a mais.

## 5. O que eu NÃO proponho tocar

- a marca de estimativa **por linha** da tabela: ali ela qualifica *aquele*
  número e não tem substituto — a repetição é o ponto;
- a janela colada ao valor na aba de Ads: é a única defesa contra somar recortes
  diferentes;
- a central: já está no formato que as outras deveriam ter.
