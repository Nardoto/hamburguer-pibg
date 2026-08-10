import assert from 'node:assert/strict';
import { calculateTotal, createCombo, customizeCombo, markWithdrawn } from '../app.js';

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

console.log('Todos os testes do pedido passaram.');
