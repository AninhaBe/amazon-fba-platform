import { dbQuery } from "../db";
import { filtroDeAcessoLiberado } from "./assinaturaPausaSync";
import {
  CANAIS_COM_PUSH,
  CICLOS_ATE_ALARMAR,
  LIMITE_PUSH_MUDO_MS,
  ROTA_DE_SYNC,
  intervaloDaRota,
  limiteDeSilencioMs,
} from "./cadenciaDoSync";

/**
 * VIGIA DE DEFASAGEM POR CANAL — "este canal parou de sincronizar?"
 *
 * ⚠️ POR QUE ELE EXISTE, com data: em 02/09/2026 a suspeita de que o sync da
 * Shopee tinha parado chegou pela VENDEDORA, conferindo os nossos números contra
 * outra ferramenta. Naquele dia era alarme falso (a diferença era fuso horário
 * convertido na direção errada), mas a investigação achou o buraco de verdade:
 *
 *   **não havia alarme nenhum.** O único vigia do produto era
 *   `silencioDoWebhook.ts`, e ele é fixo em `mercado_livre`. Shopee, Amazon e
 *   TikTok podiam parar por horas sem que nada avisasse.
 *
 * Descobrir que o sync parou por comparação manual da dona do produto é o papel
 * que ela não deveria ter.
 *
 * ⚠️ ELE LÊ ENTRE INQUILINOS, E POR ISSO NÃO DEVOLVE IDENTIFICADOR NENHUM.
 *
 * A pergunta é de PLATAFORMA ("o canal parou?"), não de inquilino: escopar por
 * workspace tornaria o alarme cego justamente ao que ele existe para ver — o
 * canal parado para todo mundo. E `/api/health` é público, sem workspace
 * autenticado, por construção.
 *
 * O preço disso é que a saída é AGREGADA POR CANAL: quantas conexões existem,
 * quantas estão atrasadas, e o pior caso em minutos. **Nenhum `connection_id`
 * sai daqui** — ele carrega o id de loja do vendedor (`shopee:275804987`), e
 * publicá-lo num endereço aberto seria vazar cliente para identificar defeito.
 * É o mesmo desenho do `silencioDoWebhook`, que lê só um timestamp agregado.
 * A quebra por conexão, se um dia for necessária, é assunto de `/admin`, que
 * tem allowlist de e-mail no servidor.
 *
 * 📌 O LIMITE É POR CANAL, e isso não é preciosismo — é a regra dela sobre não
 * globalizar: a Shopee sincroniza a cada 3 minutos e a Amazon a cada 10. Um
 * limite único seria ruído de um lado e cegueira do outro. E ele é DERIVADO da
 * cadência real (`cadenciaDoSync.ts`), não copiado: mudar a cadência muda o
 * alarme junto.
 */

export type EstadoDaDefasagem = "ok" | "atrasado" | "sem-historico";

/**
 * O push de um canal: `sem-push` = este canal não entrega push (Amazon, TikTok);
 * `sem-evento` = entrega, mas nada aconteceu para empurrar — silêncio legítimo.
 */
export type EstadoDoPush = "ok" | "mudo" | "sem-evento" | "sem-push";

export interface DefasagemDeConexao {
  provider: string;
  connectionId: string;
  estado: EstadoDaDefasagem;
  /** `null` = nunca sincronizou com sucesso. Não é zero — é ausência. */
  minutosDesdeUltimoSucesso: number | null;
  limiteMinutos: number;
  push: EstadoDoPush;
  /** Frase pronta para a tela; `null` quando está tudo bem. */
  mensagem: string | null;
}

export interface Linha {
  provider: string;
  connection_id: string;
  last_success_at: Date | string | null;
  last_push_at: Date | string | null;
  /**
   * Houve pedido gravado depois do último push? É a PROVA de que evento deveria
   * ter chegado — sem ela, silêncio de push e ausência de venda são o mesmo
   * sintoma, e o alarme viraria ruído toda madrugada.
   */
  houve_pedido_apos_push: boolean;
  /** O workspace está sem acesso, então esta conexão não deve sincronizar. */
  pausada?: boolean;
}

