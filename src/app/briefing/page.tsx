import { BriefingView } from "../components/BriefingView";

// Briefing GLOBAL — prioridades de todos os canais, na Visão geral. A versão
// por canal vive em /{canal}/briefing, sobre o MESMO componente (decisão da
// Ana em 27/08/2026; ver o comentário no Nav.tsx).
export default function BriefingPage() {
  return <BriefingView />;
}
