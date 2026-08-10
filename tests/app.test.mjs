import assert from 'node:assert/strict';
import { calculateTotal, createCombo, customizeCombo, markWithdrawn, ticketFilename, ticketLines, ticketHeader, kitchenDetails, setKitchenStatus } from '../app.js';

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

console.log('Todos os testes do pedido passaram.');
