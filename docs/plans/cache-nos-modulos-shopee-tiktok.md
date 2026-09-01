# Cache de período nos módulos de Shopee e TikTok — a história de invalidação

**Status:** desenho, aguardando aprovação. Nada implementado.
**Data:** 01/09/2026 · **Autor:** Vitrine (frontend)

## Por que a pergunta existe

`/ads` ganhou cache por período e antecipação por intenção, e o clique deixou de
pagar a ida (200 ms → 0, sem subir requisição). Os módulos de Shopee e TikTok
estão na **mesma forma** de `/ads` — não têm cache nenhum, então cada troca de
período refaz a ida e voltar a um período já visto paga de novo.

A pergunta não é se dá para cachear. É **quem invalida, quando, e o que a pessoa
vê no meio.** Porque o modo de errar aqui é pior que os 200 ms que se quer
economizar: *ela salva um custo, o cache não invalida, e ela conclui que não
gravou.*

## O que a tela faz hoje (medido no código, 01/09/2026)

1. **Salvar custo NÃO recarrega.** Pedido da dona em 29/08/2026: *"quero apenas
   digitar, salvar, sem ter nenhum carregamento a partir disso"*. O valor volta
   na resposta do próprio POST e sobe para o pai, que aplica o patch na tabela
   (`custosSalvos` + `custoExibido`). Uma requisição, e só uma.
2. **O patch vive enquanto a tela vive.** `custosSalvos` é estado de componente:
   sai da tela, morre.
3. **Não há cache.** Cada montagem busca. É isso que hoje faz o custo salvo
   reaparecer certo quando ela volta: a ida nova traz o valor do servidor.
4. **A alíquota é editada DENTRO do módulo**, e salvar a alíquota **já não
   atualiza a tabela** — o lucro e o imposto exibidos continuam os do payload
   anterior até a próxima montagem. É uma defasagem que já existe, e não foi
   introduzida por este desenho.

## Quem escreve, e onde cada um mora

| escritor | onde mora | invalida o quê |
|---|---|---|
| custo por linha | dentro da tela | a linha (hoje, por patch em memória) |
| alíquota da loja | dentro da tela | lucro e imposto de **todas** as linhas |
| sincronização de fundo | **fora**, no servidor | qualquer coisa, a qualquer hora |
| reconectar / trocar de loja | fora da tela | tudo daquela conexão |

Três dos quatro escritores estão fora do componente que teria o cache. É esse o
tamanho real do problema.

## Opção A — cache de escopo de MÓDULO (como Amazon, ML, central e `/ads`)

**Rejeitada.** Falha exatamente no caso que preocupa, e o caminho é curto:

> salvar o custo → sair da tela → voltar
>
> O patch (`custosSalvos`) morreu com a tela. O cache de módulo sobreviveu e
> serve o payload **anterior ao salvamento**. A coluna volta a mostrar "—".

Hoje isso não acontece porque a volta refaz a ida. O cache de módulo **troca uma
tela correta por uma que parece ter perdido o dado** — e some quando se vai
procurar, porque só reproduz em quem salvou e navegou.

Guardar o patch em escopo de módulo junto (para o cache "lembrar" o custo) é
pior: cria uma segunda verdade de custo no cliente, que diverge em silêncio da
do servidor no dia em que a sincronização ou outra aba mexer no mesmo valor.

## Opção B — cache com invalidação por escritor

Exigiria alcançar os quatro escritores da tabela acima. Os dois de fora (sync e
reconexão) não têm como avisar o cliente hoje — não há canal para isso. Ficaria
uma invalidação que cobre metade dos casos, e **meia invalidação é a versão
lenta da opção A**: o defeito continua existindo, só que mais raro e mais
difícil de reproduzir.

## Opção C — cache que vive o que a TELA vive *(recomendada)*

Cache em `useRef`, **não** em escopo de módulo. Chave: a **query inteira** que
já vai para o servidor (`shopeeModuleQuery` / equivalente do TikTok), que
carrega `connection_id`, `atividade`, `ordenacao`, `q`, `limit`, `offset` e o
período. Qualquer um deles mudando é outra chave — nenhuma mistura possível.

**A história de invalidação, inteira, em três linhas:**

1. **Sair da tela invalida tudo.** O cache morre com a montagem, exatamente como
   o `custosSalvos` que corrige as linhas. Os dois têm o mesmo tempo de vida, e
   é isso que torna impossível o cache servir um payload velho sem o patch que o
   corrige. Sync e reconexão deixam de ser problema: **toda visita busca**.
2. **Salvar a alíquota limpa o cache da tela.** Um escritor, dentro do
   componente, uma linha. E resolve de brinde a defasagem que já existe hoje.
3. **Salvar custo não precisa invalidar nada.** O patch em memória continua
   ganhando do payload, como já ganha — e some junto com o cache.

**O que a pessoa vê entre salvar e refletir:** nada muda em relação a hoje. O
custo aparece na linha assim que o POST responde (é o desenho de 29/08), e a
alíquota passa a atualizar a tabela na próxima troca de período em vez de ficar
defasada até a próxima visita.

**O que se ganha:** dentro de uma visita, voltar a um período já visto passa a
custar zero ida. É esse zero que paga o hover que não vira clique — a mesma
aritmética de `/ads`, e por isso a antecipação por ponteiro pode ser ligada aqui
sem subir requisição (medido: 4 → 4).

**O que NÃO se ganha:** voltar à tela depois de sair continua pagando a ida.
Deliberado — é o preço de não ter as três invalidações que não existem.

## Recomendação

**C.** Se ela não for aprovada, a resposta certa é **não ter cache** nessas
telas: os 200 ms são baratos perto de uma tela que parece ter perdido o custo
que a vendedora acabou de digitar.

## O que medir depois de implementar

Mesma metodologia de `/ads`: requisições emitidas numa sessão com revisita e
numa sessão sem revisita, antes e depois. O número não pode subir em nenhuma das
duas.
