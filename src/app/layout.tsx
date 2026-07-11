import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { NavLinks } from "./components/Nav";
import { AccountSwitcher } from "./components/AccountSwitcher";
import { Logo } from "./components/Logo";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "SellerCore — Inteligência para vendedores Amazon",
  description: "Lucro, monitoramento, estoque e pesquisa de mercado para sua conta Amazon via SP-API",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR" className={`${geistSans.variable} h-full antialiased`} suppressHydrationWarning>
      <body className="min-h-full text-slate-900" suppressHydrationWarning>
        <div className="flex min-h-screen">
          {/* Sidebar — desktop */}
          <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-slate-200/70 bg-white/85 backdrop-blur-xl md:flex">
            <div className="px-5 py-5">
              <Logo />
            </div>
            <div className="flex-1 overflow-y-auto px-3 py-2">
              <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                Navegação
              </p>
              <NavLinks variant="sidebar" />
            </div>
            <div className="border-t border-slate-100 px-4 py-4">
              <AccountSwitcher />
            </div>
          </aside>

          {/* Coluna principal */}
          <div className="flex min-w-0 flex-1 flex-col">
            {/* Top bar — mobile */}
            <header className="sticky top-0 z-10 border-b border-slate-200/70 bg-white/85 px-4 py-3 backdrop-blur-xl md:hidden">
              <div className="mb-3">
                <Logo />
              </div>
              <NavLinks variant="top" />
            </header>

            <main className="mx-auto w-full max-w-7xl flex-1 px-5 py-8 sm:px-8 lg:py-10">
              {children}
            </main>
          </div>
        </div>
      </body>
    </html>
  );
}