/**
 * ⚠️ CONEXÃO DE DEMONSTRAÇÃO FICA DE FORA POR NOME, não por acaso.
 *
 * Ela não tem token e nunca sincroniza — apareceria como "atrasada há 8.629
 * minutos" para sempre, e um alarme que está sempre vermelho é o mesmo que
 * alarme nenhum: ensina a ignorar. É a mesma regra que os scripts de cura já
 * seguem.
 */
const ehDemonstracao = (connectionId: string) => /(^|:)demo/i.test(connectionId);

/**
 * ⚠️ SILÊNCIO DE PUSH SÓ É DEFEITO SE HOUVE EVENTO PARA EMPURRAR.
 *
 * Push existe quando algo acontece; a varredura roda tenha acontecido ou não. Por
 * isso o vigia da varredura pode olhar só o relógio, e o do push NÃO pode — sem o
 * discriminador, ele acusaria a madrugada inteira, todo dia, até alguém desligá-lo.
 *
 * O discriminador é a própria varredura: pedido gravado DEPOIS do último push
 * prova que o evento existiu e não chegou.
 */
function avaliarPush(linha: Linha, agora: number): EstadoDoPush {
  if (!CANAIS_COM_PUSH.has(linha.provider)) return "sem-push";
  if (!linha.last_push_at) return linha.houve_pedido_apos_push ? "mudo" : "sem-evento";
  const desde = agora - new Date(linha.last_push_at).getTime();
  if (desde <= LIMITE_PUSH_MUDO_MS) return "ok";
  return linha.houve_pedido_apos_push ? "mudo" : "sem-evento";
}

export function avaliarDefasagem(linhas: Linha[], agora: number): DefasagemDeConexao[] {
  return linhas
    .filter((linha) => !ehDemonstracao(linha.connection_id))
    .filter((linha) => ROTA_DE_SYNC[linha.provider])
    .map((linha) => {
      const limiteMs = limiteDeSilencioMs(linha.provider);
      const limiteMinutos = Math.round(limiteMs / 60_000);
      if (!linha.last_success_at) {
        // Nunca teve sucesso. Não é "atrasado" — é outra coisa, e chamar de
        // atraso mandaria procurar no lugar errado (a conexão pode ser nova, ou
        // nunca ter sido autorizada).
        return {
          provider: linha.provider,
          connectionId: linha.connection_id,
          estado: "sem-historico" as const,
          push: avaliarPush(linha, agora),
          minutosDesdeUltimoSucesso: null,
          limiteMinutos,
          mensagem: `${linha.connection_id} nunca sincronizou com sucesso.`,
        };
      }
      const push = avaliarPush(linha, agora);
      const desdeMs = agora - new Date(linha.last_success_at).getTime();
      const minutos = Math.round(desdeMs / 60_000);
      const atrasado = desdeMs > limiteMs;
      return {
        provider: linha.provider,
        connectionId: linha.connection_id,
        estado: atrasado ? ("atrasado" as const) : ("ok" as const),
        push,
        minutosDesdeUltimoSucesso: minutos,
        limiteMinutos,
        // A frase diz O QUE FALTA com número, e não se desculpa: é o formato da
        // casa. Quem lê precisa saber quanto tempo faz e qual era o esperado.
        mensagem: atrasado
          ? `${linha.connection_id} sem sincronizar há ${minutos} min (esperado a cada ${Math.round(intervaloDaRota(ROTA_DE_SYNC[linha.provider]) / 60_000)} min).`
          : null,
      };
    });
}

