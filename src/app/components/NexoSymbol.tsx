export function NexoSymbol({
  size = 24,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  return (
    // O favicon existente foi escolhido como símbolo oficial do NEXO. Usar o
    // próprio arquivo mantém a assinatura idêntica no navegador e no produto.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/favicon.ico"
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      className={`nexo-symbol ${className}`.trim()}
    />
  );
}
