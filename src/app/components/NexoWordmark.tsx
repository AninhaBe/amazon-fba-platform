"use client";

/**
 * Assinatura NEXO — letras físicas que assentam na parede.
 *
 * Recria em CSS o vídeo de referência: letras brancas em relevo sobre superfície
 * escura texturizada, girando no eixo X até assentarem, com sombra projetada
 * acompanhando o movimento.
 *
 * Duas decisões que mantêm o efeito no lado "tátil" e longe do "AI-generated":
 * nada de gradiente colorido nem glow — o volume vem de sombra direcional e de
 * uma borda superior mais clara, como iluminação real de cima; e o giro é em
 * torno da base (`transform-origin: bottom`), como peça física caindo no lugar,
 * não um fade-in.
 *
 * `prefers-reduced-motion`: as letras aparecem assentadas, sem animação.
 */
export function NexoWordmark({
  as: Tag = "div",
  className = "",
  label = "NEXO",
}: {
  as?: "div" | "h1" | "span";
  className?: string;
  label?: string;
}) {
  const letras = [...label];
  return (
    <Tag className={`nexo-wordmark ${className}`.trim()} aria-label={label} role="img">
      <span className="nexo-wall" aria-hidden="true">
        {letras.map((letra, indice) => (
          <span
            key={`${letra}-${indice}`}
            className="nexo-letter"
            // Escalonamento por letra: cada uma assenta ~110ms depois da anterior,
            // que é o que dá a leitura de peças colocadas uma a uma.
            style={{ animationDelay: `${indice * 0.11}s` }}
          >
            {letra}
          </span>
        ))}
      </span>
    </Tag>
  );
}
