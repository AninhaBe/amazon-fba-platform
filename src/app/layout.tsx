import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { AppShell } from "./components/AppShell";
import "./globals.css";

// Inter variável: desenhada para UI densa de números — excelente legibilidade
// em tamanhos pequenos e tabular figures de qualidade para os KPIs.
//
// É a única família do produto. A Bricolage Grotesque saiu em 20/08/2026: a
// identidade monocromática tirou ela dos títulos (`docs/identidade-visual.md`),
// e o `--font-display` continuou sendo injetado sem nenhum CSS consumir — ou
// seja, uma fonte inteira baixada em todo page load sem aparecer na tela.
const interSans = Inter({
  variable: "--font-app-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "NEXO — o funcionário que confere cada venda",
  description: "Lucro, pedidos, estoque e desempenho dos seus canais de venda em um só lugar",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR" data-scroll-behavior="smooth" className={`${interSans.variable} h-full antialiased`} suppressHydrationWarning>
      {/* O `<body>` tinha `text-slate-900`: tinta azulada do Tailwind, e vencia
          o `body { color: var(--ink) }` do globals.css por especificidade de
          classe — a identidade monocromática morria na raiz da árvore. */}
      <body className="min-h-full" suppressHydrationWarning>
        <a href="#main-content" className="skip-link">
          Pular para o conteúdo
        </a>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
