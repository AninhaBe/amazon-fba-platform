# Console e API

## Hoje: navegador

A Amazon Ads API foi solicitada em **13/08/2026** como Direct Advertiser e **ainda não foi
aprovada**. Enquanto isso, a operação é pela extensão do Chrome, na conta
`admin@sellercore.test` / NEXAHUB BR.

### O caminho que funciona

**Sempre pelo Seller Central**, nunca direto:

```
https://sellercentral.amazon.com.br/cm/ref=xx_cmpmgr_dnav_xx?source=ngs
```

Redireciona para `advertising.amazon.com.br/campaign-manager/all-campaigns` já com a
entidade certa. Ir direto na URL de anúncios devolve tela de registro.

### Como ler sem quebrar

1. **`navigate` na URL antes de `get_page_text`.** A ferramenta lê o DOM e **não
   recarrega** — sem isso, a "leitura de agora" é uma foto de horas atrás. Já aconteceu:
   duas leituras com 5h de diferença devolveram números idênticos ao centavo.
2. **A primeira leitura depois do `navigate` volta `loading`.** Ler de novo.
3. **Não rolar a tabela para a direita** — derrubou a sessão em 16/08. `get_page_text` traz
   a linha inteira sem rolagem.
4. **Para ver um período específico**, trocar o "Intervalo de datas" do topo. ⚠️ O padrão
   do cartão de resumo e o da tabela são **diferentes**, e isso já gerou leitura errada.
5. A coluna `Impressões` só aparece se tiver sido adicionada em *Colunas → Personalizar*.

### Onde fica cada coisa

| O quê | Caminho |
|---|---|
| Negativar palavra | campanha → **Segmentação negativa** → *Adicione palavras-chave negativas* (tipo "Exata negativa" já vem selecionado) |
| Mudar orçamento | campanha → **Configurações da campanha** → campo Orçamento (o texto no cabeçalho **não** é editável) |
| Mudar lance | campanha → grupo → **Segmentação** → coluna de lance |
| Estratégia de lance e ajustes | campanha → **Configurações da campanha** |
| Relatório de termos de busca | **Medição e relatórios** → **Relatórios de publicidade** → tipo *Termo de busca* |

---

## Testar se a API já foi aprovada

Dez segundos, sem navegador, sem depender de sessão:

```bash
CID=$(grep '^ADS_CLIENT_ID='     .env.local | cut -d= -f2- | tr -d '"\r')
RURI=$(grep '^ADS_REDIRECT_URI=' .env.local | cut -d= -f2- | tr -d '"\r')
curl -sS --compressed -o /tmp/ads-scope.html -w "HTTP %{http_code}\n" \
  "https://www.amazon.com.br/ap/oa?client_id=${CID}&scope=advertising::campaign_management&response_type=code&redirect_uri=${RURI}"
grep -o "bad-scope\|unknown scope\|invalid-parameter" /tmp/ads-scope.html | sort -u
```

| Resposta | Significa |
|---|---|
| `HTTP 400` + `invalid-parameter` · `bad-scope` · `unknown scope` | **ainda pendente** |
| Página de consentimento (HTTP 200, sem esses marcadores) | **aprovada** |

**Histórico:**

| Data | Resultado |
|---|---|
| 13/08/2026 | pendente (solicitada neste dia) |
| 16/08/2026 ~11h50 | pendente |
| 16/08/2026 22h45 | pendente — `ADS_REFRESH_TOKEN` e `ADS_PROFILE_ID` vazios no `.env.local` |

⚠️ O prazo mencionado por ela era **17/08**. Passando disso sem aprovação, vale abrir caso
no suporte de desenvolvedores em vez de continuar esperando.

## Quando a aprovação sair

1. Completar o OAuth e preencher `ADS_REFRESH_TOKEN` e `ADS_PROFILE_ID` no `.env.local`.
   `scripts/ads-profiles.mjs` já resolve o profile.
2. As variáveis `ADS_CLIENT_ID`, `ADS_CLIENT_SECRET`, `ADS_REDIRECT_URI` e `ADS_API_HOST`
   **já existem**.
3. Parar de depender do navegador para leitura.

⚠️ **Automação com API não dispensa confirmação.** A regra de não mexer em lance,
orçamento ou palavra-chave sem o "pode" dela **continua valendo** — e passa a valer mais,
porque via API o erro é instantâneo e em lote.

📌 **O que vale automatizar primeiro:** leitura (relatórios diários, termos de busca) e
**alertas** (campanha fora do ar, orçamento estourado, SKU sem estoque). Mutação em lote é
o último passo, não o primeiro.
