import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // "standalone" gera .next/standalone (server.js mínimo, sem node_modules completo)
  // para a imagem Docker. Ligado só via env para não mudar o build do Render, que
  // roda `next start` e serve produção hoje.
  output: process.env.BUILD_STANDALONE === "1" ? "standalone" : undefined,
};

export default nextConfig;
