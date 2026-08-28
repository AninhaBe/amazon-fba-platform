import { BriefingView } from "../../components/BriefingView";

// Briefing DA SHOPEE — escopado ao canal (decisão da Ana, 27/08/2026).
export default function ShopeeBriefingPage() {
  return <BriefingView canal={{ provider: "shopee", nome: "Shopee" }} />;
}
