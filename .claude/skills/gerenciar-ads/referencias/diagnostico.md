# Diagnosticar campanha que não entrega

Ordem de eliminação. **Não pule etapas** — a causa mais barata de corrigir está no topo, e
já aconteceu de tratar como problema de campanha o que era problema de oferta.

## 1. A veiculação está de pé?

Se a resposta for não, **nada mais importa**.

| Checar | Onde | Pegadinha |
|---|---|---|
| Status da campanha | lista de campanhas | ver abaixo — **"Em inserção" é normal** |
| Estoque vendável do SKU | Seller Central / `monitor-estoque` | sem estoque, a oferta perde a Oferta em destaque e o anúncio **para de veicular em silêncio** |
| Buy box / Oferta em destaque | página do produto | Sponsored Products **não veicula** sem ela |
| Anúncio suprimido | Gerenciador de estoque | anúncio suprimido não aparece nem organicamente |

⚠️ **O rótulo de status mudou.** A Amazon mostra **"Em inserção"**, não "Em veiculação". O
tooltip diz: *"Sua campanha está sendo inserida. Os anúncios dessa campanha com status
'Funcionando' estão qualificados para impressões."* — **é veiculação normal, não é
problema.** Confirmado em 13/08/2026. Não tratar como campanha parada; confirmar por
impressão acumulando.

⚠️ **"Orçamento excedido"** é status de teto batido no dia, não de campanha quebrada.

## 2. Está entrando no leilão?

Impressões ~zero por 2+ dias = **lance abaixo do piso**. Não é orçamento.
→ [`lance-e-orcamento.md`](lance-e-orcamento.md)

## 3. Aparece e não é clicado?

**500+ impressões com ~0 clique → o problema é a OFERTA, não a campanha.**

Ordem de investigação:

1. **Preço.** Puxar `competitiveSummary` dos ASINs do topo orgânico do termo.
   ⚠️ **Comparar só entre produtos equivalentes** — checar `attributes` e `dimensions` do
   nosso e conferir se o concorrente é do mesmo porte, no mínimo pelo título. Puxar
   `competitiveSummary` de uma busca por palavra-chave mistura tamanhos, materiais e
   quantidades.
2. **Imagem principal.** Fundo branco, sem texto (política) e o produto ocupando o quadro.
3. **Título.** ≤75 caracteres, e a intenção do termo tem que aparecer nele.
4. **Avaliações.** Zero avaliação em produto commodity perde para marca conhecida no
   empate — e nenhuma alavanca de Ads corrige isso.

### 🔑 O teste que isola campanha de oferta

**Compare a automática com a manual do MESMO produto.** Mesma página, mesmo preço, mesma
imagem: se a manual tem CTR alto e a automática não, o problema **não é a oferta** — é o
casamento de termos da automática.

Medido nesta conta em 16/08:

```
Manual - Martelo   6,78% CTR      ← termos escolhidos à mão
Auto  - Martelo    0,10% CTR      ← a Amazon escolhendo
```

67× de diferença no mesmo produto. Isso derrubou a conclusão anterior de que "aparece no
topo e não é clicado, logo é a oferta".

## 4. É clicado e não vende?

**10+ cliques com 0 venda → o problema é a PÁGINA, não o anúncio.**

Pare de mexer em lance. Mais orçamento mandando mais gente para uma página que não
converte é só queimar dinheiro mais rápido.

⚠️ **Antes de concluir, confirmar que não é azar.** Com conversão saudável de 10%:

| Cliques sem venda | Chance de ser só azar |
|---|---|
| 10 | ~35% |
| 14 | ~23% |
| 21 | ~11% |
| **45** | **<1%** — aí é conclusão |

E confirmar que não é **atribuição**: a venda pode ainda não ter sido creditada (janela de
7 dias, contada da data do clique).

## 5. O relatório está confiável?

⚠️ **Tarja *"Estamos investigando uma interrupção temporária em nossos relatórios"*** →
nenhuma métrica ausente é fato. Zero clique e zero compra podem ser dado que não chegou.
Ler mesmo assim, mas **não concluir e não agir** — registrar a leitura como parcial e
reolhar depois que a Amazon avisar que normalizou.

---

## Quando TODA rota do console dá 404

Visto em 16/08/2026, ~1h fora do ar.

**Sintoma:** o console **carrega** — barra `amazon ads`, menu lateral, rodapé — mas
qualquer rota devolve "Página não encontrada". E o `entityId` some da URL depois da
primeira navegação.

| Caminho tentado | Resultado |
|---|---|
| `sellercentral.amazon.com.br/cm/ref=xx_cmpmgr_dnav_xx?source=ngs` | Erro interno |
| `advertising.amazon.com.br/campaign-manager/all-campaigns?entityId=…` | 404 |
| Link "Campanhas" no topo | 404 |
| Ícone de campanhas na lateral | 404 |

**Não é sessão caída** (aí viria login) **nem falta de permissão** (aí viria tela de
registro). Os RIDs mudam a cada tentativa, então a requisição chega na Amazon e é ela que
responde 404.

✅ **Confirmado que não é a automação:** ela abriu no navegador dela e deu o mesmo 404. E
`status.ads.amazon.com` dizia "No known issues" no mesmo minuto — o status oficial não
cobre esse tipo de quebra.

**O que fazer:** não insistir. Registrar a tentativa, avisar, e sugerir trocar a entidade
pelo seletor de conta (ícone de pessoa, canto superior direito) antes de tentar de novo.

📌 **Leitura pendente não vira conclusão** — não inventar número nem repetir o da véspera
como se fosse de hoje.

---

## A sessão de anúncios cai com frequência

Se outras abas da Amazon forem usadas, a sessão de Ads cai. Dois cuidados:

- **Entrar sempre pelo Seller Central**, nunca direto na URL de anúncios (direto devolve
  tela de registro).
- **Rolar a tabela para a direita derrubou a sessão** numa leitura de 16/08. Preferir
  `get_page_text`, que traz a linha inteira sem rolagem.
