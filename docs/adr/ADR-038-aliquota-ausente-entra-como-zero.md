# ADR-038 — Alíquota ausente entra na conta como ZERO

**Data:** 07/09/2026
**Estado:** aceito
**Decisão de:** dona do produto, verbatim: *"nesse caso, ausência é zero mesmo"*

## O que muda

Alíquota de imposto **não cadastrada** deixa de produzir `taxes: null` e passa a
entrar na conta como **zero**, em todos os canais e todos os workspaces. Lucro e
margem passam a existir para quem nunca configurou imposto.

**É uma EXCEÇÃO NOMEADA ao `null ≠ 0`** — a regra continua valendo em todo o
resto, e esta ADR existe para que a exceção seja citável em vez de virar
precedente solto.

## Por que, e por que só aqui

O `null ≠ 0` protege contra afirmar um fato que não se conhece: "não cobraram
frete" e "não sei quanto foi o frete" levam a decisões diferentes, e ali o dado
é do **marketplace** — nós não temos como saber, e nunca teremos por conta
própria.

Imposto é outra coisa, e a diferença é o que sustenta a exceção:

| | tarifa / frete / custo | alíquota de imposto |
|---|---|---|
| de quem é o dado | do marketplace (ou do cadastro do produto) | **da vendedora** |
| quem pode resolver | ninguém, esperar | **ela, em um campo** |
| existe default honesto? | não | **sim: zero** |

Sem alíquota configurada, "o imposto do período foi R$ 0,00" é uma afirmação
**verdadeira sobre o que se sabe** — nada foi declarado, nada incide. E o custo
de errar é assimétrico: um travessão apaga lucro e margem inteiros de quem só
não preencheu um campo, enquanto o zero deixa o número na tela **um pouco
otimista** e apontado.

📌 É a mesma família da decisão de 23/08 (*"o user sabe o que está cadastrado;
se tem venda e não tem custo, fica apontado lá"*): **para dado que é
responsabilidade do usuário e tem default honesto, número na tela vale mais que
travessão.**

## O que NÃO muda — e esta lista é a fronteira da exceção

- **Tarifa, frete e custo de produto continuam `null` quando desconhecidos.** A
  fonte deles é o marketplace ou o cadastro do produto; não há default honesto.
- **A pendência continua.** Zero aplicado **não é zero silencioso**: o payload
  carrega `aliquotaConfigurada: false` e a tela aponta "falta a alíquota de
  imposto", com link. Zero calado seria trocar um defeito por outro.
- **Alíquota cadastrada continua exata.** Quem declarou 5% recebe 5%.

## ⚠️ A fronteira que este ADR obriga a testar

Depois desta mudança, **quem cadastrou 0% e quem não cadastrou produzem a mesma
conta.** Os números são idênticos, byte a byte — o único sinal que os distingue
é `aliquotaConfigurada`.

Isso é aceitável (a conta é a mesma porque a incidência é a mesma), mas cria uma
armadilha de teste: um cenário com apenas um dos dois casos passa verde com a
regra errada dos dois lados. **Teste de imposto ausente exige os dois lados
fabricados** — cadastrado-zero e não-cadastrado — e a asserção que os separa é
o sinal, nunca o valor.

## Precedente que já existia

A **Shopee já fazia isso** desde antes desta decisão (`taxRateKnown ? ... : 0`,
com o sinal separado do valor). Esta ADR não inventa o desenho: ela nomeia o que
um canal já praticava e alinha os outros três, que travavam.

## Consequência conhecida

Guardas de tela que asseguravam "imposto null → travessão" **vão ficar
vermelhas**, e é reversão legítima — a intenção anterior era correta no mundo
anterior. Quem as atualizar registra a inversão dentro do próprio teste, como
manda o `AGENTS.md`.
