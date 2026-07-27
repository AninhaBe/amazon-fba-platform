import type { Detector } from "./types";
import { rupturaDetector } from "./detectors/ruptura";

// Registro dos detectores ativos. Adicionar um insight = registrar um detector aqui.
// v1: ruptura (protótipo). Próximos: velocidade, margem.
export const detectors: Detector[] = [rupturaDetector];
