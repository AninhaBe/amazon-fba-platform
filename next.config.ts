import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // "standalone" gera .next/standalone (server.js mínimo, sem node_modules completo)
  // para a imagem Docker. Ligado só via env para não mudar o build do Render, que
  // roda `next start` e serve produção hoje.
  output: process.env.BUILD_STANDALONE === "1" ? "standalone" : undefined,

  // PROTEÇÃO CONTRA VERSION SKEW — a aba de quem já estava com o NEXO aberto
  // conversando com um servidor que acabou de mudar de versão.
  //
  // Sem isto, em 24/08/2026 um deploy derrubou o login com
  // `Failed to find Server Action "60d6cae..."`: o identificador da ação é
  // derivado do build, então a aba antiga mandava um ID que o servidor novo não
  // conhecia mais. A tela mostrava "Não foi possível abrir esta área" e o botão
  // "Tentar novamente" não resolvia — só recarregar.
  //
  // Com o `deploymentId`, o Next carimba a versão nos assets (`?dpl=`) e nos
  // headers, compara os dois lados e, ao detectar divergência, faz uma RECARGA
  // COMPLETA sozinho em vez de tentar a navegação e falhar.
  //
  // ⚠️ Mais máquinas NÃO resolveria: não é indisponibilidade — o servidor
  // respondia normalmente. Em rolling com duas instâncias o problema piora, com
  // a mesma pessoa alternando entre versões a cada requisição.
  //
  // Vazio em desenvolvimento de propósito: o valor vem do build (o SHA do
  // commit, via `--build-arg DEPLOYMENT_VERSION`), e `undefined` desliga o
  // mecanismo sem efeito colateral.
  deploymentId: process.env.DEPLOYMENT_VERSION || undefined,
};

export default nextConfig;
