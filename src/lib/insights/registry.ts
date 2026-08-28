import type { Detector } from "./types";
import { rupturaDetector } from "./detectors/ruptura";
import { velocidadeDetector } from "./detectors/velocidade";
import { margemDetector } from "./detectors/margem";
import { mercadoLivreRupturaDetector } from "./detectors/mercadoLivreRuptura";
import { mercadoLivreVelocidadeDetector } from "./detectors/mercadoLivreVelocidade";
import { mercadoLivreMargemDetector } from "./detectors/mercadoLivreMargem";

// Registro dos detectores ativos. Adicionar um insight = registrar um detector
// aqui. Amazon e Mercado Livre; Shopee e TikTok chegam por ordem própria.
export const detectors: Detector[] = [
  rupturaDetector,
  velocidadeDetector,
  margemDetector,
  mercadoLivreRupturaDetector,
  mercadoLivreVelocidadeDetector,
  mercadoLivreMargemDetector,
];
