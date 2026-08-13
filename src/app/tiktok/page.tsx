import { TikTokWorkspace } from "../components/TikTokWorkspace";
import { Suspense } from "react";

export default function TikTokPage() {
  return <Suspense fallback={null}><TikTokWorkspace /></Suspense>;
}
