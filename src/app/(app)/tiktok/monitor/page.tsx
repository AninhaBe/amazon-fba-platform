import { Suspense } from "react"; import { TikTokModulePage } from "../../../components/TikTokModulePage";
export default function Page(){return <Suspense fallback={null}><TikTokModulePage kind="monitor"/></Suspense>}
