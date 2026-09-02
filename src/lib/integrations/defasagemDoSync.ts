import { dbQuery } from "../db";
import { CICLOS_ATE_ALARMAR, ROTA_DE_SYNC, intervaloDaRota, limiteDeSilencioMs } from "./cadenciaDoSync";

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

export interface DefasagemDeConexao {
  provider: string;
  connectionId: string;
  estado: EstadoDaDefasagem;
  /** `null` = nunca sincronizou com sucesso. Não é zero — é ausência. */
  minutosDesdeUltimoSucesso: number | null;
  limiteMinutos: number;
  /** Frase pronta para a tela; `null` quando está tudo bem. */
  mensagem: string | null;
}

interface Linha {
  provider: string;
  connection_id: string;
  last_success_at: Date | string | null;
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
          minutosDesdeUltimoSucesso: null,
          limiteMinutos,
          mensagem: `${linha.connection_id} nunca sincronizou com sucesso.`,
        };
      }
      const desdeMs = agora - new Date(linha.last_success_at).getTime();
      const minutos = Math.round(desdeMs / 60_000);
      const atrasado = desdeMs > limiteMs;
      return {
        provider: linha.provider,
        connectionId: linha.connection_id,
        estado: atrasado ? ("atrasado" as const) : ("ok" as const),
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
  /** Pior caso do canal. `null` = nenhuma conexão com histórico. */
  piorCasoMinutos: number | null;
  limiteMinutos: number;
  mensagem: string | null;
}

export interface ResumoDaDefasagem {
  estado: "ok" | "atrasado" | "sem-historico" | "sem-conexoes";
  ciclosAteAlarmar: number;
  canais: DefasagemDeCanal[];
  /** Só o que precisa de ação, para a tela não ter de filtrar. */
  mensagens: string[];
}

export function resumirDefasagem(conexoes: DefasagemDeConexao[]): ResumoDaDefasagem {
  const porCanal = new Map<string, DefasagemDeConexao[]>();
  for (const c of conexoes) porCanal.set(c.provider, [...(porCanal.get(c.provider) ?? []), c]);

  const canais: DefasagemDeCanal[] = [...porCanal.entries()].map(([provider, lista]) => {
    const atrasadas = lista.filter((c) => c.estado === "atrasado");
    const comHistorico = lista.filter((c) => c.minutosDesdeUltimoSucesso != null);
    const piorCasoMinutos = comHistorico.length
      ? Math.max(...comHistorico.map((c) => c.minutosDesdeUltimoSucesso as number))
      : null;
    const cadenciaMin = Math.round(intervaloDaRota(ROTA_DE_SYNC[provider]) / 60_000);
    const estado: EstadoDaDefasagem = atrasadas.length
      ? "atrasado"
      : comHistorico.length === 0 ? "sem-historico" : "ok";
    return {
      provider,
      estado,
      conexoes: lista.length,
      atrasadas: atrasadas.length,
      piorCasoMinutos,
      limiteMinutos: lista[0].limiteMinutos,
      // A frase aponta com número — quantas, há quanto tempo, e qual era o
      // esperado — e não nomeia ninguém.
      mensagem: atrasadas.length
        ? `${provider}: ${atrasadas.length} de ${lista.length} conexao(oes) sem sincronizar ha ${piorCasoMinutos} min (esperado a cada ${cadenciaMin} min).`
        : estado === "sem-historico"
          ? `${provider}: nenhuma conexao sincronizou com sucesso ate agora.`
          : null,
    };
  });

  const mensagens = canais.filter((c) => c.mensagem).map((c) => c.mensagem as string);
  let estado: ResumoDaDefasagem["estado"] = "ok";
  if (canais.length === 0) estado = "sem-conexoes";
  else if (canais.some((c) => c.estado === "atrasado")) estado = "atrasado";
  else if (canais.every((c) => c.estado === "sem-historico")) estado = "sem-historico";
  return { estado, ciclosAteAlarmar: CICLOS_ATE_ALARMAR, canais, mensagens };
}

export async function lerDefasagemDoSync(agora = Date.now()): Promise<ResumoDaDefasagem> {
  const linhas = await dbQuery<Linha>(
    `SELECT provider, connection_id, MAX(last_success_at) AS last_success_at
       FROM workspace_marketplace_syncs
      GROUP BY provider, connection_id`,
    [],
  );
  return resumirDefasagem(avaliarDefasagem(linhas, agora));
}
