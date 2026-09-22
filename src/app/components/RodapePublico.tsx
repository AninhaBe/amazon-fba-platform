import Link from "next/link";

import { IDENTIFICACAO_LEGAL } from "./identidadeLegal";

/**
 * O RODAPÉ DE IDENTIFICAÇÃO DAS PÁGINAS PÚBLICAS — quem opera o NEXO, como
 * falar com a gente, e onde estão os Termos e a Política.
 *
 * ⚠️ ELE EXISTE PARA SER ACHADO SEM LOGIN, e essa é a regra que
 * não pode se perder num ajuste futuro: quem audita o site (a AbacatePay, em
 * 22/09/2026) entra pela home, não tem conta e não vai criar uma. Rodapé atrás
 * da tranca de assinatura é rodapé que não existe para quem precisa dele.
 *
 * ⚠️ E POR ISSO ELE É UM COMPONENTE, não um bloco copiado em
 * cada página: a identificação é a MESMA em todas, e cinco cópias divergem no
 * primeiro número que mudar. O conteúdo sai de `IDENTIFICACAO_LEGAL`.
 *
 * `variante`:
 *   - `"completo"` — bloco de três linhas, para páginas de documento (Termos,
 *     Política), onde o rodapé é parte do texto;
 *   - `"compacto"` — uma tira discreta, para as telas de acesso (`/login`,
 *     `/reativar`), que têm altura fixa de viewport e não podem crescer.
 */
export function RodapePublico({ variante = "completo" }: { variante?: "completo" | "compacto" }) {
  return (
    <footer className={`rodape-publico${variante === "compacto" ? " is-compacto" : ""}`}>
      <p className="rodape-publico-identidade">
        <strong>{IDENTIFICACAO_LEGAL.razaoSocial}</strong>
        <span>CNPJ {IDENTIFICACAO_LEGAL.cnpj}</span>
        {/* `mailto:` de propósito: o auditor precisa do endereço LEGÍVEL na
            tela, e quem já está no celular precisa do toque que abre o e-mail.
            O texto do link é o próprio endereço — link escrito "fale conosco"
            esconde justamente o dado que esta página existe para mostrar. */}
        <a href={`mailto:${IDENTIFICACAO_LEGAL.email}`}>{IDENTIFICACAO_LEGAL.email}</a>
      </p>
      <nav className="rodape-publico-links" aria-label="Documentos legais">
        <Link href="/termos">Termos de Uso</Link>
        <Link href="/privacidade">Política de Privacidade</Link>
      </nav>
    </footer>
  );
}
