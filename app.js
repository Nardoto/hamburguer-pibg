export const INGREDIENTS = ['Alface', 'Tomate', 'Bacon', 'Barbecue', 'Queijo muçarela'];
export const COMBO_PRICE = 25;
export const COMPLETE_COMBO_DETAILS = 'bife 140 g, alface, tomate, bacon, barbecue, muçarela e refrigerante 200 ml';

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
    return `Combo ${index + 1}: ${details.length ? details.join(' · ') : `Completo - ${COMPLETE_COMBO_DETAILS}`}`;
  });
}

export function ticketHeader(order) {
  return `RETIRADA DE ${order.customer.name.trim().toUpperCase()}`;
}

if (typeof document !== 'undefined') {
  const STOCK_LIMIT = 150;
  const state = {
    screen: 'home',
    quantity: 1,
    combos: [],
    activeCombo: 0,
    customer: { name: '', phone: '' },
    orders: [],
    activeOrder: null,
    teamAuthorized: false,
    teamSearch: '',
  };

  const app = document.querySelector('#app');
  const money = (value) => value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const escapeHtml = (value) => String(value).replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character]);
  const availableStock = () => Math.max(STOCK_LIMIT - state.orders.reduce((total, order) => total + order.combos.length, 0), 0);
  const orderCode = () => `PIBG-${String(state.orders.length + 1).padStart(4, '0')}`;

  function comboDescription(combo) {
    const parts = [];
    if (combo.removed.length) parts.push(`Sem ${combo.removed.join(', ')}`);
    if (combo.note) parts.push(combo.note);
    return parts.length ? parts.join(' · ') : 'Completo';
  }

  function actionBar(label, total, action, actionLabel) {
    return `<div class="sticky-action"><div class="sticky-inner"><div><small>${label}</small><strong>${money(total)}</strong></div><button class="primary-button" data-action="${action}">${actionLabel}</button></div></div>`;
  }

  function renderHome() {
    return `<div class="app-shell"><section class="page">
      <header class="page-head"><div class="brand">HAMBÚRGUER <span>PIBG</span></div><button class="menu-button" data-action="open-team" aria-label="Abrir painel da equipe"></button></header>
      <div class="hero-image"><div class="hero-topline"><span class="pill"><i class="live-dot"></i>VENDA DE DOMINGO</span><span class="pill">ESTOQUE AO VIVO</span></div><div class="hero-caption"><p>COMBO ARTESANAL</p><h1>FOME DE<br>VERDADE.<small>COMPRA SEM FILA.</small></h1></div></div>
      <div class="content"><div class="product-copy"><div><h2>O combo que salva seu domingo.</h2><p>Bife caseiro de 140 g, alface, tomate, bacon, barbecue, muçarela e refrigerante de 200 ml.</p></div><div class="price">R$ 25</div></div>
      <div class="ingredient-tags"><span>140 g</span><span>Bacon crocante</span><span>Muçarela</span><span>Refri 200 ml</span></div>
      <div class="stock-note"><strong>${availableStock()} combos disponíveis</strong><small>Valor demonstrativo no protótipo</small></div>
      <span class="section-label">QUANTOS COMBOS VOCÊ QUER?</span><div class="quantity"><button data-action="quantity" data-delta="-1" aria-label="Diminuir quantidade">−</button><output>${state.quantity}</output><button data-action="quantity" data-delta="1" aria-label="Aumentar quantidade">+</button></div></div>
      ${actionBar(`${state.quantity} ${state.quantity === 1 ? 'COMBO' : 'COMBOS'} · MONTE DO SEU JEITO`, state.quantity * COMBO_PRICE, 'start-order', 'Montar pedido')}
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
      <form id="customer-form" novalidate><label class="field"><span>SEU NOME</span><input id="customer-name" value="${escapeHtml(state.customer.name)}" autocomplete="name" placeholder="Como podemos te chamar?"></label><label class="field"><span>SEU CELULAR</span><input id="customer-phone" value="${escapeHtml(state.customer.phone)}" inputmode="tel" autocomplete="tel" placeholder="(00) 00000-0000"></label><p class="error" id="form-error" hidden></p></form></div>${actionBar('SEU PEDIDO ESTÁ QUASE PRONTO', calculateTotal(state.combos), 'to-pix', 'Gerar Pix')}</section></div>`;
  }

  function renderPix() {
    return `<div class="app-shell"><section class="page"><div class="content"><div class="step-head"><button class="back-button" data-action="checkout" aria-label="Voltar aos dados"></button><div class="progress"><span class="active"></span><span class="active"></span><span class="active"></span></div><h1 class="step-title">Pague no Pix<br>e garanta o seu.</h1><p class="step-intro">No sistema final, esta cobrança será criada pelo Mercado Pago e confirmada automaticamente.</p></div><div class="pix-card"><span class="demo-badge">PAGAMENTO SIMULADO</span><div class="pix-grid" aria-label="QR Code demonstrativo"></div><p>Abra o aplicativo do seu banco, escaneie o código e confirme o pagamento.</p></div><div class="summary"><div class="summary-total"><span>Total do pedido</span><span>${money(calculateTotal(state.combos))}</span></div></div></div>${actionBar('PIX DEMONSTRATIVO', calculateTotal(state.combos), 'confirm-payment', 'Simular pagamento')}</section></div>`;
  }

  function renderConfirmation() {
    const order = state.activeOrder;
    return `<div class="app-shell"><section class="page"><div class="content confirmation"><div class="success-mark" role="img" aria-label="Pedido confirmado"><svg viewBox="0 0 24 24"><path d="m5 12 4 4L19 6"/></svg></div><h1>Pedido<br>confirmado!</h1><p>${escapeHtml(order.customer.name)}, seu pedido está reservado. Ao final do culto, mostre este código para a equipe.</p><div class="pickup-ticket"><small>CÓDIGO DE RETIRADA</small><strong>${order.code}</strong><span>${order.combos.length} ${order.combos.length === 1 ? 'combo' : 'combos'} · ${money(calculateTotal(order.combos))}</span></div><button class="pdf-button" data-action="download-ticket">Baixar comprovante em PDF</button><p>Você também pode procurar pelo celular cadastrado: ${escapeHtml(order.customer.phone)}.</p></div>${actionBar('COMPRA CONFIRMADA', calculateTotal(order.combos), 'open-team', 'Painel da equipe')}</section></div>`;
  }

  function renderTeamLogin() {
    return `<div class="app-shell"><section class="page"><header class="team-top"><button class="back-button" data-action="home" aria-label="Voltar ao cardápio"></button><h1>Painel<br>da equipe.</h1><p>Acesso de demonstração para os voluntários.</p></header><div class="team-card"><form id="team-login"><label class="field"><span>SENHA DA EQUIPE</span><input id="team-password" type="password" placeholder="Digite a senha"></label><p class="error" id="team-error" hidden></p><button class="primary-button" type="submit">Entrar no painel</button></form><p class="step-intro">No protótipo, use a senha <strong>domingo</strong>.</p></div></section></div>`;
  }

  function renderTeam() {
    const normalizedSearch = state.teamSearch.trim().toLowerCase();
    const orders = state.orders.filter((order) => !normalizedSearch || `${order.code} ${order.customer.name} ${order.customer.phone}`.toLowerCase().includes(normalizedSearch));
    const rows = orders.length ? orders.map((order) => `<div class="order-row"><div><b>${escapeHtml(order.customer.name)}</b><span>${order.code} · ${order.combos.length} ${order.combos.length === 1 ? 'combo' : 'combos'} · ${order.source === 'manual' ? 'presencial' : 'on-line'}${order.combos.some((combo) => combo.mode === 'customized') ? '<br>Pedido com ajustes: confira antes de entregar.' : ''}</span></div>${order.withdrawn ? '<span class="status withdrawn">RETIRADO</span>' : `<button class="secondary-button" data-action="withdraw" data-code="${order.code}">Entregar pedido</button>`}</div>`).join('') : '<p class="step-intro">Nenhum pedido encontrado.</p>';
    const sold = state.orders.reduce((total, order) => total + order.combos.length, 0);
    return `<div class="app-shell"><section class="page"><header class="team-top"><button class="back-button" data-action="home" aria-label="Voltar ao cardápio"></button><h1>Painel<br>administrativo.</h1><p>Vendas on-line e presenciais no mesmo lugar.</p></header><div class="team-card"><div class="team-stats"><div class="stat"><b>${availableStock()}</b><span>DISPONÍVEIS</span></div><div class="stat"><b>${sold}</b><span>VENDIDOS</span></div></div></div><div class="team-card"><label class="field"><span>BUSCAR PEDIDO</span><input id="order-search" value="${escapeHtml(state.teamSearch)}" placeholder="Nome, celular ou código"></label><span class="section-label">PEDIDOS CONFIRMADOS</span>${rows}</div><div class="team-card"><span class="section-label">NOVA VENDA PRESENCIAL</span><form id="manual-sale" class="team-form"><label class="field"><span>NOME</span><input id="manual-name" placeholder="Nome da pessoa"></label><label class="field"><span>CELULAR</span><input id="manual-phone" inputmode="tel" placeholder="(00) 00000-0000"></label><label class="field"><span>QUANTIDADE DE COMBOS</span><input id="manual-quantity" type="number" min="1" max="10" value="1"></label><button class="primary-button" type="submit">Registrar pagamento e pedido</button><p class="error" id="manual-error" hidden></p></form></div></section></div>`;
  }

  function render() {
    const views = { home: renderHome, customize: renderCustomize, checkout: renderCheckout, pix: renderPix, confirmation: renderConfirmation, team: () => state.teamAuthorized ? renderTeam() : renderTeamLogin() };
    app.innerHTML = views[state.screen]();
    bindEvents();
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
      code: orderCode(),
      customer: { ...state.customer },
      combos: state.combos.map((combo) => ({ ...combo, removed: [...combo.removed] })),
      withdrawn: false,
      source: 'online',
    };
  }

  function downloadTicket(order) {
    const JsPdf = window.jspdf?.jsPDF;
    if (!JsPdf) {
      window.alert('Não foi possível preparar o PDF agora. Tente novamente em alguns instantes.');
      return;
    }
    const pdf = new JsPdf({ orientation: 'portrait', unit: 'mm', format: 'a5' });
    const pageWidth = pdf.internal.pageSize.getWidth();
    pdf.setFillColor(26, 17, 14);
    pdf.rect(0, 0, pageWidth, 44, 'F');
    pdf.setTextColor(255, 194, 71);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(25);
    pdf.text('HAMBURGUER PIBG', 15, 19);
    pdf.setTextColor(255, 244, 221);
    pdf.setFontSize(10);
    pdf.text('COMPROVANTE DE RETIRADA', 15, 30);
    pdf.setFillColor(255, 244, 221);
    pdf.roundedRect(15, 53, pageWidth - 30, 27, 4, 4, 'F');
    pdf.setTextColor(41, 23, 18);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(8);
    pdf.text('NOME PARA RETIRADA', 20, 62);
    pdf.setFontSize(16);
    pdf.text(ticketHeader(order).replace('RETIRADA DE ', ''), 20, 73);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(9);
    pdf.text(`Celular: ${order.customer.phone}`, 15, 88);
    pdf.setFillColor(255, 194, 71);
    pdf.roundedRect(15, 97, pageWidth - 30, 38, 4, 4, 'F');
    pdf.setTextColor(41, 23, 18);
    pdf.setFontSize(9);
    pdf.text('CODIGO DE RETIRADA', pageWidth / 2, 109, { align: 'center' });
    pdf.setFontSize(28);
    pdf.setFont('helvetica', 'bold');
    pdf.text(order.code, pageWidth / 2, 125, { align: 'center' });
    pdf.setTextColor(41, 23, 18);
    pdf.setFontSize(11);
    pdf.text('DETALHES DO PEDIDO', 15, 151);
    let y = 160;
    ticketLines(order).forEach((line) => {
      const lines = pdf.splitTextToSize(line, pageWidth - 30);
      pdf.text(lines, 15, y);
      y += lines.length * 6 + 3;
    });
    pdf.setDrawColor(229, 201, 158);
    pdf.line(15, y + 4, pageWidth - 15, y + 4);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(13);
    pdf.text(`Total: ${money(calculateTotal(order.combos))}`, 15, y + 16);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(9);
    pdf.setTextColor(118, 80, 66);
    pdf.text('Apresente este comprovante no celular para retirar seu pedido ao final do culto.', 15, y + 29, { maxWidth: pageWidth - 30 });
    pdf.save(ticketFilename(order));
  }

  function bindEvents() {
    app.querySelectorAll('[data-action]').forEach((element) => element.addEventListener('click', () => {
      const action = element.dataset.action;
      if (action === 'quantity') { state.quantity = Math.max(1, Math.min(10, state.quantity + Number(element.dataset.delta))); render(); }
      if (action === 'start-order') { goToCustomization(); render(); }
      if (action === 'home') { state.screen = 'home'; render(); }
      if (action === 'customize') { state.screen = 'customize'; render(); }
      if (action === 'checkout') { syncCurrentCombo(); state.screen = 'checkout'; render(); }
      if (action === 'select-combo') { syncCurrentCombo(); state.activeCombo = Number(element.dataset.index); render(); }
      if (action === 'mode') { const combo = state.combos[state.activeCombo]; state.combos[state.activeCombo] = element.dataset.mode === 'complete' ? { ...combo, mode: 'complete', removed: [], note: '' } : { ...combo, mode: 'customized' }; render(); }
      if (action === 'next-combo') { syncCurrentCombo(); state.activeCombo += 1; render(); }
      if (action === 'to-checkout') { syncCurrentCombo(); state.screen = 'checkout'; render(); }
      if (action === 'to-pix') { const name = document.querySelector('#customer-name').value.trim(); const phone = document.querySelector('#customer-phone').value.trim(); const error = document.querySelector('#form-error'); if (!name || phone.replace(/\D/g, '').length < 10) { error.hidden = false; error.textContent = 'Informe seu nome e um celular válido para continuar.'; return; } state.customer = { name, phone }; createActiveOrder(); state.screen = 'pix'; render(); }
      if (action === 'confirm-payment') { state.orders.push(state.activeOrder); state.screen = 'confirmation'; render(); }
      if (action === 'open-team') { state.screen = 'team'; render(); }
      if (action === 'download-ticket') { downloadTicket(state.activeOrder); }
      if (action === 'withdraw') { state.orders = state.orders.map((order) => order.code === element.dataset.code ? markWithdrawn(order) : order); render(); }
    }));

    app.querySelector('#team-login')?.addEventListener('submit', (event) => { event.preventDefault(); const error = document.querySelector('#team-error'); if (document.querySelector('#team-password').value !== 'domingo') { error.hidden = false; error.textContent = 'Senha incorreta. No protótipo, use domingo.'; return; } state.teamAuthorized = true; render(); });
    app.querySelector('#order-search')?.addEventListener('input', (event) => { state.teamSearch = event.target.value; render(); document.querySelector('#order-search')?.focus(); });
    app.querySelector('#manual-sale')?.addEventListener('submit', (event) => { event.preventDefault(); const name = document.querySelector('#manual-name').value.trim(); const phone = document.querySelector('#manual-phone').value.trim(); const quantity = Number(document.querySelector('#manual-quantity').value); const error = document.querySelector('#manual-error'); if (!name || phone.replace(/\D/g, '').length < 10 || !Number.isInteger(quantity) || quantity < 1 || quantity > 10) { error.hidden = false; error.textContent = 'Informe nome, celular válido e uma quantidade entre 1 e 10.'; return; } if (quantity > availableStock()) { error.hidden = false; error.textContent = 'Não há combos suficientes disponíveis para esta venda.'; return; } state.orders.push({ code: orderCode(), customer: { name, phone }, combos: Array.from({ length: quantity }, () => createCombo()), withdrawn: false, source: 'manual' }); render(); });
  }

  render();
}
