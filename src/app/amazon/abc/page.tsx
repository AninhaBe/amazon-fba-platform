"use client";

import { AbcView } from "../../components/AbcView";

export default function AmazonAbcPage() {
  return (
    <AbcView
      endpoint="/api/amazon/abc"
      eyebrow="Métricas Amazon"
      subtitle="Classifica seus produtos pela contribuição real (A/B/C) e cruza com o giro para revelar onde está o lucro — e onde ele vaza."
    />
  );
}
