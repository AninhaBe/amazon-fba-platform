import { BriefingView } from "../../../components/BriefingView";

// Briefing DA AMAZON — antes esta rota era um re-export do briefing global
// (acidente de 23/08/2026); desde 27/08/2026 é o briefing escopado do canal,
// por decisão da Ana.
export default function AmazonBriefingPage() {
  return <BriefingView canal={{ provider: "amazon", nome: "Amazon" }} />;
}
