import type { Metadata } from "next";
import { LandingV2Experience } from "../landing-v2/LandingV2Experience";

export const metadata: Metadata = {
  title: "NEXO — uma operação, uma leitura",
  description: "Explore como o NEXO organiza vendas, margem, estoque e decisões em uma operação multicanal.",
  /**
   * ⚠️ O CANÔNICO É A RAIZ, e não este endereço (01/09/2026).
   *
   * Desde que `/` passou a servir a landing por rewrite, o MESMO conteúdo
   * responde em dois endereços — conteúdo duplicado, que buscador resolve
   * escolhendo um sozinho se ninguém disser qual.
   *
   * Quem deve acumular reputação é a raiz: é ela que a Ana divulga, é ela que
   * está no cartão. `/landing` continua existindo porque o login linka para ele
   * ("Conhecer o NEXO"), mas aponta a autoridade para `/`.
   */
  alternates: { canonical: "/" },
};

export default function LandingPage() {
  return <LandingV2Experience />;
}
