import { BriefingView } from "../../components/BriefingView";

// Briefing DO MERCADO LIVRE — escopado ao canal (decisão da Ana, 27/08/2026).
export default function MercadoLivreBriefingPage() {
  return <BriefingView canal={{ provider: "mercado_livre", nome: "Mercado Livre" }} />;
}
