/**
 * @nexo/ds — o design system do NEXO, extraido do que esta no ar.
 *
 * ⚠️ ISTO E UM RETRATO, NAO UM REDESIGN. Cada componente aqui e uma copia
 * apresentacional do que a aplicacao renderiza hoje (06/09/2026): mesmo markup,
 * mesmas classes, mesmo CSS — sem fetch, sem sessao, sem rota. O dado entra por
 * props.
 *
 * ⚠️ O APP NAO CONSOME ESTE PACOTE. A extracao foi feita sem tocar em uma linha
 * fora de `packages/nexo-ds/`, de proposito: trocar as telas para consumir o
 * pacote e uma decisao de outra frente, com risco proprio. Enquanto isso nao
 * acontece, `src/app/globals.css` continua sendo a fonte de verdade — se os dois
 * divergirem, quem esta certo e o app.
 *
 * Uso minimo:
 *   import "@nexo/ds/estilos/tokens.css";
 *   import "@nexo/ds/estilos/componentes.css";
 *   import { ChipDeMargem } from "@nexo/ds";
 */

export { MensagemDoNexo } from "./componentes/MensagemDoNexo";
export type { MensagemDoNexoProps } from "./componentes/MensagemDoNexo";

export { CartaoDeMetrica, ReguaDeMetricas } from "./componentes/CartaoDeMetrica";
export type { CartaoDeMetricaProps, TomDaMetrica } from "./componentes/CartaoDeMetrica";

export { ChipDeMargem, tomDaMargem } from "./componentes/ChipDeMargem";
export type { ChipDeMargemProps, TomDeMargem } from "./componentes/ChipDeMargem";

export { FaixaDeResultado, LinhaDePendencias } from "./componentes/FaixaDeResultado";
export type { FaixaDeResultadoProps, ParcelaDaCascata } from "./componentes/FaixaDeResultado";

export { ReguaDeDias } from "./componentes/ReguaDeDias";
export type { DiaDaRegua } from "./componentes/ReguaDeDias";

export { LinhaDeTopProduto, ListaDeTopProdutos } from "./componentes/LinhaDeTopProduto";
export type { LinhaDeTopProdutoProps } from "./componentes/LinhaDeTopProduto";

export { LinhaDeRentabilidade } from "./componentes/LinhaDeRentabilidade";
export type { LinhaDeRentabilidadeProps } from "./componentes/LinhaDeRentabilidade";

export { AvisoDeCobertura, BaseDeData } from "./componentes/AvisoDeCobertura";
export type { AvisoDeCoberturaProps, Base } from "./componentes/AvisoDeCobertura";

export { SeletorDePeriodo } from "./componentes/SeletorDePeriodo";
export type { SeletorDePeriodoProps, OpcaoDePeriodo } from "./componentes/SeletorDePeriodo";

export { Esqueleto } from "./componentes/Esqueleto";
export type { EsqueletoProps } from "./componentes/Esqueleto";

export { EstadoVazio } from "./componentes/EstadoVazio";
export type { EstadoVazioProps, TipoDeVazio } from "./componentes/EstadoVazio";

export { AcaoPrimaria } from "./componentes/AcaoPrimaria";
export type { AcaoPrimariaProps } from "./componentes/AcaoPrimaria";
