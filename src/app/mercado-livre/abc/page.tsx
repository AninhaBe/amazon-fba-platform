"use client";

import { AbcView } from "../../components/AbcView";

export default function MercadoLivreAbcPage() {
  return (
    <AbcView
      endpoint="/api/integrations/mercado-livre/abc"
      eyebrow="Métricas Mercado Livre"
      subtitle="Classifica seus produtos pela contribuição real (A/B/C) e cruza com o giro para revelar onde está o lucro — e onde ele vaza."
      costsHref="/mercado-livre/produtos"
    />
  );
}
