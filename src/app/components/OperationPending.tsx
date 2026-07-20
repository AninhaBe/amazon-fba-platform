import Link from "next/link";

export interface OperationPendingItem {
  label: string;
  href: string;
}

export function OperationPending({ items }: { items: OperationPendingItem[] }) {
  if (items.length === 0) return null;

  return (
    <section className="operation-pending" aria-labelledby="operation-pending-title">
      <span className="operation-pending-mark" aria-hidden="true">!</span>
      <div className="operation-pending-heading">
        <h2 id="operation-pending-title">Pendências da operação</h2>
        <p>{items.length === 1 ? "Uma ação precisa da sua atenção." : `${items.length} ações precisam da sua atenção.`}</p>
      </div>
      <ul>
        {items.map((item) => (
          <li key={`${item.href}:${item.label}`}>
            <Link href={item.href}>
              <span>{item.label}</span>
              <b aria-hidden="true">→</b>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
