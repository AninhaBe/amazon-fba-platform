export function NexoSymbol({
  size = 24,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  return (
    // A assinatura e o favicon usam o mesmo arquivo para a marca exibida no
    // produto nunca divergir da marca mostrada na aba.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/nexo-symbol.svg"
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      className={`nexo-symbol ${className}`.trim()}
    />
  );
}
