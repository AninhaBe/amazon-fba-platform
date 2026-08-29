/**
 * Qual porta do pooler do Supabase a aplicação usa — e por quê.
 *
 * ## O problema (medido em 28/08/2026, produção)
 *
 * O pooler tem dois modos, um por porta:
 *
 * | porta | modo | o que custa |
 * |---|---|---|
 * | 5432 | `session` | cada conexão de cliente prende uma de servidor pela vida inteira |
 * | 6543 | `transaction` | a conexão volta ao pool a cada transação |
 *
 * O `pool_size` do projeto é **15**. No modo `session` isso é o teto de clientes,
 * e ele **já mordia**: abrir as 10 conexões que o próprio `db.ts` declara como
 * `max` falhava com `EMAXCONNSESSION` sempre que outra coisa usava o pooler.
 * Medido nas duas portas: 14 conexões de cliente na 5432, **40+ na 6543**.
 *
 * ## Por que a troca é segura aqui (verificado item a item, não suposto)
 *
 * O modo `transaction` quebra tudo que depende de estado de sessão. Nada disso
 * é usado pela aplicação: os dois únicos locks são `pg_advisory_xact_lock`
 * (escopo de transação — `db.ts` e `tiktokOwnership.ts`), não há prepared
 * statement nomeado, `LISTEN`/`NOTIFY`, tabela temporária, cursor entre
 * transações nem `set_config` de sessão. O único `set_config` do repo está no
 * `migrate-cli.mjs`, que **não** passa por aqui. Detalhes e a sonda que exercita
 * isso nas duas portas: `docs/adr/ADR-028-modo-do-pooler-e-teto-de-conexoes.md`
 * e `scripts/pooler-mode-probe.mjs`.
 *
 * ⚠️ **Se um dia entrar código que dependa de sessão, ele falha em produção e
 * não em teste.** É o preço desta decisão, e está registrado no ADR-028.
 *
 * ## Por que em código, e não só na variável de ambiente
 *
 * Porque a string de conexão que o console do Supabase entrega é a do modo
 * `session`. Alguém recolar a variável — coisa normal de fazer — devolveria o
 * app ao teto de 15 sem que ninguém percebesse, e o sintoma apareceria como
 * timeout do pool, não como "voltamos de modo". Aqui a escolha é explícita,
 * revisável e testada.
 */

const HOST_DO_POOLER = /(^|\.)pooler\.supabase\.com$/i;
const PORTA_SESSION = "5432";
const PORTA_TRANSACTION = "6543";

function analisar(bruta: string): URL | null {
  try {
    return new URL(bruta);
  } catch {
    return null;
  }
}

/**
 * A URL que o pool da aplicação deve usar: modo `transaction` quando o destino
 * é o pooler do Supabase; qualquer outra coisa (Postgres local, conexão direta,
 * outro provedor) passa intacta.
 *
 * ⚠️ A troca é feita por substituição de texto no trecho `@host:porta/`, nunca
 * reconstruindo a URL: `new URL(...).toString()` re-codifica a senha, e uma
 * senha com caractere especial voltaria diferente do que o Postgres espera.
 */
export function urlDoPoolDaAplicacao(bruta: string | undefined): string | undefined {
  if (!bruta) return bruta;
  const url = analisar(bruta);
  if (!url || !HOST_DO_POOLER.test(url.hostname)) return bruta;

  if (url.port === PORTA_TRANSACTION) return bruta; // já está no modo certo
  if (url.port === "") {
    // Porta implícita: o Postgres assumiria 5432, ou seja, modo session.
    return bruta.replace(`@${url.hostname}/`, `@${url.hostname}:${PORTA_TRANSACTION}/`);
  }
  if (url.port !== PORTA_SESSION) return bruta; // porta incomum: não adivinhar

  return bruta.replace(
    `@${url.hostname}:${PORTA_SESSION}/`,
    `@${url.hostname}:${PORTA_TRANSACTION}/`
  );
}

/**
 * A URL da **conexão direta** do projeto, para DDL de migration — que não deve
 * atravessar pooler nenhum.
 *
 * No pooler o usuário vem como `postgres.<ref>`; na conexão direta ele é
 * `postgres` e o host é `db.<ref>.supabase.co`.
 *
 * ⚠️ **O host direto é IPv6-only** (verificado em 28/08/2026: sem registro `A`,
 * só `AAAA`). Quem rodar migration de uma rede sem IPv6 não conecta — e a
 * alternativa é o add-on de IPv4 do projeto. A conexão foi testada com sucesso
 * desta máquina.
 *
 * ⚠️ **Trocar o host MUDA a impressão digital do alvo** — `safeTarget()` a
 * calcula como `sha256(host:porta/base)`, e ela é o que o `--expected-target` do
 * runner de migrations confere. Por isso esta função existe mas **não é usada
 * por padrão**: ligá-la exige reautorizar com a impressão digital nova.
 */
export function urlDeMigracaoDireta(bruta: string | undefined): string | undefined {
  if (!bruta) return bruta;
  const url = analisar(bruta);
  if (!url || !HOST_DO_POOLER.test(url.hostname)) return bruta;

  const usuario = decodeURIComponent(url.username);
  const partes = usuario.split(".");
  if (partes.length < 2) return bruta; // sem o sufixo do projeto não dá para derivar
  const ref = partes[partes.length - 1];
  const porta = url.port === "" ? "" : `:${url.port}`;

  return bruta
    .replace(`//${url.username}:`, `//${partes.slice(0, -1).join(".")}:`)
    .replace(`@${url.hostname}${porta}/`, `@db.${ref}.supabase.co:${PORTA_SESSION}/`);
}
