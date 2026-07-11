import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { NavLinks } from "./components/Nav";
import { AccountSwitcher } from "./components/AccountSwitcher";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "FBA Suite — Lucro & Monitor",
  description: "Calculadora de lucro e monitoramento da sua conta Amazon via SP-API",
};

function Brand() {
  return (
    <div className="flex items-center gap-2.5">
      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-orange-600 text-white shadow-sm">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
          <path d="M3 7l9-4 9 4-9 4-9-4Z" strokeLinejoin="round" />
          <path d="M3 7v10l9 4 9-4V7" strokeLinejoin="round" />
        </svg>
      </span>
      <div className="leading-tight">
        <span className="block text-sm font-bold tracking-tight text-slate-900">FBA Suite</span>
        <span className="block text-[11px] text-slate-400">Selling Partner API</span>
      </div>
    </div>
  );
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR" className={`${geistSans.variable} h-full antialiased`} suppressHydrationWarning>
      <body className="min-h-full bg-slate-100 text-slate-900" suppressHydrationWarning>
        <div className="flex min-h-screen">
          {/* Sidebar — desktop */}
          <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-slate-200 bg-white md:flex">
            <div className="px-5 py-5">
              <Brand />
            </div>
            <div className="flex-1 px-3 py-2">
              <NavLinks variant="sidebar" />
            </div>
            <div className="border-t border-slate-100 px-4 py-4">
              <AccountSwitcher />
            </div>
          </aside>

          {/* Coluna principal */}
          <div className="flex min-w-0 flex-1 flex-col">
            {/* Top bar — mobile */}
            <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 px-4 py-3 backdrop-blur md:hidden">
              <div className="mb-3">
                <Brand />
              </div>
              <NavLinks variant="top" />
            </header>

            <main className="mx-auto w-full max-w-7xl flex-1 px-5 py-8 sm:px-8">{children}</main>
          </div>
        </div>
      </body>
    </html>
  );
}
