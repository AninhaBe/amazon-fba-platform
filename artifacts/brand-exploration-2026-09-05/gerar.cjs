const fs = require('fs');
const path = require('path');
const sharp = require('../../node_modules/sharp');
const dir = __dirname;
const ink = '#171717', paper = '#fdfdfd';
const shapes = [
'<path d="M16 80V28Q16 16 28 16H36L64 53V16H80V68Q80 80 68 80H60L32 43V80Z"/>',
'<g fill="none" stroke="currentColor" stroke-width="12" stroke-linecap="round" stroke-linejoin="round"><path d="M43 64L34 73A20 20 0 0 1 6 45L26 25A20 20 0 0 1 54 25" transform="translate(9 0)"/><path d="M53 32L62 23A20 20 0 0 1 90 51L70 71A20 20 0 0 1 42 71" transform="translate(-9 0)"/><path d="M34 62L62 34"/></g>',
'<path d="M12 16H30L48 37L66 16H84L57 48L84 80H66L48 59L30 80H12L39 48Z"/>'
];
const names=['01-n-ponte','02-elos','03-encontro'];
const svg=(body,w=96,h=96)=>`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;
const mark=(i,x,y,size,color=ink)=>`<g transform="translate(${x} ${y}) scale(${size/96})" fill="${color}" color="${color}">${shapes[i]}</g>`;
const txt=(x,y,text,size=16,color=ink,weight=400)=>`<text x="${x}" y="${y}" font-family="Arial, sans-serif" font-size="${size}" font-weight="${weight}" fill="${color}">${text}</text>`;
(async()=>{
for(let i=0;i<3;i++){
 fs.writeFileSync(path.join(dir,names[i]+'.svg'),svg(`<g fill="${ink}" color="${ink}">${shapes[i]}</g>`));
 fs.writeFileSync(path.join(dir,names[i]+'-white.svg'),svg(`<g fill="${paper}" color="${paper}">${shapes[i]}</g>`));
 for(const size of [16,24,32,48,180]) await sharp(Buffer.from(svg(`<rect width="96" height="96" rx="18" fill="${paper}"/>${mark(i,0,0,96)}`))).resize(size,size).png().toFile(path.join(dir,`${names[i]}-${size}.png`));
}
let board=`<rect width="1500" height="1080" fill="${paper}"/>`;
board+=txt(64,60,'NEXO / EXPLORAÇÃO DE SÍMBOLO',14,ink,700)+txt(1436,60,'01',14);
board+=txt(64,132,'Conexão com forma própria.',48,ink,700);
board+=txt(64,169,'Três caminhos para uma marca precisa, neutra e legível no dia a dia do SaaS.',20,'#606060');
const labels=['01 / N ponte','02 / Elos','03 / Encontro'];
const desc=[['A inicial ganha uma ligação contínua.','Mais vínculo com o nome; menos ruído.'],['Duas partes compõem uma conexão.','Ideia direta, mas próxima do ícone de link.'],['Caminhos se encontram num mesmo ponto.','Compacto, mas pode ser lido como fechar.']];
for(let i=0;i<3;i++){
 const x=64+i*468;
 board+=`<rect x="${x}" y="211" width="436" height="397" rx="12" fill="#f3f3f3"/>`;
 board+=txt(x+24,248,labels[i],18,ink,700);
 if(i===0) board+=txt(x+273,248,'PREFERIDO',11,ink,700);
 board+=mark(i,x+126,281,184);
 board+=mark(i,x+133,502,35)+txt(x+176,531,'NEXO',33,ink,700);
 board+=txt(x,644,desc[i][0],18,ink,700)+txt(x,673,desc[i][1],16,'#606060');
 board+=`<rect x="${x}" y="704" width="436" height="130" rx="8" fill="${ink}"/>`;
 board+=mark(i,x+22,727,64,paper)+txt(x+114,744,'UMA COR / FUNDO ESCURO',11,paper,700);
 [16,24,32,48].forEach((s,j)=>{board+=mark(i,x+114+j*70,770-s/2,s,paper);board+=txt(x+114+j*70,814,String(s)+' px',10,'#b0b0b0');});
 board+=txt(x,873,'REDUÇÃO / FUNDO CLARO',11,'#606060',700);
 [16,24,32,48].forEach((s,j)=>{board+=mark(i,x+j*94,892,s);board+=txt(x+j*94,964,String(s)+' px',11,'#606060');});
}
board+=`<path d="M64 999H1436" stroke="#dedede"/>`;
board+=txt(64,1034,'Estudo para avaliação • 05.09.2026 • Símbolos vetoriais originais • Nenhuma alteração no app',14,'#606060');
fs.writeFileSync(path.join(dir,'selecao.svg'),svg(board,1500,1080));
await sharp(Buffer.from(svg(board,1500,1080))).png().toFile(path.join(dir,'selecao.png'));
let hero=`<rect width="1200" height="700" fill="${paper}"/>`+txt(56,57,'NEXO / 01 — N PONTE',14,ink,700)+mark(0,72,156,320)+txt(467,365,'NEXO',136,ink,700)+txt(480,414,'Uma forma contínua. Uma inicial reconhecível.',20,'#606060');
hero+=`<rect x="56" y="534" width="1088" height="110" rx="10" fill="${ink}"/>`+mark(0,81,555,68,paper)+txt(178,576,'DO FAVICON À ASSINATURA',12,paper,700);
[16,24,32,48].forEach((s,j)=>{hero+=mark(0,580+j*125,589-s/2,s,paper)+txt(580+j*125,627,String(s)+' px',11,'#aaa');});
fs.writeFileSync(path.join(dir,'recomendado.svg'),svg(hero,1200,700));
await sharp(Buffer.from(svg(hero,1200,700))).png().toFile(path.join(dir,'recomendado.png'));
console.log('Criados SVGs, prancha PNG, destaque e favicons em '+dir);
})();
