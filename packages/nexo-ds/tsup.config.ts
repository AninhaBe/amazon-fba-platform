import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  // ⚠️ OS TIPOS SAEM DO `tsc`, NAO DAQUI. O gerador de `.d.ts` embutido no
  // tsup (rollup-plugin-dts) traz um TypeScript proprio e estoura com
  // `Cannot read properties of undefined (reading 'useCaseSensitiveFileNames')`
  // contra a versao instalada aqui. Emitir declaracao com o compilador de
  // verdade e menos peca movel e da o mesmo resultado — ver `build` no
  // package.json.
  dts: false,
  clean: true,
  // React fica de FORA do bundle: se entrasse, o app carregaria duas copias e
  // os hooks quebrariam com o erro mais confuso do ecossistema.
  external: ["react", "react/jsx-runtime"],
  target: "es2022",
});
