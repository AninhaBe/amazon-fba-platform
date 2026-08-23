import type { Metadata } from "next";
import { LandingV2Experience } from "./LandingV2Experience";

export const metadata: Metadata = {
  title: "NEXO — uma operação, uma leitura",
  description: "Explore como o NEXO organiza vendas, margem, estoque e decisões em uma operação multicanal.",
};

export default function LandingV2Page() {
  return <LandingV2Experience />;
}
