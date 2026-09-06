import type { ReactNode } from "react";

/**
 * ACAO PRIMARIA — o botao preto de acao.
 *
 * ⚠️ A ACAO E PRETA, NAO AZUL. Numa identidade monocromatica o azul competia
 * com o azul que o canal Amazon usa para dizer onde voce esta — duas coisas
 * diferentes com a mesma cor, na mesma tela.
 *
 * ⚠️ E ELE RENDERIZA COMO `a` OU `button` conforme o uso, sem rota embutida:
 * este pacote nao conhece o roteador do app. Quem monta a tela passa `href` (e
 * envolve num `Link`, se quiser) ou `onClick`.
 */
export interface AcaoPrimariaProps {
  children: ReactNode;
  href?: string;
  onClick?: () => void;
  /** A seta "→" do fim. Ligada por padrao, como no app. */
  seta?: boolean;
  type?: "button" | "submit";
}

export function AcaoPrimaria({ children, href, onClick, seta = true, type = "button" }: AcaoPrimariaProps) {
  const conteudo = <>{children}{seta ? <span aria-hidden="true">→</span> : null}</>;
  if (href) return <a className="meli-primary-action" href={href} onClick={onClick}>{conteudo}</a>;
  return <button className="meli-primary-action" type={type} onClick={onClick}>{conteudo}</button>;
}
