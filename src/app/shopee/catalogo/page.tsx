import { Suspense } from "react"; import { ShopeeModulePage } from "../../components/ShopeeModulePage";
export default function Page(){return <Suspense fallback={null}><ShopeeModulePage kind="catalog"/></Suspense>}
