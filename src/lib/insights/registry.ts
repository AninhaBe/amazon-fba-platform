import type { Detector } from "./types";
import { rupturaDetector } from "./detectors/ruptura";
import { velocidadeDetector } from "./detectors/velocidade";
import { margemDetector } from "./detectors/margem";

// Registro dos detectores ativos. Adicionar um insight = registrar um detector aqui.
export const detectors: Detector[] = [rupturaDetector, velocidadeDetector, margemDetector];
