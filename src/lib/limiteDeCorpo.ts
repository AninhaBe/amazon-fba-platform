/**
 * Teto de corpo para rotas publicas que recebem POST.
 *
 * ⚠️ POR QUE 64KB E POR QUE UM SO NUMERO. E o mesmo teto que o push da Shopee ja
 * usava desde que nasceu, e nenhum evento legitimo de nenhum dos canais chega
 * perto: um lote do ML sao algumas centenas de bytes por notificacao, e um
 * evento da Stripe raramente passa de alguns KB. Numeros diferentes por rota
 * seriam tres decisoes para revisar em vez de uma.
 *
 * ⚠️ E O TETO VEM ANTES DO TRABALHO, sempre. Assinatura e limite de lote so
 * valem DEPOIS de ler (e, no caso do ML, de parsear) o corpo inteiro — entao sem
 * teto o custo e pago mesmo por quem vai ser recusado. Achado na auditoria de
 * superficie de 07/09/2026: a Shopee tinha teto, o formulario de orcamento
 * tinha, e os webhooks do ML e da Stripe nao tinham.
 */
export const LIMITE_DE_CORPO = 64 * 1024;
