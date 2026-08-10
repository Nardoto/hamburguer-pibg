import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { calculateTotal, canCreateSunday, createCombo, customizeCombo, deliveryFeedback, hasKitchenAdjustment, isAdminRole, lastPurchaseLabel, markWithdrawn, saleDateLabel, saleUrl, shortOrderNumber, teamTabLabel, ticketFilename, ticketLines, ticketHeader, kitchenDetails, serviceModeLabel, setKitchenStatus } from '../app.js';
import { orderFromDatabase, orderPayload, orderRpcPayload, recoveryOrderFromDatabase } from '../supabase-client.js';

const completeCombo = createCombo();
assert.equal(completeCombo.mode, 'complete');
assert.deepEqual(completeCombo.removed, []);
assert.equal(completeCombo.note, '');
assert.equal(calculateTotal([completeCombo, createCombo()]), 50);

const customizedCombo = customizeCombo(completeCombo, ['Tomate', 'Bacon'], 'Cortar ao meio');
assert.equal(customizedCombo.mode, 'customized');
assert.deepEqual(customizedCombo.removed, ['Tomate', 'Bacon']);
assert.equal(customizedCombo.note, 'Cortar ao meio');
assert.equal(calculateTotal([customizedCombo]), 25);

assert.equal(markWithdrawn({ withdrawn: false }).withdrawn, true);

const orderForTicket = {
  code: 'PIBG-0001',
  customer: { name: 'Maria da Silva', phone: '(11) 99999-0000' },
  combos: [customizedCombo],
};
assert.equal(ticketFilename(orderForTicket), 'comprovante-hamburguer-pibg-PIBG-0001.pdf');
assert.deepEqual(ticketLines(orderForTicket), ['Combo 1: Sem Tomate, Bacon · Cortar ao meio']);
assert.deepEqual(ticketLines({ ...orderForTicket, combos: [completeCombo] }), ['Combo 1: Completo']);
assert.equal(ticketHeader(orderForTicket), 'RETIRADA DE MARIA DA SILVA');
assert.equal(kitchenDetails({ ...orderForTicket, kitchenNote: '2 completos e 1 sem tomate' }), '2 completos e 1 sem tomate');
assert.equal(setKitchenStatus({ kitchenStatus: 'new' }, 'grill').kitchenStatus, 'grill');
assert.equal(shortOrderNumber('PIBG-0025'), '025');
assert.equal(shortOrderNumber('PIBG-1000'), '1000');
assert.equal(hasKitchenAdjustment({ ...orderForTicket, kitchenNote: '' }), true);
assert.equal(hasKitchenAdjustment({ ...orderForTicket, combos: [completeCombo], kitchenNote: '' }), false);
assert.equal(hasKitchenAdjustment({ ...orderForTicket, combos: [completeCombo], kitchenNote: 'Sem queijo' }), true);
assert.equal(hasKitchenAdjustment({ combos: [{ mode: 'complete' }], kitchenNote: '' }), false);
assert.equal(isAdminRole('admin'), true);
assert.equal(isAdminRole('team'), false);
assert.equal(saleUrl('https://hamburguerpibg.com/', 'domingo-abc'), 'https://hamburguerpibg.com/?v=domingo-abc');
assert.equal(saleUrl('https://hamburguerpibg.com/?painel=equipe', 'domingo-abc'), 'https://hamburguerpibg.com/?v=domingo-abc');
assert.equal(saleDateLabel('2026-08-16'), 'Domingo, 16 de agosto');
assert.equal(canCreateSunday(null), true);
assert.equal(canCreateSunday({ id: 'domingo-atual' }), false);
assert.equal(serviceModeLabel('local'), 'Comer no local');
assert.equal(serviceModeLabel('takeaway'), 'Para viagem');
assert.equal(deliveryFeedback({ code: 'PIBG-0025', customer: { name: 'Ana' }, serviceMode: 'takeaway' }), 'PIBG-0025 entregue · Ana · Para viagem');
assert.equal(teamTabLabel('orders'), 'Pedidos');
assert.equal(teamTabLabel('sales'), 'Vender');
assert.equal(lastPurchaseLabel(null, new Date('2026-08-10T12:00:00Z')), 'Seja o primeiro a comprar');
assert.equal(lastPurchaseLabel('2026-08-10T11:58:40Z', new Date('2026-08-10T12:00:00Z')), 'Última compra há 1 min');

const appSource = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const confirmationStart = appSource.indexOf('function renderConfirmation()');
const confirmationEnd = appSource.indexOf('function renderRecovery()', confirmationStart);
const confirmationMarkup = appSource.slice(confirmationStart, confirmationEnd);
assert.ok(confirmationMarkup.indexOf('download-ticket') < confirmationMarkup.indexOf('pickup-qr'));
assert.equal(confirmationMarkup.includes("${actionBar('COMPRA CONFIRMADA'"), false);
assert.equal(appSource.includes('class="stock-success"'), true);
assert.equal(appSource.includes('Quantidade salva:'), true);

assert.deepEqual(orderPayload({
  customer: { name: ' Ana ', phone: '(11) 99999-0000 ' }, serviceMode: 'takeaway',
  combos: [{ removed: ['Tomate'], note: 'Cortar ao meio' }],
}), {
  customer_name: 'Ana',
  customer_phone: '(11) 99999-0000',
  service_mode: 'takeaway',
  items: [{ removed: ['Tomate'], note: 'Cortar ao meio' }],
});

assert.deepEqual(orderFromDatabase({
  id: 'order-1', code: 'PIBG-0001', customer_name: 'Ana', customer_phone: '(11) 99999-0000',
  source: 'manual', service_mode: 'takeaway', kitchen_status: 'grill', kitchen_note: '2 completos', withdrawn_at: null,
  items: [{ removed: ['Tomate'], note: '' }],
}), {
  id: 'order-1', code: 'PIBG-0001', customer: { name: 'Ana', phone: '(11) 99999-0000' },
  source: 'manual', serviceMode: 'takeaway', kitchenStatus: 'grill', kitchenNote: '2 completos', withdrawn: false,
  combos: [{ mode: 'customized', removed: ['Tomate'], note: '' }],
});

assert.deepEqual(recoveryOrderFromDatabase({
  code: 'PIBG-0025', customer_name: 'Ana', customer_phone: '(11) 99999-0000',
  items: [{ removed: [], note: '' }, { removed: ['Queijo muçarela'], note: 'Bem passado' }],
}), {
  code: 'PIBG-0025', customer: { name: 'Ana', phone: '(11) 99999-0000' }, serviceMode: 'local',
  source: 'online', kitchenStatus: 'new', kitchenNote: '', withdrawn: false,
  combos: [
    { mode: 'complete', removed: [], note: '' },
    { mode: 'customized', removed: ['Queijo muçarela'], note: 'Bem passado' },
  ],
});

assert.deepEqual(orderRpcPayload({
  customer: { name: 'Ana', phone: '(11) 99999-0000' }, serviceMode: 'local',
  combos: [{ removed: [], note: '' }],
}), {
  p_customer_name: 'Ana',
  p_customer_phone: '(11) 99999-0000',
  p_service_mode: 'local',
  p_items: [{ removed: [], note: '' }],
});

console.log('Todos os testes do pedido passaram.');