export interface DefasagemDeCanal {
  provider: string;
  estado: EstadoDaDefasagem;
  conexoes: number;
  atrasadas: number;
  /**
   * Conexões que NÃO sincronizam de propósito: o workspace está sem acesso
   * (assinatura ausente ou cortada). Ver `assinaturaPausaSync.ts`.
   *
   * ⚠️ ELAS EXISTEM AQUI PARA NÃO VIRAREM ALARME. Desde 07/09/2026 o scheduler
   * pula conexão de conta sem assinatura; para o vigia, que só olhava a idade do
   * último sucesso, isso é indistinguível de varredura quebrada — a conexão
   * envelheceria e gritaria por um estado saudável. Alarme que grita sozinho é
   * alarme que alguém desliga, e o alarme desligado não avisa no dia em que era
   * pra avisar.
   *
   * E ficam CONTADAS, não escondidas: sumir com elas trocaria um alarme falso
   * por uma cegueira.
   */
  pausadas: number;
  /** Pior caso do canal. `null` = nenhuma conexão com histórico. */
  piorCasoMinutos: number | null;
  limiteMinutos: number;
  /** `mudo` só quando houve evento para empurrar — ver `avaliarPush`. */
  push: EstadoDoPush;
  limitePushMinutos: number;
  mensagem: string | null;
}

export interface ResumoDaDefasagem {
  estado: "ok" | "atrasado" | "push-mudo" | "sem-historico" | "sem-conexoes";
  ciclosAteAlarmar: number;
  canais: DefasagemDeCanal[];
  /** Só o que precisa de ação, para a tela não ter de filtrar. */
  mensagens: string[];
}

export function resumirDefasagem(
  conexoes: DefasagemDeConexao[],
  pausadasPorCanal: Map<string, number> = new Map()
): ResumoDaDefasagem {
  const porCanal = new Map<string, DefasagemDeConexao[]>();
  for (const c of conexoes) porCanal.set(c.provider, [...(porCanal.get(c.provider) ?? []), c]);
  // Canal cujas conexões estão TODAS pausadas não pode desaparecer do vigia:
  // sumir da lista é indistinguível de "canal nunca existiu".
  for (const provider of pausadasPorCanal.keys()) if (!porCanal.has(provider)) porCanal.set(provider, []);

  const canais: DefasagemDeCanal[] = [...porCanal.entries()].map(([provider, lista]) => {
    const atrasadas = lista.filter((c) => c.estado === "atrasado");
    const comHistorico = lista.filter((c) => c.minutosDesdeUltimoSucesso != null);
    const piorCasoMinutos = comHistorico.length
      ? Math.max(...comHistorico.map((c) => c.minutosDesdeUltimoSucesso as number))
      : null;
    const cadenciaMin = Math.round(intervaloDaRota(ROTA_DE_SYNC[provider]) / 60_000);
    const pausadas = pausadasPorCanal.get(provider) ?? 0;
    const estado: EstadoDaDefasagem = atrasadas.length
      ? "atrasado"
      // Canal inteiro pausado é "ok": ninguém devia estar sincronizando.
      : lista.length === 0 && pausadas > 0 ? "ok"
      : comHistorico.length === 0 ? "sem-historico" : "ok";
    return {
      provider,
      estado,
      conexoes: lista.length + pausadas,
      atrasadas: atrasadas.length,
      pausadas,
      piorCasoMinutos,
      limiteMinutos: lista[0]?.limiteMinutos ?? cadenciaMin * CICLOS_ATE_ALARMAR,
      // O canal esta mudo se QUALQUER conexao dele estiver — uma loja sem push
      // e um defeito, mesmo que a outra esteja recebendo.
      push: lista.some((c) => c.push === "mudo") ? "mudo" as const
        : lista.some((c) => c.push === "ok") ? "ok" as const
        : lista.some((c) => c.push === "sem-evento") ? "sem-evento" as const
        : "sem-push" as const,
      limitePushMinutos: Math.round(LIMITE_PUSH_MUDO_MS / 60_000),
      // A frase aponta com número — quantas, há quanto tempo, e qual era o
      // esperado — e não nomeia ninguém.
      mensagem: atrasadas.length
        ? `${provider}: ${atrasadas.length} de ${lista.length} conexao(oes) sem sincronizar ha ${piorCasoMinutos} min (esperado a cada ${cadenciaMin} min).`
        : lista.some((c) => c.push === "mudo")
        ? `${provider}: push mudo ha mais de ${Math.round(LIMITE_PUSH_MUDO_MS / 60_000)} min, mas a varredura seguiu trazendo pedido — o canal parou de avisar.`
        : estado === "sem-historico"
          ? `${provider}: nenhuma conexao sincronizou com sucesso ate agora.`
          : null,
    };
  });

  const mensagens = canais.filter((c) => c.mensagem).map((c) => c.mensagem as string);
  let estado: ResumoDaDefasagem["estado"] = "ok";
  if (canais.length === 0) estado = "sem-conexoes";
  else if (canais.some((c) => c.estado === "atrasado")) estado = "atrasado";
  else if (canais.some((c) => c.push === "mudo")) estado = "push-mudo";
  else if (canais.every((c) => c.estado === "sem-historico")) estado = "sem-historico";
  return { estado, ciclosAteAlarmar: CICLOS_ATE_ALARMAR, canais, mensagens };
}

