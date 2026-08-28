import { BriefingView } from "../../components/BriefingView";

// Briefing DO TIKTOK SHOP — escopado ao canal (decisão da Ana, 27/08/2026).
export default function TiktokBriefingPage() {
  return <BriefingView canal={{ provider: "tiktok_shop", nome: "TikTok Shop" }} />;
}
