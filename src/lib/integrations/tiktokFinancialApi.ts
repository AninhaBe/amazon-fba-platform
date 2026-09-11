import { tiktokFetch, type TiktokShopRef } from "../tiktok";
import { TiktokFinancialAdapters } from "./tiktokFinancialLedger";

/** Production transport is kept outside the pure adapters so fixtures never
 * need credentials and tests cannot accidentally call the marketplace. */
export function liveTiktokFinancialAdapters(shop:TiktokShopRef) {
  return new TiktokFinancialAdapters((path,options)=>tiktokFetch(path,{...options,accessToken:shop.accessToken,shopCipher:shop.shopCipher,app:shop.app}));
}
