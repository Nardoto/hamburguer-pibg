import {
  confirmOrder,
  createSaleEvent,
  createManualOrder,
  createPibgClient,
  fetchActiveSale,
  fetchTeamRole,
  fetchTeamSale,
  endSaleEvent,
  fetchTeamOrders,
  recoverTickets,
  reserveOrder,
  signInTeam,
  updateKitchenStatus,
  updateStockTotal,
  withdrawOrder,
} from './supabase-client.js';

export const INGREDIENTS = ['Alface', 'Tomate', 'Bacon', 'Barbecue', 'Queijo muçarela'];
export const COMBO_PRICE = 25;

let comboSequence = 0;

export function createCombo() {
  comboSequence += 1;
  return {
    id: `combo-${comboSequence}`,
    mode: 'complete',
    removed: [],
    note: '',
  };
}

export function customizeCombo(combo, removed, note) {
  const normalizedRemoved = [...new Set(removed)].filter((ingredient) => INGREDIENTS.includes(ingredient));
  return {
    ...combo,
    mode: normalizedRemoved.length || note.trim() ? 'customized' : 'complete',
    removed: normalizedRemoved,
    note: note.trim(),
  };
}

export function calculateTotal(combos) {
  return combos.length * COMBO_PRICE;
}

export function markWithdrawn(order) {
  return { ...order, withdrawn: true };
}

export function ticketFilename(order) {
  return `comprovante-hamburguer-pibg-${order.code}.pdf`;
}

export function ticketLines(order) {
  return order.combos.map((combo, index) => {
    const details = [];
    if (combo.removed.length) details.push(`Sem ${combo.removed.join(', ')}`);
    if (combo.note) details.push(combo.note);
    return `Combo ${index + 1}: ${details.length ? details.join(' · ') : 'Completo'}`;
  });
}

export function compactTicketLines(order) {
  const count = order.combos.length;
  const summary = `${count} ${count === 1 ? 'combo' : 'combos'} · ${serviceModeLabel(order.serviceMode)}`;
  const adjustments = ticketLines(order).filter((line) => !line.endsWith(': Completo'));
  const visibleAdjustments = adjustments.slice(0, 3);
  const remaining = adjustments.length - visibleAdjustments.length;
  return [summary, ...visibleAdjustments, ...(remaining ? [`+ ${remaining} ajustes no pedido`] : [])];
}

export function ticketHeader(order) {
  return `RETIRADA DE ${order.customer.name.trim().toUpperCase()}`;
}

export function kitchenDetails(order) {
  if (order.kitchenNote?.trim()) return order.kitchenNote.trim();
  const adjustedCombos = ticketLines(order).filter((line) => !line.endsWith(': Completo'));
  return adjustedCombos.length ? adjustedCombos.join(' | ') : `${order.combos.length} ${order.combos.length === 1 ? 'combo completo' : 'combos completos'}`;
}

export function hasKitchenAdjustment(order) {
  return Boolean(order.kitchenNote?.trim()) || (order.combos ?? []).some((combo) => combo.mode === 'customized' || Boolean(combo.removed?.length) || Boolean(String(combo.note ?? '').trim()));
}

export function shortOrderNumber(code) {
  const digits = String(code ?? '').match(/(\d+)$/)?.[1];
  if (!digits) return '—';
  const number = Number(digits);
  return number < 1000 ? String(number).padStart(3, '0') : String(number);
}

export function isAdminRole(role) {
  return role === 'admin';
}

export function saleUrl(baseUrl, publicToken) {
  const url = new URL(baseUrl);
  url.searchParams.delete('painel');
  url.searchParams.set('v', publicToken);
  return url.toString();
}

