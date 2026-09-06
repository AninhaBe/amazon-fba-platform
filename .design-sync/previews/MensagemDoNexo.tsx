import { AcaoPrimaria, MensagemDoNexo } from "@nexo/ds";

// A voz do NEXO: avatar escuro + seta inline, parágrafos curtos, número sempre
// vindo de fora (o componente nunca inventa valor).
export function ComResumoDoDia() {
  return (
    <MensagemDoNexo
      paragrafos={[
        "Seu lucro de hoje está em R$ 240,00, com margem de 11,8% — abaixo dos 15% do mês passado.",
        "O que mais pesou foi o custo dos produtos.",
      ]}
      rodape={<AcaoPrimaria href="#">Ver detalhes</AcaoPrimaria>}
    />
  );
}

export function ParagrafoUnico() {
  return (
    <MensagemDoNexo
      paragrafos={["Sem vendas até agora hoje. Se você esperava venda neste período, vale conferir se a conta continua conectada."]}
    />
  );
}

export function Carregando() {
  return <MensagemDoNexo paragrafos={[]} carregando />;
}
