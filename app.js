import {
  confirmOrder,
  createSaleEvent,
  createManualOrder,
  createPibgClient,
  fetchActiveSale,
  fetchTeamRole,
  fetchTeamSale,
  fetchTeamOrders,
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
  url.searchParams.set('v', publicToken);
  return url.toString();
}

export function setKitchenStatus(order, kitchenStatus) {
  return { ...order, kitchenStatus };
}

if (typeof document !== 'undefined') {
  const state = {
    screen: 'home',
    quantity: 1,
    combos: [],
    activeCombo: 0,
    customer: { name: '', phone: '' },
    orders: [],
    activeOrder: null,
    teamAuthorized: false,
    teamRole: null,
    teamSearch: '',
    scanning: false,
    qrStream: null,
    qrScanFrame: null,
    sale: null,
    publicToken: new URLSearchParams(window.location.search).get('v'),
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

  function renderHome() {
    if (!state.sale) {
      return `<div class="app-shell"><section class="page"><header class="page-head"><div class="brand">HAMBÚRGUER <span>PIBG</span></div><button class="menu-button" data-action="open-team" aria-label="Abrir painel da equipe"></button></header><div class="sale-closed"><span>VENDA ENCERRADA</span><h1>Este link não é do domingo atual.</h1><p>Use o QR Code divulgado pela igreja para abrir a venda certa. Cada domingo possui um link e estoque próprios.</p></div></section></div>`;
    }
    return `<div class="app-shell"><section class="page">
      <header class="page-head"><div class="brand">HAMBÚRGUER <span>PIBG</span></div><button class="menu-button" data-action="open-team" aria-label="Abrir painel da equipe"></button></header>
      <div class="hero-image"><div class="hero-topline"><span class="pill"><i class="live-dot"></i>VENDA DE DOMINGO</span><span class="pill">ESTOQUE AO VIVO</span></div><div class="hero-caption"><p>COMBO ARTESANAL</p><h1>FOME DE<br>VERDADE.<small>COMPRA SEM FILA.</small></h1></div></div>
      <div class="content"><div class="product-copy"><div><h2>O combo que salva seu domingo.</h2><p>Bife caseiro de 140 g, alface, tomate, bacon, barbecue, muçarela e refrigerante de 200 ml.</p></div><div class="price">R$ 25</div></div>
      <div class="ingredient-tags"><span>140 g</span><span>Bacon crocante</span><span>Muçarela</span><span>Refri 200 ml</span></div>
      <div class="stock-note"><strong>${availableStock()} combos disponíveis</strong><small>Estoque atualizado em tempo real</small></div>
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
    return `<div class="app-shell"><section class="page"><div class="content confirmation"><div class="success-mark" role="img" aria-label="Pedido confirmado"><svg viewBox="0 0 24 24"><path d="m5 12 4 4L19 6"/></svg></div><h1>Pedido<br>confirmado!</h1><p>${escapeHtml(order.customer.name)}, seu pedido está confirmado. Ao final do culto, mostre este QR Code para a equipe.</p><div class="pickup-ticket"><small>CÓDIGO DE RETIRADA</small><strong>${order.code}</strong><span>${order.combos.length} ${order.combos.length === 1 ? 'combo' : 'combos'} · ${money(calculateTotal(order.combos))}</span></div><div class="pickup-qr-card"><div id="pickup-qr" aria-label="QR Code do pedido ${escapeHtml(order.code)}"></div><span>A equipe escaneia e confirma sua retirada.</span></div><button class="pdf-button" data-action="download-ticket">Baixar comprovante em PDF</button><p>Você também pode procurar pelo celular cadastrado: ${escapeHtml(order.customer.phone)}.</p></div>${actionBar('COMPRA CONFIRMADA', calculateTotal(order.combos), 'home', 'Voltar ao cardápio')}</section></div>`;
  }

  function renderTeamLogin() {
    return `<div class="app-shell"><section class="page"><header class="team-top"><button class="back-button" data-action="home" aria-label="Voltar ao cardápio"></button><h1>Painel<br>da equipe.</h1><p>Acesso exclusivo para voluntários autorizados.</p></header><div class="team-card"><form id="team-login"><label class="field"><span>E-MAIL DA EQUIPE</span><input id="team-email" type="email" autocomplete="email" placeholder="voluntario@igreja.com"></label><label class="field"><span>SENHA DA EQUIPE</span><input id="team-password" type="password" autocomplete="current-password" placeholder="Digite a senha"></label><p class="error" id="team-error" hidden></p><button class="primary-button" type="submit">Entrar no painel</button></form><p class="step-intro">Use o e-mail e a senha liberados pelo administrador.</p></div></section></div>`;
  }

  function renderTeam() {
    const normalizedSearch = state.teamSearch.trim().toLowerCase();
    const orders = state.orders.filter((order) => !normalizedSearch || `${order.code} ${order.customer.name} ${order.customer.phone}`.toLowerCase().includes(normalizedSearch));
    const rows = orders.length ? orders.map((order) => `<div class="order-row"><div><b>${escapeHtml(order.customer.name)}</b><span>${order.code} · ${order.combos.length} ${order.combos.length === 1 ? 'combo' : 'combos'} · ${order.source === 'manual' ? 'presencial' : 'on-line'}${hasKitchenAdjustment(order) ? `<br>${escapeHtml(kitchenDetails(order))}` : ''}</span></div>${order.withdrawn ? '<span class="status withdrawn">RETIRADO</span>' : `<button class="secondary-button" data-action="withdraw" data-id="${order.id}">Entregar pedido</button>`}</div>`).join('') : '<p class="step-intro">Nenhum pedido encontrado.</p>';
    const sold = state.sale.confirmed_quantity;
    const scanner = state.scanning ? `<div class="scan-panel"><video id="scan-video" playsinline muted></video><p>Aponte a câmera para o QR Code do comprovante.</p><button class="secondary-button" data-action="stop-scan">Cancelar leitura</button></div>` : '';
    const publicLink = state.sale?.public_token ? saleUrl(window.location.href, state.sale.public_token) : '';
    const stockSettings = isAdminRole(state.teamRole) ? `<div class="team-card admin-card"><span class="section-label">ADMINISTRAÇÃO DA VENDA</span><form id="start-sale" class="team-form"><label class="field"><span>NOVO DOMINGO</span><input id="new-sale-name" value="Hambúrguer PIBG — próximo domingo" maxlength="100"><small>Criar uma nova venda encerra o link e os pedidos do domingo anterior.</small></label><label class="field"><span>DATA DA VENDA</span><input id="new-sale-date" type="date" required></label><label class="field"><span>QUANTIDADE INICIAL</span><input id="new-sale-stock" type="number" min="1" value="150"></label><button class="primary-button" type="submit">Criar novo domingo</button><p class="error" id="new-sale-error" hidden></p></form>${state.sale ? `<form id="stock-settings" class="team-form admin-divider"><label class="field"><span>QUANTIDADE TOTAL DE COMBOS</span><input id="stock-total" type="number" min="0" value="${state.sale.stock_total}"><small>Não pode ser menor que os pedidos já confirmados ou reservados.</small></label><button class="secondary-button" type="submit">Salvar quantidade</button><p class="error" id="stock-error" hidden></p></form><div class="sale-link-card"><b>LINK PÚBLICO DESTE DOMINGO</b><input readonly value="${escapeHtml(publicLink)}" aria-label="Link público da venda"><div id="sale-link-qr" aria-label="QR Code para abrir esta venda"></div><button class="secondary-button" data-action="copy-sale-link">Copiar link</button></div>` : ''}</div>` : '';
    return `<div class="app-shell"><section class="page"><header class="team-top"><div class="header-actions"><button class="back-button" data-action="home" aria-label="Voltar ao cardápio"></button><button class="kitchen-button" data-action="open-kitchen">Cozinha</button></div><h1>Recepção<br>PIBG.</h1><p>Leia o QR Code do cliente, confira o pedido e marque a retirada.</p></header><div class="team-card scanner-card"><span class="section-label">ENTREGA RÁPIDA</span><button class="scan-button" data-action="start-scan">Ler QR Code do cliente</button><form id="qr-search" class="qr-search"><input id="qr-code-input" value="${escapeHtml(state.teamSearch.startsWith('PIBG-') ? state.teamSearch : '')}" placeholder="Ou digite: PIBG-0025" autocapitalize="characters"><button class="secondary-button" type="submit">Buscar</button></form>${scanner}</div><div class="team-card"><div class="team-stats"><div class="stat"><b>${availableStock()}</b><span>DISPONÍVEIS</span></div><div class="stat"><b>${sold}</b><span>VENDIDOS</span></div></div></div>${stockSettings}<div class="team-card"><label class="field"><span>BUSCAR PEDIDO</span><input id="order-search" value="${escapeHtml(state.teamSearch)}" placeholder="Nome, celular ou código"></label><span class="section-label">PEDIDOS CONFIRMADOS</span>${rows}</div><div class="team-card"><span class="section-label">NOVA VENDA PRESENCIAL</span><form id="manual-sale" class="team-form"><label class="field"><span>NOME</span><input id="manual-name" placeholder="Nome da pessoa"></label><label class="field"><span>CELULAR</span><input id="manual-phone" inputmode="tel" placeholder="(00) 00000-0000"></label><label class="field"><span>QUANTIDADE DE COMBOS</span><input id="manual-quantity" type="number" min="1" max="10" value="1"></label><label class="field"><span>AJUSTES PARA A COZINHA</span><textarea id="manual-kitchen-note" placeholder="Ex.: 1 sem tomate e alface; os demais completos."></textarea><small>Preencha apenas se algum hambúrguer for diferente. Pedidos completos entram na leva padrão.</small></label><button class="primary-button" type="submit">Registrar venda presencial</button><p class="error" id="manual-error" hidden></p></form></div></section></div>`;
  }

  function renderKitchenOrder(order) {
    const separated = order.kitchenStatus === 'ready';
    const adjustments = kitchenDetails(order).split(' | ').map((detail) => `<span>${escapeHtml(detail.replace(/^Combo \d+: /, ''))}</span>`).join('');
    return `<article class="kitchen-order ${separated ? 'separated' : ''}"><div class="kitchen-order-top"><strong>${shortOrderNumber(order.code)}</strong><div><h3>${escapeHtml(order.customer.name)}</h3><p class="kitchen-count">${order.code} · ${order.combos.length} ${order.combos.length === 1 ? 'hambúrguer' : 'hambúrgueres'}</p></div></div><div class="kitchen-details">${adjustments}</div><button class="kitchen-action" data-action="set-kitchen-status" data-id="${order.id}" data-status="${separated ? 'new' : 'ready'}">${separated ? 'Voltar para ajustes' : 'Marcar como separado'}</button></article>`;
  }

  function renderKitchen() {
    const specialOrders = state.orders.filter((order) => !order.withdrawn && hasKitchenAdjustment(order));
    const pending = specialOrders.filter((order) => order.kitchenStatus !== 'ready');
    const separated = specialOrders.filter((order) => order.kitchenStatus === 'ready');
    return `<div class="app-shell kitchen-shell"><section class="page kitchen-page"><header class="team-top kitchen-top"><div class="header-actions"><button class="back-button" data-action="open-team" aria-label="Voltar à recepção"></button><span class="kitchen-live">COZINHA AO VIVO</span></div><h1>Ajustes<br>especiais.</h1><p>Os completos entram apenas na leva padrão. Aqui aparecem só os hambúrgueres diferentes.</p></header><main class="kitchen-grid"><section class="batch-card"><span>PRÓXIMA LEVA</span><strong>15 completos</strong><p>Prepare normalmente. Não precisam aparecer nesta tela.</p></section><section class="kitchen-column"><div class="kitchen-column-head"><h2>Separar na montagem</h2><span>${pending.length}</span></div><div class="kitchen-list">${pending.length ? pending.map(renderKitchenOrder).join('') : '<p class="kitchen-empty">Nenhum ajuste pendente. A produção padrão pode seguir.</p>'}</div></section><section class="kitchen-column kitchen-ready"><div class="kitchen-column-head"><h2>Já separados</h2><span>${separated.length}</span></div><div class="kitchen-list">${separated.length ? separated.map(renderKitchenOrder).join('') : '<p class="kitchen-empty">Os pedidos separados aparecerão aqui.</p>'}</div></section></main></section></div>`;
  }

  function render() {
    const views = { home: renderHome, customize: renderCustomize, checkout: renderCheckout, pix: renderPix, confirmation: renderConfirmation, team: () => state.teamAuthorized ? renderTeam() : renderTeamLogin(), kitchen: () => state.teamAuthorized ? renderKitchen() : renderTeamLogin() };
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

  function subscribeToChanges() {
    supabase.channel('hamburguer-pibg-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sales_events' }, () => refreshSale(true))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => refreshTeamOrders(true))
      .subscribe();
  }

  function renderPickupQr() {
    const target = app.querySelector('#pickup-qr');
    if (!target || !state.activeOrder?.code) return;
    if (!window.QRCode) { target.textContent = state.activeOrder.code; return; }
    target.replaceChildren();
    new window.QRCode(target, { text: state.activeOrder.code, width: 132, height: 132, colorDark: '#1a110e', colorLight: '#fffdf9', correctLevel: window.QRCode.CorrectLevel.M });
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
    if (state.qrScanFrame) window.cancelAnimationFrame(state.qrScanFrame);
    state.qrScanFrame = null;
    state.qrStream?.getTracks().forEach((track) => track.stop());
    state.qrStream = null;
    state.scanning = false;
  }

  async function startQrScanner() {
    if (!window.BarcodeDetector || !navigator.mediaDevices?.getUserMedia) {
      window.alert('A leitura pela câmera não está disponível neste navegador. Digite o código PIBG-0000 mostrado no comprovante.');
      state.scanning = false;
      render();
      return;
    }
    try {
      const video = app.querySelector('#scan-video');
      state.qrStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      video.srcObject = state.qrStream;
      await video.play();
      const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
      const scan = async () => {
        if (!state.scanning || !video.isConnected) return;
        const result = await detector.detect(video);
        const code = result[0]?.rawValue?.trim().toUpperCase();
        if (code && /^PIBG-\d{4,}$/.test(code)) {
          stopQrScanner();
          state.teamSearch = code;
          render();
          return;
        }
        state.qrScanFrame = window.requestAnimationFrame(scan);
      };
      scan();
    } catch (error) {
      stopQrScanner();
      window.alert('Não foi possível abrir a câmera. Verifique a permissão e tente novamente.');
      render();
    }
  }

  function downloadTicket(order) {
    const JsPdf = window.jspdf?.jsPDF;
    if (!JsPdf) {
      window.alert('Não foi possível preparar o PDF agora. Tente novamente em alguns instantes.');
      return;
    }
    const pdf = new JsPdf({ orientation: 'portrait', unit: 'mm', format: 'a5' });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
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
      if (y + lines.length * 6 + 3 > pageHeight - 25) {
        pdf.addPage();
        pdf.setTextColor(41, 23, 18);
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(11);
        pdf.text('DETALHES DO PEDIDO — CONTINUAÇÃO', 15, 24);
        y = 34;
      }
      pdf.text(lines, 15, y);
      y += lines.length * 6 + 3;
    });
    if (y + 38 > pageHeight - 15) {
      pdf.addPage();
      y = 24;
    }
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
    app.querySelectorAll('[data-action]').forEach((element) => element.addEventListener('click', async () => {
      const action = element.dataset.action;
      if (action === 'quantity') { state.quantity = Math.max(1, Math.min(10, state.quantity + Number(element.dataset.delta))); render(); }
      if (action === 'start-order') { goToCustomization(); render(); }
      if (action === 'home') { stopQrScanner(); state.screen = 'home'; render(); }
      if (action === 'customize') { state.screen = 'customize'; render(); }
      if (action === 'checkout') { syncCurrentCombo(); state.screen = 'checkout'; render(); }
      if (action === 'select-combo') { syncCurrentCombo(); state.activeCombo = Number(element.dataset.index); render(); }
      if (action === 'mode') { const combo = state.combos[state.activeCombo]; state.combos[state.activeCombo] = element.dataset.mode === 'complete' ? { ...combo, mode: 'complete', removed: [], note: '' } : { ...combo, mode: 'customized' }; render(); }
      if (action === 'next-combo') { syncCurrentCombo(); state.activeCombo += 1; render(); }
      if (action === 'to-checkout') { syncCurrentCombo(); state.screen = 'checkout'; render(); }
      if (action === 'to-pix') {
        const name = document.querySelector('#customer-name').value.trim();
        const phone = document.querySelector('#customer-phone').value.trim();
        const error = document.querySelector('#form-error');
        if (!name || phone.replace(/\D/g, '').length < 10) { error.hidden = false; error.textContent = 'Informe seu nome e um celular válido para continuar.'; return; }
        state.customer = { name, phone };
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
      if (action === 'open-kitchen') { stopQrScanner(); await refreshTeamOrders(); state.screen = 'kitchen'; render(); }
      if (action === 'start-scan') { state.scanning = true; render(); await startQrScanner(); }
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
        state.screen = 'team';
        render();
      } catch (loginError) {
        error.hidden = false;
        error.textContent = 'E-mail, senha ou autorização da equipe inválidos.';
      }
    });
    app.querySelector('#order-search')?.addEventListener('input', (event) => { state.teamSearch = event.target.value; render(); document.querySelector('#order-search')?.focus(); });
    app.querySelector('#manual-sale')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const name = document.querySelector('#manual-name').value.trim();
      const phone = document.querySelector('#manual-phone').value.trim();
      const quantity = Number(document.querySelector('#manual-quantity').value);
      const kitchenNote = document.querySelector('#manual-kitchen-note').value.trim();
      const error = document.querySelector('#manual-error');
      if (!name || phone.replace(/\D/g, '').length < 10 || !Number.isInteger(quantity) || quantity < 1 || quantity > 10) { error.hidden = false; error.textContent = 'Informe nome, celular válido e uma quantidade entre 1 e 10.'; return; }
      try {
        const order = { customer: { name, phone }, combos: Array.from({ length: quantity }, () => createCombo()), kitchenNote, source: 'manual', withdrawn: false, kitchenStatus: 'new' };
        const confirmation = await createManualOrder(supabase, order);
        state.activeOrder = { ...order, code: confirmation.code };
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
        render();
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
      if (!window.confirm('Criar este novo domingo? O link da venda anterior será encerrado.')) return;
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
  subscribeToChanges();
}
