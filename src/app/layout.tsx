import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { AppShell } from "./components/AppShell";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "SellerCore — Inteligência para operações multicanal",
  description: "Lucro, pedidos, estoque e desempenho dos seus canais de venda em um só lugar",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR" data-scroll-behavior="smooth" className={`${geistSans.variable} h-full antialiased`} suppressHydrationWarning>
      <body className="min-h-full text-slate-900" suppressHydrationWarning>
        <a href="#main-content" className="skip-link">
          Pular para o conteúdo
        </a>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
