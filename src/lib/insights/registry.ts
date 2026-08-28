import type { Detector } from "./types";
import { rupturaDetector } from "./detectors/ruptura";
import { velocidadeDetector } from "./detectors/velocidade";
import { margemDetector } from "./detectors/margem";
import { mercadoLivreRupturaDetector } from "./detectors/mercadoLivreRuptura";
import { mercadoLivreVelocidadeDetector } from "./detectors/mercadoLivreVelocidade";
import { mercadoLivreMargemDetector } from "./detectors/mercadoLivreMargem";
import { shopeeRupturaDetector } from "./detectors/shopeeRuptura";
import { shopeeVelocidadeDetector } from "./detectors/shopeeVelocidade";
import { shopeeMargemDetector } from "./detectors/shopeeMargem";
import { tiktokRupturaDetector } from "./detectors/tiktokRuptura";
import { tiktokVelocidadeDetector } from "./detectors/tiktokVelocidade";
import { tiktokMargemDetector } from "./detectors/tiktokMargem";

// Registro dos detectores ativos. Adicionar um insight = registrar um detector
// aqui. Os quatro canais têm os três detectores (ruptura, velocidade, margem);
// na Shopee e no TikTok a margem é no nível da LOJA — o contrato de cada um
// declara que lucro por SKU não é derivável com segurança.
export const detectors: Detector[] = [
  rupturaDetector,
  velocidadeDetector,
  margemDetector,
  mercadoLivreRupturaDetector,
  mercadoLivreVelocidadeDetector,
  mercadoLivreMargemDetector,
  shopeeRupturaDetector,
  shopeeVelocidadeDetector,
  shopeeMargemDetector,
  tiktokRupturaDetector,
  tiktokVelocidadeDetector,
  tiktokMargemDetector,
];