/**
 * Separa o que NAO deve sincronizar do que deveria e nao sincronizou.
 *
 * ⚠️ EXTRAIDA PARA PODER SER TESTADA. Enquanto isto vivia dentro de
 * `lerDefasagemDoSync`, a unica prova possivel era olhar o texto do arquivo — e
 * eu rodei a quebra: trocar `linhas.filter((l) => !l.pausada)` por `linhas`
 * deixava a suite INTEIRA VERDE, porque nenhum teste chegava ate ali. Guarda de
 * fonte nao prova comportamento; esta funcao prova.
 */
export function separarPausadas(linhas: Linha[]): {
  ativas: Linha[];
  pausadasPorCanal: Map<string, number>;
} {
  const ativas = linhas.filter((l) => !l.pausada);
  const pausadasPorCanal = new Map<string, number>();
  for (const l of linhas) {
    if (l.pausada) pausadasPorCanal.set(l.provider, (pausadasPorCanal.get(l.provider) ?? 0) + 1);
  }
  return { ativas, pausadasPorCanal };
}

export async function lerDefasagemDoSync(agora = Date.now()): Promise<ResumoDaDefasagem> {
  const filtroDeAcesso = await filtroDeAcessoLiberado("s");
  const linhas = await dbQuery<Linha>(
    `SELECT s.provider, s.connection_id,
            MAX(s.last_success_at) AS last_success_at,
            MAX(s.last_push_at)    AS last_push_at,
            -- ⚠️ A PROVA DE QUE O EVENTO DEVERIA TER CHEGADO.
            --
            -- Push so existe quando algo acontece: silencio de push e ausencia
            -- de venda produzem o MESMO sintoma. Alarmar por silencio puro
            -- gritaria toda madrugada e o vigia seria desligado numa semana.
            --
            -- O discriminador e a VARREDURA: se ela gravou pedido depois do
            -- ultimo push, entao houve evento e o push nao chegou. Se nao
            -- gravou, nao houve o que empurrar — e silencio e a resposta certa.
            EXISTS (SELECT 1 FROM workspace_channel_orders o
                     WHERE o.workspace_id = s.workspace_id AND o.provider = s.provider
                       AND o.connection_id = s.connection_id
                       AND o.synced_at > COALESCE(s.last_push_at, now() - interval '1 hour'))
              AS houve_pedido_apos_push,
            -- ⚠️ PAUSADA DE PROPOSITO NAO E ATRASADA. Mesma regra do scheduler,
            -- mesma fonte — se este vigia tivesse a propria copia da condicao,
            -- as duas divergiriam e o alarme voltaria a gritar sozinho.
            NOT ${filtroDeAcesso} AS pausada
       FROM workspace_marketplace_syncs s
      GROUP BY s.workspace_id, s.provider, s.connection_id, s.last_push_at`,
    [],
  );

  // ⚠️ A LEITURA CONTINUA ENTRE INQUILINOS, e continua devolvendo AGREGADO. A
  // pergunta e de plataforma ("este canal parou?") e `/api/health` nao tem
  // sessao, por construcao — mas nenhum identificador sai daqui.
  const { ativas, pausadasPorCanal } = separarPausadas(linhas);
  return resumirDefasagem(avaliarDefasagem(ativas, agora), pausadasPorCanal);
}
