"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

interface NavItem {
  href: string;
  label: string;
  desc: string;
  icon: React.ReactNode;
}

const items: NavItem[] = [
  {
    href: "/",
    label: "Dashboard",
    desc: "Visão geral",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5">
        <rect x="3" y="3" width="8" height="9" rx="1.5" />
        <rect x="13" y="3" width="8" height="5" rx="1.5" />
        <rect x="13" y="10" width="8" height="11" rx="1.5" />
        <rect x="3" y="14" width="8" height="7" rx="1.5" />
      </svg>
    ),
  },
  {
    href: "/calculadora",
    label: "Calculadora",
    desc: "Lucro e margem por ASIN",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5">
        <rect x="4" y="3" width="16" height="18" rx="2" />
        <path d="M8 7h8M8 11h2M12 11h4M8 15h2M12 15h4" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    href: "/monitor",
    label: "Monitor da conta",
    desc: "Pedidos e financeiro real",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5">
        <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    href: "/estoque",
    label: "Radar de estoque",
    desc: "Dias até acabar",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5">
        <path d="M3 9l9-5 9 5-9 5-9-5Z" strokeLinejoin="round" />
        <path d="M3 9v6l9 5 9-5V9" strokeLinejoin="round" />
        <path d="M12 14v6" />
      </svg>
    ),
  },
  {
    href: "/pesquisa",
    label: "Pesquisa",
    desc: "Anúncios do mercado",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5">
        <circle cx="11" cy="11" r="7" />
        <path d="m21 21-4.3-4.3" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    href: "/produtos",
    label: "Produtos",
    desc: "Custos por SKU",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-5 w-5">
        <path d="M20 7 12 3 4 7v10l8 4 8-4V7Z" strokeLinejoin="round" />
        <path d="m4 7 8 4 8-4M12 11v10" strokeLinejoin="round" />
        <circle cx="16.5" cy="9.5" r="1" fill="currentColor" stroke="none" />
      </svg>
    ),
  },
];

export function NavLinks({ variant }: { variant: "sidebar" | "top" }) {
  const pathname = usePathname();

  if (variant === "top") {
    return (
      <nav className="flex gap-1 overflow-x-auto">
        {items.map((it) => {
          const active = pathname === it.href;
          return (
            <Link
              key={it.href}
              href={it.href}
              className={`flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                active
                  ? "bg-blue-50 text-blue-700"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              }`}
            >
              {it.icon}
              {it.label}
            </Link>
          );
        })}
      </nav>
    );
  }

  return (
    <nav className="flex flex-col gap-0.5">
      {items.map((it) => {
        const active = pathname === it.href;
        return (
          <Link
            key={it.href}
            href={it.href}
            aria-current={active ? "page" : undefined}
            className={`group relative flex items-center gap-3 rounded-xl px-2.5 py-2 ${
              active
                ? "bg-blue-50 text-blue-700"
                : "text-slate-600 hover:bg-slate-100/80 hover:text-slate-900"
            }`}
          >
            {active && (
              <span className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-blue-500" />
            )}
            <span
              className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors ${
                active
                  ? "bg-white text-blue-600 shadow-sm ring-1 ring-blue-100"
                  : "bg-slate-100 text-slate-500 group-hover:bg-white group-hover:text-slate-700 group-hover:shadow-sm"
              }`}
            >
              {it.icon}
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold leading-tight">{it.label}</span>
              <span
                className={`block text-[11px] leading-tight ${active ? "text-blue-500/80" : "text-slate-400"}`}
              >
                {it.desc}
              </span>
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