export function saleDateLabel(eventDate) {
  if (!eventDate) return 'Data a confirmar';
  const label = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' }).format(new Date(`${eventDate}T12:00:00`));
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function canCreateSunday(activeSale) {
  return !activeSale;
}

export function serviceModeLabel(serviceMode) {
  return serviceMode === 'takeaway' ? 'Para viagem' : 'Comer no local';
}

export function deliveryFeedback(order) {
  return `${order.code} entregue · ${order.customer.name} · ${serviceModeLabel(order.serviceMode)}`;
}

export function teamTabLabel(tab) {
  return ({ orders: 'Pedidos', sales: 'Vender', settings: 'Configurações' })[tab] ?? 'Pedidos';
}

export function lastPurchaseLabel(lastPurchaseAt, now = new Date()) {
  if (!lastPurchaseAt) return 'Seja o primeiro a comprar';
  const timestamp = new Date(lastPurchaseAt);
  if (Number.isNaN(timestamp.getTime())) return 'Compra recente';
  const minutes = Math.max(0, Math.floor((now.getTime() - timestamp.getTime()) / 60000));
  if (minutes < 1) return 'Última compra agora';
  if (minutes === 1) return 'Última compra há 1 min';
  if (minutes < 60) return `Última compra há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `Última compra há ${hours} h`;
}

export function setKitchenStatus(order, kitchenStatus) {
  return { ...order, kitchenStatus };
}

if (typeof document !== 'undefined') {
  const urlParams = new URLSearchParams(window.location.search);
  const state = {
    screen: urlParams.get('painel') === 'equipe' ? 'team' : 'home',
    quantity: 1,
    combos: [],
    manualCombos: [createCombo()],
    activeCombo: 0,
    customer: { name: '', phone: '' },
    serviceMode: 'local',
    orders: [],
    activeOrder: null,
    recoveredOrders: [],
    teamAuthorized: false,
    teamRole: null,
    teamTab: 'orders',
    teamSearch: '',
    scanning: false,
    qrScanner: null,
    realtimeChannel: null,
    deliveryNotice: null,
    stockSaveNotice: null,
    sale: null,
    publicToken: urlParams.get('v'),
  };

  const app = document.querySelector('#app');
  const supabase = createPibgClient();
  const money = (value) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const escapeHtml = (value) => String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
  const availableStock = () => Math.max((state.sale?.stock_total ?? 0) - (state.sale?.reserved_quantity ?? 0) - (state.sale?.confirmed_quantity ?? 0), 0);

  function comboDescription(combo) {
    const parts = [];
    if (combo.removed.length) parts.push(`Sem ${combo.removed.join(', ')}`);
    if (combo.note) parts.push(combo.note);
    return parts.length ? parts.join(' · ') : 'Completo';
  }

  function actionBar(label, total, action, actionLabel) {
    return `<div class="sticky-action"><div class="sticky-inner"><div><small>${label}</small><strong>${money(total)}</strong></div><button class="primary-button" data-action="${action}">${actionLabel}</button></div></div>`;
  }

  function purchaseBar() {
    return `<div class="sticky-action"><div class="sticky-inner purchase-bar"><div class="ticket-quantity"><small>QUANTIDADE</small><div><button data-action="quantity" data-delta="-1" aria-label="Diminuir quantidade">−</button><strong>${state.quantity}</strong><button data-action="quantity" data-delta="1" aria-label="Aumentar quantidade">+</button></div></div><div class="ticket-total"><small>TOTAL</small><strong>${money(state.quantity * COMBO_PRICE)}</strong></div><button class="primary-button" data-action="start-order">Continuar pedido</button></div></div>`;
  }

  function renderHome() {
    if (!state.sale) {
      return `<div class="app-shell"><section class="page"><header class="page-head public-head"><img class="church-logo" src="./assets/logo-white.png" alt="PIBG — Primeira Igreja Batista em Goiabeiras"></header><div class="sale-closed"><span>VENDA ENCERRADA</span><h1>Este link não é do domingo atual.</h1><p>Use o QR Code divulgado pela igreja para abrir a venda certa. Cada domingo possui um link e estoque próprios.</p></div></section></div>`;
    }
    return `<div class="app-shell"><section class="page">
      <header class="page-head public-head"><div class="public-brand"><img class="church-logo" src="./assets/logo-white.png" alt="PIBG — Primeira Igreja Batista em Goiabeiras"><span>Cantina dos Casais</span></div></header>
      <div class="hero-image"><div class="hero-topline"><span class="pill"><i class="live-dot"></i>${saleDateLabel(state.sale.event_date).toUpperCase()}</span><span class="pill hero-last">${lastPurchaseLabel(state.sale.last_purchase_at)}</span></div><div class="hero-caption"><p>HAMBÚRGUER ARTESANAL</p><strong>R$ 25</strong><div class="hero-details"><b>Retirada após o culto</b><span>Bife caseiro de 140 g, alface, tomate, bacon, barbecue, muçarela e refrigerante de 200 ml.</span><div class="ingredient-tags"><i>140 g</i><i>Bacon crocante</i><i>Muçarela</i><i>Refri 200 ml</i></div></div></div></div>
      <div class="content">
      <button class="recover-link" data-action="open-recovery">Já comprou? Recuperar comprovante</button></div>
      ${purchaseBar()}
    </section></div>`;
  }

  function renderCustomize() {
    const combo = state.combos[state.activeCombo];
    const isCustomized = combo.mode === 'customized';
    const tabs = state.combos.map((item, index) => `<button class="combo-tab ${index === state.activeCombo ? 'active' : ''}" data-action="select-combo" data-index="${index}">Combo ${index + 1}${item.mode === 'customized' ? ' · ajustado' : ''}</button>`).join('');
    const ingredients = INGREDIENTS.map((ingredient) => `<label class="remove-item"><input type="checkbox" data-ingredient="${ingredient}" ${combo.removed.includes(ingredient) ? 'checked' : ''}>${ingredient}</label>`).join('');
    const nextAction = state.activeCombo < state.combos.length - 1 ? 'next-combo' : 'to-checkout';
    const nextLabel = state.activeCombo < state.combos.length - 1 ? 'Próximo combo' : 'Revisar pedido';
    return `<div class="app-shell"><section class="page"><div class="content"><div class="step-head"><button class="back-button" data-action="home" aria-label="Voltar ao cardápio"></button><div class="progress"><span class="active"></span><span></span><span></span></div><h1 class="step-title">Do seu jeito.<br>Sem confusão.</h1><p class="step-intro">O combo vem completo. Só escolha retirar ingredientes se você quiser mudar algo.</p></div>
      <div class="combo-tabs" aria-label="Escolha o combo a personalizar">${tabs}</div>
      <div class="choice-panel"><button class="mode-choice ${!isCustomized ? 'active' : ''}" data-action="mode" data-mode="complete"><span><b>Completo</b><span>Quero todos os ingredientes do combo.</span></span><i class="radio"></i></button><button class="mode-choice ${isCustomized ? 'active' : ''}" data-action="mode" data-mode="customized"><span><b>Retirar ingredientes</b><span>Escolho o que não quero neste hambúrguer.</span></span><i class="radio"></i></button></div>
      <div class="remove-panel" ${isCustomized ? '' : 'hidden'}><span class="section-label">O QUE VOCÊ QUER RETIRAR?</span><div class="remove-list">${ingredients}</div><label class="field"><span>OBSERVAÇÃO PARA A EQUIPE</span><textarea id="combo-note" placeholder="Ex.: cortar ao meio, por favor.">${escapeHtml(combo.note)}</textarea><small>Opcional. Retirar ingredientes não altera o valor.</small></label></div>
    </div>${actionBar(`COMBO ${state.activeCombo + 1} DE ${state.combos.length}`, calculateTotal(state.combos), nextAction, nextLabel)}</section></div>`;
  }

  function renderCheckout() {
    const items = state.combos.map((combo, index) => `<div class="summary-item"><div><b>Combo ${index + 1}</b><span>${escapeHtml(comboDescription(combo))}</span></div><strong>${money(COMBO_PRICE)}</strong></div>`).join('');
    return `<div class="app-shell"><section class="page"><div class="content"><div class="step-head"><button class="back-button" data-action="customize" aria-label="Voltar para personalização"></button><div class="progress"><span class="active"></span><span class="active"></span><span></span></div><h1 class="step-title">Falta pouco<br>pra ficar pronto.</h1><p class="step-intro">Informe seus dados. Eles serão usados somente para confirmar a retirada.</p></div><div class="summary">${items}<div class="summary-total"><span>Total</span><span>${money(calculateTotal(state.combos))}</span></div></div>
      <form id="customer-form" novalidate><label class="field"><span>SEU NOME</span><input id="customer-name" value="${escapeHtml(state.customer.name)}" autocomplete="name" placeholder="Como podemos te chamar?"></label><label class="field"><span>SEU CELULAR</span><input id="customer-phone" value="${escapeHtml(state.customer.phone)}" inputmode="tel" autocomplete="tel" placeholder="(00) 00000-0000"></label><fieldset class="service-mode"><legend>COMO VOCÊ VAI RETIRAR?</legend><label class="service-option ${state.serviceMode === 'local' ? 'active' : ''}"><input type="radio" name="service-mode" value="local" ${state.serviceMode === 'local' ? 'checked' : ''}>Comer no local</label><label class="service-option ${state.serviceMode === 'takeaway' ? 'active' : ''}"><input type="radio" name="service-mode" value="takeaway" ${state.serviceMode === 'takeaway' ? 'checked' : ''}>Para viagem</label></fieldset><p class="error" id="form-error" hidden></p></form></div>${actionBar('SEU PEDIDO ESTÁ QUASE PRONTO', calculateTotal(state.combos), 'to-pix', 'Gerar Pix')}</section></div>`;
  }

  function renderPix() {
    return `<div class="app-shell"><section class="page"><div class="content"><div class="step-head"><button class="back-button" data-action="checkout" aria-label="Voltar aos dados"></button><div class="progress"><span class="active"></span><span class="active"></span><span class="active"></span></div><h1 class="step-title">Pague no Pix<br>e garanta o seu.</h1><p class="step-intro">No sistema final, esta cobrança será criada pelo Mercado Pago e confirmada automaticamente.</p></div><div class="pix-card"><span class="demo-badge">PAGAMENTO SIMULADO</span><div class="pix-grid" aria-label="QR Code demonstrativo"></div><p>Abra o aplicativo do seu banco, escaneie o código e confirme o pagamento.</p></div><div class="summary"><div class="summary-total"><span>Total do pedido</span><span>${money(calculateTotal(state.combos))}</span></div></div></div>${actionBar('PIX DEMONSTRATIVO', calculateTotal(state.combos), 'confirm-payment', 'Simular pagamento')}</section></div>`;
  }

  function renderConfirmation() {
    const order = state.activeOrder;
    const returnTo = state.teamAuthorized ? 'open-team' : 'home';
    const returnLabel = state.teamAuthorized ? 'Voltar à recepção' : 'Voltar ao cardápio';
    return `<div class="app-shell"><section class="page"><div class="content confirmation"><div class="success-mark" role="img" aria-label="Pedido confirmado"><svg viewBox="0 0 24 24"><path d="m5 12 4 4L19 6"/></svg></div><h1>Pedido confirmado!</h1><p>${escapeHtml(order.customer.name)}, está tudo certo. Guarde seu comprovante agora e mostre o QR Code na retirada.</p><div class="pickup-date">RETIRADA · ${saleDateLabel(state.sale?.event_date).toUpperCase()}</div><div class="pickup-ticket"><small>CÓDIGO DE RETIRADA</small><strong>${order.code}</strong><span>${order.combos.length} ${order.combos.length === 1 ? 'combo' : 'combos'} · ${money(calculateTotal(order.combos))}</span><em>${serviceModeLabel(order.serviceMode)}</em></div><div class="pdf-callout confirmation-download"><b>COMPROVANTE DE RETIRADA</b><span>Baixe agora o PDF com seu nome, pedido e QR Code.</span><button class="pdf-button" data-action="download-ticket">Baixar comprovante em PDF</button></div><div class="pickup-qr-card"><div id="pickup-qr" aria-label="QR Code do pedido ${escapeHtml(order.code)}"></div><span>Mostre este QR Code à equipe no final do culto.</span></div><p class="recovery-hint">Se fechar esta tela, recupere o comprovante usando nome e celular.</p><button class="confirmation-return" data-action="${returnTo}">${returnLabel}</button></div></section></div>`;
  }

  function renderRecovery() {
    const results = state.recoveredOrders.length ? `<div class="recovery-results"><span class="section-label">PEDIDOS ENCONTRADOS</span><p>Escolha o pedido para mostrar novamente o QR Code e baixar o comprovante.</p>${state.recoveredOrders.map((order, index) => `<button class="recovered-order" data-action="open-recovered-ticket" data-index="${index}"><span><b>${escapeHtml(order.code)}</b><small>${order.combos.length} ${order.combos.length === 1 ? 'combo' : 'combos'} · ${money(calculateTotal(order.combos))}</small></span><strong>Ver comprovante</strong></button>`).join('')}</div>` : `<form id="recover-ticket" novalidate><label class="field"><span>NOME COMPLETO DO PEDIDO</span><input id="recovery-name" autocomplete="name" placeholder="Nome usado na compra"></label><label class="field"><span>CELULAR CADASTRADO</span><input id="recovery-phone" inputmode="tel" autocomplete="tel" placeholder="(00) 00000-0000"></label><p class="error" id="recovery-error" hidden></p><button class="primary-button recovery-submit" type="submit">Procurar meu comprovante</button></form>`;
    return `<div class="app-shell"><section class="page"><div class="content recovery-page"><div class="step-head"><button class="back-button" data-action="home" aria-label="Voltar ao cardápio"></button><h1 class="step-title">Esqueceu o<br>comprovante?</h1><p class="step-intro">Informe o mesmo nome e celular usados na compra. Mostraremos apenas seus pedidos confirmados deste domingo.</p></div>${results}</div></section></div>`;
  }

  function renderTeamLogin() {
    return `<div class="app-shell"><section class="page"><header class="team-top"><button class="back-button" data-action="home" aria-label="Voltar ao cardápio"></button><img class="church-logo team-logo" src="./assets/logo-white.png" alt="PIBG — Primeira Igreja Batista em Goiabeiras"><h1>Painel<br>da equipe.</h1><p>Acesso exclusivo para voluntários autorizados.</p></header><div class="team-card"><form id="team-login"><label class="field"><span>E-MAIL DA EQUIPE</span><input id="team-email" type="email" autocomplete="email" placeholder="voluntario@igreja.com"></label><label class="field"><span>SENHA DA EQUIPE</span><input id="team-password" type="password" autocomplete="current-password" placeholder="Digite a senha"></label><p class="error" id="team-error" hidden></p><button class="primary-button" type="submit">Entrar no painel</button></form><p class="step-intro">Use o e-mail e a senha liberados pelo administrador.</p></div></section></div>`;
  }

  function manualComboFields(combos = state.manualCombos) {
    return combos.map((combo, index) => {
      const isCustomized = combo.mode === 'customized';
      const removals = INGREDIENTS.map((ingredient) => `<label><input type="checkbox" data-manual-ingredient value="${ingredient}" ${combo.removed.includes(ingredient) ? 'checked' : ''}> ${ingredient}</label>`).join('');
      return `<fieldset class="manual-combo-card" data-manual-combo><legend>Combo ${index + 1}</legend><div class="manual-mode-choice"><label><input type="radio" name="manual-mode-${index}" value="complete" data-manual-mode ${isCustomized ? '' : 'checked'}> Completo</label><label><input type="radio" name="manual-mode-${index}" value="customized" data-manual-mode ${isCustomized ? 'checked' : ''}> Retirar itens</label></div><div class="manual-removals" ${isCustomized ? '' : 'hidden'}><span>O que retirar deste hambúrguer?</span><div>${removals}</div><label class="manual-note-label">Observação deste hambúrguer<input data-manual-note maxlength="120" value="${escapeHtml(combo.note)}" placeholder="Ex.: cortar ao meio"></label></div></fieldset>`;
    }).join('');
  }

  function readManualComboDrafts() {
    const cards = [...app.querySelectorAll('[data-manual-combo]')];
    if (!cards.length) return state.manualCombos;
    return cards.map((card) => {
      const mode = card.querySelector('[data-manual-mode]:checked')?.value;
      const removed = [...card.querySelectorAll('[data-manual-ingredient]:checked')].map((input) => input.value);
      const note = card.querySelector('[data-manual-note]')?.value ?? '';
      return mode === 'customized' ? customizeCombo(createCombo(), removed, note) : createCombo();
    });
  }

  function refreshManualComboBuilder() {
    const target = app.querySelector('#manual-combo-builder');
    if (target) target.innerHTML = manualComboFields();
  }

  function renderTeam() {
    const normalizedSearch = state.teamSearch.trim().toLowerCase();
    const orders = state.orders.filter((order) => !normalizedSearch || `${order.code} ${order.customer.name} ${order.customer.phone}`.toLowerCase().includes(normalizedSearch));
    const rows = orders.length ? orders.map((order) => `<div class="order-row"><div><b>${escapeHtml(order.customer.name)}</b><span>${order.code} · ${order.combos.length} ${order.combos.length === 1 ? 'combo' : 'combos'} · ${order.source === 'manual' ? 'presencial' : 'on-line'} · ${serviceModeLabel(order.serviceMode)}${hasKitchenAdjustment(order) ? `<br>${escapeHtml(kitchenDetails(order))}` : ''}</span></div><div class="order-actions"><button class="ticket-button" data-action="show-ticket" data-id="${order.id}">Mostrar QR</button>${order.withdrawn ? '<span class="status withdrawn">RETIRADO</span>' : `<button class="secondary-button" data-action="withdraw" data-id="${order.id}">Entregar pedido</button>`}</div></div>`).join('') : '<p class="step-intro">Nenhum pedido encontrado.</p>';
    const sold = state.sale?.confirmed_quantity ?? 0;
    const scanner = state.scanning ? `<div class="scan-panel"><div id="qr-reader"></div><p>Aponte a câmera para o QR Code do comprovante.</p><button class="secondary-button" data-action="stop-scan">Cancelar leitura</button></div>` : '';
    const deliveryNotice = state.deliveryNotice ? `<div class="delivery-notice"><span>ENTREGA CONFIRMADA</span><strong>${escapeHtml(state.deliveryNotice.code)}</strong><p>${escapeHtml(state.deliveryNotice.customer.name)} · ${escapeHtml(serviceModeLabel(state.deliveryNotice.serviceMode))}</p></div>` : '';
    const publicLink = state.sale?.public_token ? saleUrl(window.location.href, state.sale.public_token) : '';
    const createSunday = `<form id="start-sale" class="team-form"><label class="field"><span>NOVO DOMINGO</span><input id="new-sale-name" value="Hambúrguer PIBG — próximo domingo" maxlength="100"></label><label class="field"><span>DATA DA VENDA</span><input id="new-sale-date" type="date" required></label><label class="field"><span>QUANTIDADE INICIAL</span><input id="new-sale-stock" type="number" min="1" value="150"></label><button class="primary-button" type="submit">Criar novo domingo</button><p class="error" id="new-sale-error" hidden></p></form>`;
    const stockSuccess = state.stockSaveNotice !== null ? `<p class="stock-success" role="status" aria-live="polite"><span>✓</span> Quantidade salva: ${state.stockSaveNotice} ${state.stockSaveNotice === 1 ? 'combo disponível para venda' : 'combos disponíveis para venda'}.</p>` : '';
    const activeAdmin = state.sale ? `<div class="current-sale-card"><b>DOMINGO EM ANDAMENTO</b><strong>${escapeHtml(state.sale.name)}</strong><span>${saleDateLabel(state.sale.event_date)}</span><button class="danger-button" data-action="end-sale">Encerrar domingo atual</button><small>Faça isso somente após terminar as vendas e retiradas. Depois, o link público deixa de aceitar pedidos.</small></div><form id="stock-settings" class="team-form admin-divider"><label class="field"><span>QUANTIDADE TOTAL DE COMBOS</span><input id="stock-total" type="number" min="0" value="${state.sale.stock_total}"><small>Não pode ser menor que os pedidos já confirmados ou reservados.</small></label><button class="secondary-button" type="submit">Salvar quantidade</button><p class="error" id="stock-error" hidden></p>${stockSuccess}</form><div class="sale-link-card"><b>LINK PÚBLICO DESTE DOMINGO</b><input readonly value="${escapeHtml(publicLink)}" aria-label="Link público da venda"><div id="sale-link-qr" aria-label="QR Code para abrir esta venda"></div><button class="secondary-button" data-action="copy-sale-link">Copiar link</button></div>` : createSunday;
    const adminSettings = isAdminRole(state.teamRole) ? `<div class="team-card admin-card"><span class="section-label">ADMINISTRAÇÃO DA VENDA</span>${activeAdmin}</div>` : '';
    const operations = state.sale ? `<div class="team-card scanner-card"><span class="section-label">ENTREGA RÁPIDA</span>${deliveryNotice}<button class="scan-button" data-action="start-scan">Ler QR Code e entregar</button><form id="qr-search" class="qr-search"><input id="qr-code-input" value="${escapeHtml(state.teamSearch.startsWith('PIBG-') ? state.teamSearch : '')}" placeholder="Ou digite: PIBG-0025" autocapitalize="characters"><button class="secondary-button" type="submit">Buscar</button></form>${scanner}</div><div class="team-card"><div class="team-stats"><div class="stat"><b>${availableStock()}</b><span>DISPONÍVEIS</span></div><div class="stat"><b>${sold}</b><span>VENDIDOS</span></div></div></div><div class="team-card"><label class="field"><span>BUSCAR PEDIDO</span><input id="order-search" value="${escapeHtml(state.teamSearch)}" placeholder="Nome, celular ou código"></label><span class="section-label">PEDIDOS CONFIRMADOS</span>${rows}</div><div class="team-card"><span class="section-label">NOVA VENDA PRESENCIAL</span><form id="manual-sale" class="team-form"><label class="field"><span>NOME</span><input id="manual-name" placeholder="Nome da pessoa"></label><label class="field"><span>CELULAR</span><input id="manual-phone" inputmode="tel" placeholder="(00) 00000-0000"></label><label class="field"><span>QUANTIDADE DE COMBOS</span><input id="manual-quantity" type="number" min="1" max="10" value="1"></label><label class="field"><span>DESTINO DO PEDIDO</span><select id="manual-service-mode"><option value="local">Comer no local</option><option value="takeaway">Para viagem</option></select></label><label class="field"><span>AJUSTES PARA A COZINHA</span><textarea id="manual-kitchen-note" placeholder="Ex.: 1 sem tomate e alface; os demais completos."></textarea><small>Preencha apenas se algum hambúrguer for diferente. Pedidos completos entram na leva padrão.</small></label><button class="primary-button" type="submit">Registrar venda presencial</button><p class="error" id="manual-error" hidden></p></form></div>` : `<div class="team-card empty-sale-card"><b>Nenhum domingo em andamento.</b><p>Crie um novo domingo na administração para liberar compra, recepção e cozinha.</p></div>`;
    const orderOperations = state.sale ? `<div class="team-card scanner-card"><span class="section-label">ENTREGA RÁPIDA</span>${deliveryNotice}<button class="scan-button" data-action="start-scan">Ler QR Code e entregar</button><form id="qr-search" class="qr-search"><input id="qr-code-input" value="${escapeHtml(state.teamSearch.startsWith('PIBG-') ? state.teamSearch : '')}" placeholder="Ou digite: PIBG-0025" autocapitalize="characters"><button class="secondary-button" type="submit">Buscar</button></form>${scanner}</div><div class="team-card"><div class="team-stats"><div class="stat"><b>${availableStock()}</b><span>DISPONÍVEIS</span></div><div class="stat"><b>${sold}</b><span>VENDIDOS</span></div></div></div><div class="team-card"><label class="field"><span>BUSCAR PEDIDO</span><input id="order-search" value="${escapeHtml(state.teamSearch)}" placeholder="Nome, celular ou código"></label><span class="section-label">PEDIDOS CONFIRMADOS</span>${rows}</div>` : `<div class="team-card empty-sale-card"><b>Nenhum domingo em andamento.</b><p>Abra a aba Configurações para criar a nova venda.</p></div>`;
    const salesOperations = state.sale ? `<div class="team-card"><span class="section-label">NOVA VENDA PRESENCIAL</span><form id="manual-sale" class="team-form"><label class="field"><span>NOME</span><input id="manual-name" placeholder="Nome da pessoa"></label><label class="field"><span>CELULAR</span><input id="manual-phone" inputmode="tel" placeholder="(00) 00000-0000"></label><label class="field"><span>QUANTIDADE DE COMBOS</span><input id="manual-quantity" type="number" min="1" max="10" value="${state.manualCombos.length}"><small>Escolha como preparar cada hambúrguer logo abaixo.</small></label><div id="manual-combo-builder" class="manual-combo-builder">${manualComboFields()}</div><label class="field"><span>DESTINO DO PEDIDO</span><select id="manual-service-mode"><option value="local">Comer no local</option><option value="takeaway">Para viagem</option></select></label><button class="primary-button" type="submit">Registrar venda presencial</button><p class="error" id="manual-error" hidden></p></form></div>` : `<div class="team-card empty-sale-card"><b>Nenhum domingo em andamento.</b><p>Abra a aba Configurações para criar a nova venda.</p></div>`;
    const teamTabs = `<nav class="team-tabs" aria-label="Seções da equipe"><button class="${state.teamTab === 'orders' ? 'active' : ''}" data-action="team-tab" data-tab="orders">Pedidos</button><button class="${state.teamTab === 'sales' ? 'active' : ''}" data-action="team-tab" data-tab="sales">Vender</button>${isAdminRole(state.teamRole) ? `<button class="${state.teamTab === 'settings' ? 'active' : ''}" data-action="team-tab" data-tab="settings">Configurações</button>` : ''}</nav>`;
    const selectedOperations = state.teamTab === 'sales' ? salesOperations : state.teamTab === 'settings' && isAdminRole(state.teamRole) ? adminSettings : orderOperations;
    const teamTitle = state.teamTab === 'sales' ? 'Venda<br>presencial.' : state.teamTab === 'settings' ? 'Configurações<br>da venda.' : 'Pedidos<br>e retirada.';
    const teamDescription = state.teamTab === 'sales' ? 'Registre a compra feita na recepção e ela entra no mesmo estoque.' : state.teamTab === 'settings' ? 'Crie o domingo, ajuste o estoque e divulgue o link certo.' : 'Leia o QR Code ou busque o pedido para entregar rapidamente.';
    return `<div class="app-shell"><section class="page"><header class="team-top"><div class="header-actions"><button class="back-button" data-action="home" aria-label="Voltar ao cardápio"></button>${state.sale ? '<button class="kitchen-button" data-action="open-kitchen">Cozinha</button>' : ''}</div><img class="church-logo team-logo" src="./assets/logo-white.png" alt="PIBG — Primeira Igreja Batista em Goiabeiras"><h1>${teamTitle}</h1><p>${teamDescription}</p></header>${teamTabs}${selectedOperations}</section></div>`;
  }

  function renderKitchenOrder(order) {
    const separated = order.kitchenStatus === 'ready';
    const adjustments = kitchenDetails(order).split(' | ').map((detail) => `<span>${escapeHtml(detail.replace(/^Combo \d+: /, ''))}</span>`).join('');
    return `<article class="kitchen-order ${separated ? 'separated' : ''}"><div class="kitchen-order-top"><strong>${shortOrderNumber(order.code)}</strong><div><h3>${escapeHtml(order.customer.name)}</h3><p class="kitchen-count">${order.code} · ${order.combos.length} ${order.combos.length === 1 ? 'hambúrguer' : 'hambúrgueres'} · ${serviceModeLabel(order.serviceMode)}</p></div></div><div class="kitchen-details">${adjustments}</div><button class="kitchen-action" data-action="set-kitchen-status" data-id="${order.id}" data-status="${separated ? 'new' : 'ready'}">${separated ? 'Voltar para ajustes' : 'Marcar como separado'}</button></article>`;
  }

  function renderKitchen() {
    const specialOrders = state.orders.filter((order) => !order.withdrawn && hasKitchenAdjustment(order));
    const pending = specialOrders.filter((order) => order.kitchenStatus !== 'ready');
    const separated = specialOrders.filter((order) => order.kitchenStatus === 'ready');
    return `<div class="app-shell kitchen-shell"><section class="page kitchen-page"><header class="team-top kitchen-top"><div class="header-actions"><button class="back-button" data-action="open-team" aria-label="Voltar à recepção"></button><span class="kitchen-live">COZINHA AO VIVO</span></div><img class="church-logo team-logo" src="./assets/logo-white.png" alt="PIBG — Primeira Igreja Batista em Goiabeiras"><h1>Ajustes<br>especiais.</h1><p>Os completos entram apenas na leva padrão. Aqui aparecem só os hambúrgueres diferentes.</p></header><main class="kitchen-grid"><section class="batch-card"><span>PRÓXIMA LEVA</span><strong>15 completos</strong><p>Prepare normalmente. Não precisam aparecer nesta tela.</p></section><section class="kitchen-column"><div class="kitchen-column-head"><h2>Separar na montagem</h2><span>${pending.length}</span></div><div class="kitchen-list">${pending.length ? pending.map(renderKitchenOrder).join('') : '<p class="kitchen-empty">Nenhum ajuste pendente. A produção padrão pode seguir.</p>'}</div></section><section class="kitchen-column kitchen-ready"><div class="kitchen-column-head"><h2>Já separados</h2><span>${separated.length}</span></div><div class="kitchen-list">${separated.length ? separated.map(renderKitchenOrder).join('') : '<p class="kitchen-empty">Os pedidos separados aparecerão aqui.</p>'}</div></section></main></section></div>`;
  }

  function render() {
    const views = { home: renderHome, customize: renderCustomize, checkout: renderCheckout, pix: renderPix, confirmation: renderConfirmation, recovery: renderRecovery, team: () => state.teamAuthorized ? renderTeam() : renderTeamLogin(), kitchen: () => state.teamAuthorized ? renderKitchen() : renderTeamLogin() };
    app.innerHTML = views[state.screen]();
    bindEvents();
    renderPickupQr();
    renderSaleLinkQr();
  }

  function syncCurrentCombo() {
    const combo = state.combos[state.activeCombo];
    if (!combo || combo.mode !== 'customized') return;
    const removed = [...document.querySelectorAll('[data-ingredient]:checked')].map((input) => input.dataset.ingredient);
    const note = document.querySelector('#combo-note')?.value ?? '';
    state.combos[state.activeCombo] = customizeCombo(combo, removed, note);
  }

  function goToCustomization() {
    state.combos = Array.from({ length: state.quantity }, () => createCombo());
    state.activeCombo = 0;
    state.screen = 'customize';
  }

  function createActiveOrder() {
    state.activeOrder = {
      id: null,
      accessToken: null,
      code: null,
      customer: { ...state.customer },
      serviceMode: state.serviceMode,
      combos: state.combos.map((combo) => ({ ...combo, removed: [...combo.removed] })),
      withdrawn: false,
      source: 'online',
      kitchenStatus: 'new',
      kitchenNote: '',
    };
  }

  async function refreshSale(shouldRender = false) {
    try {
      state.sale = state.teamAuthorized ? await fetchTeamSale(supabase) : await fetchActiveSale(supabase, state.publicToken);
      if (shouldRender && ['home', 'team', 'kitchen'].includes(state.screen)) render();
    } catch (error) {
      state.sale = null;
      console.error('Falha ao atualizar o estoque.', error);
      if (shouldRender && ['home', 'team', 'kitchen'].includes(state.screen)) render();
    }
  }

  async function refreshTeamOrders(shouldRender = false) {
    if (!state.teamAuthorized) return;
    try {
      state.orders = await fetchTeamOrders(supabase);
      if (shouldRender && ['team', 'kitchen'].includes(state.screen)) render();
    } catch (error) {
      state.teamAuthorized = false;
      state.teamRole = null;
      state.orders = [];
      if (shouldRender) render();
    }
  }

  async function refreshLiveData() {
    await Promise.all([refreshSale(), refreshTeamOrders()]);
    if (['home', 'team', 'kitchen'].includes(state.screen)) render();
  }

  async function subscribeToChanges() {
    if (state.realtimeChannel) await supabase.removeChannel(state.realtimeChannel);
    state.realtimeChannel = supabase.channel('hamburguer-pibg-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sales_events' }, refreshLiveData)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, refreshLiveData)
      .subscribe();
  }

  function renderPickupQr() {
    const target = app.querySelector('#pickup-qr');
    if (!target || !state.activeOrder?.code) return;
    if (!window.QRCode) { target.textContent = state.activeOrder.code; return; }
    target.replaceChildren();
    new window.QRCode(target, { text: state.activeOrder.code, width: 112, height: 112, colorDark: '#1a110e', colorLight: '#fffdf9', correctLevel: window.QRCode.CorrectLevel.M });
  }

  function renderSaleLinkQr() {
    const target = app.querySelector('#sale-link-qr');
    if (!target || !state.sale?.public_token) return;
    const link = saleUrl(window.location.href, state.sale.public_token);
    if (!window.QRCode) { target.textContent = link; return; }
    target.replaceChildren();
    new window.QRCode(target, { text: link, width: 132, height: 132, colorDark: '#1a110e', colorLight: '#fffdf9', correctLevel: window.QRCode.CorrectLevel.M });
  }

  function stopQrScanner() {
    const scanner = state.qrScanner;
    state.qrScanner = null;
    state.scanning = false;
    scanner?.stop().catch(() => {});
  }

  async function completePickupFromScan(code) {
    let order = state.orders.find((item) => item.code === code);
    if (!order) {
      await refreshTeamOrders();
      order = state.orders.find((item) => item.code === code);
    }
    state.teamSearch = code;
    if (!order) {
      render();
      window.alert('Não encontramos um pedido confirmado com este QR Code neste domingo.');
      return;
    }
    if (order.withdrawn) {
      render();
      window.alert(`O pedido ${code} já foi entregue.`);
      return;
    }
    try {
      await withdrawOrder(supabase, order.id);
      await refreshTeamOrders();
      state.deliveryNotice = order;
      render();
    } catch (withdrawError) {
      render();
      window.alert(withdrawError.message);
    }
  }

  async function startQrScanner() {
    if (!window.Html5Qrcode || !navigator.mediaDevices?.getUserMedia) {
      window.alert('A leitura pela câmera não está disponível neste navegador. Digite o código PIBG-0000 mostrado no comprovante.');
      state.scanning = false;
      render();
      return;
    }
    try {
      const scanner = new window.Html5Qrcode('qr-reader', { verbose: false });
      state.qrScanner = scanner;
      await scanner.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 220, height: 220 } },
        async (rawValue) => {
          const code = rawValue.trim().toUpperCase();
          if (!state.scanning) return;
          if (code && /^PIBG-\d{4,}$/.test(code)) {
            stopQrScanner();
            await completePickupFromScan(code);
          }
        },
        () => {},
      );
    } catch (error) {
      stopQrScanner();
      window.alert('Não foi possível abrir a câmera. Verifique a permissão e tente novamente ou digite o código do pedido.');
      render();
    }
  }

  function downloadTicket(order) {
    const JsPdf = window.jspdf?.jsPDF;
    if (!JsPdf) {
      window.alert('Não foi possível preparar o PDF agora. Tente novamente em alguns instantes.');
      return;
    }
    const qrHolder = document.createElement('div');
    let qrDataUrl = null;
    try {
      if (window.QRCode) {
        qrHolder.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:160px;height:160px;overflow:hidden';
        document.body.append(qrHolder);
        new window.QRCode(qrHolder, { text: order.code, width: 160, height: 160, colorDark: '#1a110e', colorLight: '#fffdf9', correctLevel: window.QRCode.CorrectLevel.M });
        qrDataUrl = qrHolder.querySelector('canvas')?.toDataURL('image/png') ?? qrHolder.querySelector('img')?.src ?? null;
      }
    } finally {
      qrHolder.remove();
    }
    const pdf = new JsPdf({ orientation: 'portrait', unit: 'mm', format: 'a6' });
    const pageWidth = pdf.internal.pageSize.getWidth();
    pdf.setFillColor(26, 17, 14);
    pdf.rect(0, 0, pageWidth, 26, 'F');
    pdf.setTextColor(255, 194, 71);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(17);
    pdf.text('HAMBURGUER PIBG', 10, 13);
    pdf.setTextColor(255, 244, 221);
    pdf.setFontSize(7);
    pdf.text('COMPROVANTE DE RETIRADA', 10, 20);
    pdf.setTextColor(41, 23, 18);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(6.5);
    pdf.text('NOME PARA RETIRADA', 10, 35);
    pdf.setFontSize(11);
    pdf.text(ticketHeader(order).replace('RETIRADA DE ', '').slice(0, 40), 10, 42);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(7.5);
    pdf.text(`Celular: ${order.customer.phone}`, 10, 49);
    pdf.setTextColor(118, 80, 66);
    pdf.setFontSize(6.5);
    pdf.text(`Retirada: ${saleDateLabel(state.sale?.event_date)}`, 10, 54);
    pdf.setFillColor(255, 194, 71);
    pdf.roundedRect(10, 61, 55, 29, 3, 3, 'F');
    pdf.setTextColor(41, 23, 18);
    pdf.setFontSize(6.5);
    pdf.text('CODIGO DE RETIRADA', 37.5, 70, { align: 'center' });
    pdf.setFontSize(21);
    pdf.setFont('helvetica', 'bold');
    pdf.text(order.code, 37.5, 81, { align: 'center' });
    pdf.setFontSize(7);
    pdf.text(serviceModeLabel(order.serviceMode), 37.5, 86, { align: 'center' });
    if (qrDataUrl) pdf.addImage(qrDataUrl, 'PNG', 70, 61, 25, 25);
    pdf.setTextColor(118, 80, 66);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(5.8);
    pdf.text(qrDataUrl ? 'Apresente o QR Code na retirada' : 'Apresente o código na retirada', 82.5, 90, { align: 'center' });
    pdf.setTextColor(41, 23, 18);
    pdf.setFontSize(8);
    pdf.text('PEDIDO', 10, 102);
    let y = 108;
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(6.8);
    compactTicketLines(order).slice(0, 4).forEach((line) => {
      const lines = pdf.splitTextToSize(line, pageWidth - 20);
      pdf.text(lines, 10, y);
      y += lines.length * 3.7 + 2.2;
    });
    pdf.setDrawColor(229, 201, 158);
    pdf.line(10, y + 3, pageWidth - 10, y + 3);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(11);
    pdf.text(`Total: ${money(calculateTotal(order.combos))}`, 10, y + 12);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(6);
    pdf.setTextColor(118, 80, 66);
    pdf.text('Mostre este comprovante no celular ao retirar.', 10, y + 20);
    pdf.save(ticketFilename(order));
  }

  function bindEvents() {
    app.querySelectorAll('[data-action]').forEach((element) => element.addEventListener('click', async () => {
      const action = element.dataset.action;
      if (action === 'quantity') { state.quantity = Math.max(1, Math.min(10, state.quantity + Number(element.dataset.delta))); render(); }
      if (action === 'start-order') { goToCustomization(); render(); }
      if (action === 'home') { stopQrScanner(); state.screen = 'home'; render(); }
      if (action === 'open-recovery') { state.recoveredOrders = []; state.screen = 'recovery'; render(); }
      if (action === 'open-recovered-ticket') { state.activeOrder = state.recoveredOrders[Number(element.dataset.index)]; state.screen = 'confirmation'; render(); }
      if (action === 'customize') { state.screen = 'customize'; render(); }
      if (action === 'checkout') { syncCurrentCombo(); state.screen = 'checkout'; render(); }
      if (action === 'select-combo') { syncCurrentCombo(); state.activeCombo = Number(element.dataset.index); render(); }
      if (action === 'mode') { const combo = state.combos[state.activeCombo]; state.combos[state.activeCombo] = element.dataset.mode === 'complete' ? { ...combo, mode: 'complete', removed: [], note: '' } : { ...combo, mode: 'customized' }; render(); }
      if (action === 'next-combo') { syncCurrentCombo(); state.activeCombo += 1; render(); }
      if (action === 'to-checkout') { syncCurrentCombo(); state.screen = 'checkout'; render(); }
      if (action === 'to-pix') {
        const name = document.querySelector('#customer-name').value.trim();
        const phone = document.querySelector('#customer-phone').value.trim();
        const serviceMode = document.querySelector('input[name="service-mode"]:checked')?.value;
        const error = document.querySelector('#form-error');
        if (!name || phone.replace(/\D/g, '').length < 10 || !['local', 'takeaway'].includes(serviceMode)) { error.hidden = false; error.textContent = 'Informe seu nome, celular válido e como vai retirar o pedido.'; return; }
        state.customer = { name, phone };
        state.serviceMode = serviceMode;
        createActiveOrder();
        try {
          const reservation = await reserveOrder(supabase, state.activeOrder, state.publicToken);
          state.activeOrder = { ...state.activeOrder, id: reservation.order_id, accessToken: reservation.access_token };
          await refreshSale();
          state.screen = 'pix';
          render();
        } catch (reservationError) {
          error.hidden = false;
          error.textContent = reservationError.message;
        }
      }
      if (action === 'confirm-payment') {
        try {
          const confirmation = await confirmOrder(supabase, state.activeOrder.id, state.activeOrder.accessToken);
          state.activeOrder = { ...state.activeOrder, code: confirmation.code };
          await refreshSale();
          state.screen = 'confirmation';
          render();
        } catch (confirmationError) {
          window.alert(confirmationError.message);
        }
      }
      if (action === 'open-team') { state.screen = 'team'; render(); }
      if (action === 'team-tab') { stopQrScanner(); state.teamTab = element.dataset.tab; render(); }
      if (action === 'show-ticket') {
        const order = state.orders.find((item) => item.id === element.dataset.id);
        if (order) { state.activeOrder = order; state.screen = 'confirmation'; render(); }
      }
      if (action === 'open-kitchen') { stopQrScanner(); await refreshTeamOrders(); state.screen = 'kitchen'; render(); }
      if (action === 'end-sale') {
        if (!window.confirm('Encerrar este domingo? O link público deixará de aceitar pedidos e só então o próximo domingo poderá ser criado.')) return;
        try {
          stopQrScanner();
          await endSaleEvent(supabase);
          state.sale = null;
          state.publicToken = null;
          state.orders = [];
          state.teamSearch = '';
          render();
        } catch (endError) {
          window.alert(endError.message);
        }
      }
      if (action === 'start-scan') { state.deliveryNotice = null; state.scanning = true; render(); await startQrScanner(); }
      if (action === 'stop-scan') { stopQrScanner(); render(); }
      if (action === 'download-ticket') { downloadTicket(state.activeOrder); }
      if (action === 'withdraw') {
        try { await withdrawOrder(supabase, element.dataset.id); await Promise.all([refreshTeamOrders(), refreshSale()]); render(); } catch (withdrawError) { window.alert(withdrawError.message); }
      }
      if (action === 'set-kitchen-status') {
        try { await updateKitchenStatus(supabase, element.dataset.id, element.dataset.status); await refreshTeamOrders(); render(); } catch (kitchenError) { window.alert(kitchenError.message); }
      }
    }));

    app.querySelector('#team-login')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const error = document.querySelector('#team-error');
      const email = document.querySelector('#team-email').value.trim();
      const password = document.querySelector('#team-password').value;
      try {
        await signInTeam(supabase, email, password);
        state.teamRole = await fetchTeamRole(supabase);
        state.sale = await fetchTeamSale(supabase);
        state.publicToken = state.sale.public_token;
        state.orders = await fetchTeamOrders(supabase);
        state.teamAuthorized = true;
        await subscribeToChanges();
        state.screen = 'team';
        render();
      } catch (loginError) {
        error.hidden = false;
        error.textContent = 'E-mail, senha ou autorização da equipe inválidos.';
      }
    });
    app.querySelector('#recover-ticket')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const name = document.querySelector('#recovery-name').value.trim();
      const phone = document.querySelector('#recovery-phone').value.trim();
      const error = document.querySelector('#recovery-error');
      if (!name || phone.replace(/\D/g, '').length < 10) {
        error.hidden = false;
        error.textContent = 'Informe o nome completo e o celular usados na compra.';
        return;
      }
      try {
        state.recoveredOrders = await recoverTickets(supabase, { publicToken: state.publicToken, name, phone });
        if (!state.recoveredOrders.length) {
          error.hidden = false;
          error.textContent = 'Não encontramos pedido confirmado com esses dados neste domingo.';
          return;
        }
        render();
      } catch (recoveryError) {
        error.hidden = false;
        error.textContent = 'Não foi possível procurar o comprovante agora. Tente novamente.';
      }
    });
    app.querySelector('#order-search')?.addEventListener('input', (event) => { state.teamSearch = event.target.value; render(); document.querySelector('#order-search')?.focus(); });
    app.querySelector('#manual-quantity')?.addEventListener('change', (event) => {
      const nextQuantity = Number(event.target.value);
      if (!Number.isInteger(nextQuantity) || nextQuantity < 1 || nextQuantity > 10) return;
      state.manualCombos = readManualComboDrafts();
      state.manualCombos = Array.from({ length: nextQuantity }, (_, index) => state.manualCombos[index] ?? createCombo());
      refreshManualComboBuilder();
    });
    app.querySelector('#manual-combo-builder')?.addEventListener('change', (event) => {
      if (!event.target.matches('[data-manual-mode]')) return;
      const removals = event.target.closest('[data-manual-combo]')?.querySelector('.manual-removals');
      if (removals) removals.hidden = event.target.value !== 'customized';
    });
    app.querySelector('#manual-sale')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const name = document.querySelector('#manual-name').value.trim();
      const phone = document.querySelector('#manual-phone').value.trim();
      const quantity = Number(document.querySelector('#manual-quantity').value);
      const serviceMode = document.querySelector('#manual-service-mode').value;
      const error = document.querySelector('#manual-error');
      if (!name || phone.replace(/\D/g, '').length < 10 || !Number.isInteger(quantity) || quantity < 1 || quantity > 10 || !['local', 'takeaway'].includes(serviceMode)) { error.hidden = false; error.textContent = 'Informe nome, celular válido, destino e uma quantidade entre 1 e 10.'; return; }
      const cards = [...app.querySelectorAll('[data-manual-combo]')];
      const incompleteCombo = cards.findIndex((card) => card.querySelector('[data-manual-mode]:checked')?.value === 'customized' && !card.querySelector('[data-manual-ingredient]:checked') && !card.querySelector('[data-manual-note]')?.value.trim());
      if (incompleteCombo >= 0) { error.hidden = false; error.textContent = `No Combo ${incompleteCombo + 1}, marque o que retirar ou escreva uma observação.`; return; }
      const combos = readManualComboDrafts();
      try {
        const order = { customer: { name, phone }, serviceMode, combos, kitchenNote: '', source: 'manual', withdrawn: false, kitchenStatus: 'new' };
        const confirmation = await createManualOrder(supabase, order);
        state.activeOrder = { ...order, code: confirmation.code };
        state.manualCombos = Array.from({ length: quantity }, () => createCombo());
        await Promise.all([refreshTeamOrders(), refreshSale()]);
        state.screen = 'confirmation';
        render();
      } catch (manualError) {
        error.hidden = false;
        error.textContent = manualError.message;
      }
    });
    app.querySelector('#qr-search')?.addEventListener('submit', (event) => {
      event.preventDefault();
      const code = document.querySelector('#qr-code-input').value.trim().toUpperCase();
      state.teamSearch = code;
      render();
    });
    app.querySelector('#stock-settings')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const input = document.querySelector('#stock-total');
      const error = document.querySelector('#stock-error');
      const total = Number(input.value);
      if (!Number.isInteger(total) || total < 0) { error.hidden = false; error.textContent = 'Informe uma quantidade inteira igual ou maior que zero.'; return; }
      try {
        state.sale = await updateStockTotal(supabase, total);
        await refreshSale();
        state.stockSaveNotice = total;
        render();
        window.setTimeout(() => {
          if (state.stockSaveNotice === total && state.screen === 'team') {
            state.stockSaveNotice = null;
            render();
          }
        }, 4500);
      } catch (stockError) {
        error.hidden = false;
        error.textContent = stockError.message;
      }
    });
    app.querySelector('#start-sale')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const name = document.querySelector('#new-sale-name').value.trim();
      const eventDate = document.querySelector('#new-sale-date').value;
      const stockTotal = Number(document.querySelector('#new-sale-stock').value);
      const error = document.querySelector('#new-sale-error');
      if (!name || !eventDate || !Number.isInteger(stockTotal) || stockTotal < 1) { error.hidden = false; error.textContent = 'Informe nome, data e uma quantidade inicial válida.'; return; }
      if (!canCreateSunday(state.sale)) { error.hidden = false; error.textContent = 'Encerre o domingo atual antes de criar outro.'; return; }
      if (!window.confirm('Criar este novo domingo com esta data e quantidade?')) return;
      try {
        state.sale = await createSaleEvent(supabase, { name, eventDate, stockTotal });
        state.publicToken = state.sale.public_token;
        state.orders = await fetchTeamOrders(supabase);
        render();
      } catch (saleError) {
        error.hidden = false;
        error.textContent = saleError.message;
      }
    });
    app.querySelector('[data-action="copy-sale-link"]')?.addEventListener('click', async () => {
      const link = saleUrl(window.location.href, state.sale.public_token);
      try { await navigator.clipboard.writeText(link); window.alert('Link copiado. Agora você pode enviar no grupo ou gerar o cartaz com este QR Code.'); } catch { window.prompt('Copie este link:', link); }
    });
  }

  render();
  refreshSale(true);
  void subscribeToChanges();
}
