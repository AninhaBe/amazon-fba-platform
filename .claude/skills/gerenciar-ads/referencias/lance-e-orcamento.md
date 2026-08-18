# Lance e orçamento — a matemática e onde ela morde

## Lance final = três camadas que se MULTIPLICAM

```
Lance final = Lance base
            × (1 + ajuste de posicionamento)   ← aplicado primeiro
            × (1 + ajuste dinâmico)            ← aplicado depois
```

Ignorar o empilhamento é como estouro de orçamento acontece sem ninguém entender de onde
veio.

### Camada 1 — o lance base

O que você digita na palavra. Palavra sem lance próprio **herda o lance padrão do grupo**.

⚠️ **Armadilha do lance padrão:** ao criar grupo pela interface, o lance padrão nasce em
**R$ 2,75**, independentemente do que você configurou nas palavras. Aconteceu nos quatro
grupos criados nesta conta em 13/08. Só morde quando um alvo sem lance próprio entra
depois — mas **nasce errado sempre**. Conferir na lista de grupos logo após criar.

### Camada 2 — estratégia de lance da campanha

| Estratégia | O que a Amazon faz | Quando usar |
|---|---|---|
| **Lances fixos** | Nada. Usa exatamente o seu lance. | Quando quer medir sem interferência. |
| **Dinâmico — somente redução** | Baixa quando prevê conversão improvável. **Nunca sobe.** | **Padrão seguro.** Especialmente em produto novo, sem histórico para a Amazon prever bem. |
| **Dinâmico — aumento e redução** | Sobe até **+100%** em topo de busca e **+50%** nas demais. Também baixa. | Só depois de conversão comprovada. Antes disso a Amazon prevê no escuro com o seu dinheiro. |

**Nesta conta:** todas em **somente redução**. Manter.

### Camada 3 — ajuste por posicionamento

Três posicionamentos, cada um com ajuste de **0% a 900%**:

- **Topo da pesquisa** — primeira linha de resultados. Maior conversão, maior CPC, maior competição.
- **Restante da pesquisa** — demais posições, incluindo páginas 2, 3, 4…
- **Páginas de produto** — carrosséis dentro de páginas de detalhe.

**Nesta conta:** todos em **0%**. Manter até o CTR provar conversão.

### O empilhamento, na prática

```
Lance base                    R$ 1,00
+50% de topo de busca         R$ 1,50
+100% dinâmico (topo)         R$ 3,00   ← o que você pode pagar num clique
```

🔥 **O cenário que quebra conta:** lance de R$ 1,00 com ajuste de topo em **900%** e
dinâmico "aumento e redução" ligado chega a **R$ 20,00 por clique**. Os dois controles
parecem inofensivos sozinhos; multiplicados, não são.

📌 **Regra de sequência:** ajuste de posicionamento é a **última** alavanca a mexer, não a
primeira. Ele compra **posição**, não gera **aprendizado**. Antes de CTR e conversão
provados, ele só encarece o dado.

---

## Quanto posso pagar por clique?

```bash
node scripts/lance.mjs --preco 27.90 --custo 5.84 --cvr 10
```

A conta que o script faz:

```
margem unitária    = preço − custo − tarifas
ACOS de equilíbrio = margem unitária ÷ preço
CPC de equilíbrio  = margem unitária × CVR
```

**CPC de equilíbrio** é onde o anúncio empata: acima disso, cada clique tira dinheiro do
bolso. Em fase de ranqueamento aceita-se ficar acima dele de propósito — mas **sabendo**,
e é essa a diferença entre investir e sangrar.

⚠️ **ACOS não é lucro.** ACOS de 20% dá prejuízo se a margem bruta é 15%. O teto de ACOS
aceitável é a **margem**, não um número de mercado.

⚠️ **Sem CVR medido**, use 10% como hipótese de trabalho e diga que é hipótese. Com menos
de ~10 cliques não há CVR — não há conversão medida.

---

## Quando o problema é LANCE e quando é ORÇAMENTO

Confundir os dois é o erro que custou o dia 13/08 nesta conta: quatro campanhas com
R$ 50/dia de teto entregaram **134 impressões e R$ 0,55** em 19 horas. O teto estava
sobrando; o lance é que não entrava no leilão.

| Sintoma | Culpado | Ação |
|---|---|---|
| Impressões ~zero, gasto ~zero, teto intocado | **Lance** | Subir para a sugestão da Amazon, ou para o piso da faixa exibida |
| Gasto encosta em 50%+ do teto, ou "Orçamento excedido" | **Orçamento** | Subir o teto — ou reduzir de propósito, se o objetivo é conter |
| Impressões altas, cliques ~zero | Nenhum dos dois | É **oferta**: preço, imagem, título |

📌 **Teto é rede de proteção, não acelerador.** Aumentar orçamento com 1% de uso não
destrava volume nenhum. Só mexer quando o gasto encostar em ~50% do teto.

📌 **Ao subir lance, subir para a sugestão da própria Amazon** ou para o **piso da faixa
que ela exibe** — não para um número arbitrário. Fora da faixa o anúncio simplesmente não
entra no leilão.

### Detalhes do leilão que mudam a decisão

- **Exata costuma custar ~3× a automática** — "martelo de borracha" sugeria R$ 1,20 em
  exata contra R$ 0,33 na automática.
- ⚠️ **Mas não presuma a ordem.** No protetor, "ponteira de cadeira" sugeria R$ 1,60 em
  exata e **R$ 0,33 em frase**. Ler a sugestão de **cada** correspondência.
- **O lance sugerido muda depois de adicionar o produto.** Antes do produto a tela mostra
  um valor genérico (R$ 0,98); com o martelo dentro, a sugestão real era R$ 0,33. **Nunca
  aceitar o número que aparece antes de o produto entrar.**
- **Sem sugestão, o padrão é R$ 2,75.** Foi o caso do kitprote-8 — com margem de ~R$ 9,
  esse lance exigiria 30% de conversão só para empatar.

---

## Orçamento

- **O mínimo NÃO é R$ 50/dia.** Esse número é a *recomendação* (US$ 10 ou equivalente); o
  mínimo aceito é o equivalente a **US$ 1**. A tela sugere R$ 40 e aceita menos.
- **Orçamento é da campanha, não do grupo.** Exata e Frase moram na mesma campanha manual
  e **dividem** o teto. Não é erro — é o desenho recomendado — mas muda como ler o número
  de cada grupo.
- **Não espalhar.** Dez campanhas com R$ 5 nunca saem da fase de aprendizado; três com
  R$ 17 saem.

### Reduzir em vez de pausar

Quando uma campanha "não vende", antes de matar: **conferir CTR e preço**.

CTR bom + preço no mercado + amostra pequena = **reduzir e continuar medindo**, não matar.
Foi a decisão da `Auto - Protetor` em 16/08: CTR de 0,76% (segundo melhor da conta), preço
o segundo mais barato de seis, 21 cliques sem venda — que com conversão de 10% tem ~11% de
chance de ser só azar. Orçamento cortado de R$ 10 para R$ 5, campanha viva.

📌 **Quando decidir de verdade:** ~45 cliques. Nesse ponto, zero venda tem menos de 1% de
chance de ser azar — aí é conclusão, não palpite.
