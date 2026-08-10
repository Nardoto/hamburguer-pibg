export function orderPayload(order) {
  return {
    customer_name: order.customer.name.trim(),
    customer_phone: order.customer.phone.trim(),
    items: order.combos.map((combo) => ({
      removed: [...combo.removed],
      note: combo.note.trim(),
    })),
  };
}

export function orderRpcPayload(order) {
  const payload = orderPayload(order);
  return {
    p_customer_name: payload.customer_name,
    p_customer_phone: payload.customer_phone,
    p_items: payload.items,
  };
}

const PROJECT_URL = 'https://hcehptespejazgapynus.supabase.co';
const PUBLISHABLE_KEY = 'sb_publishable_TAemfFopX08kB3v04qfm5Q_DQfM0Y0R';

export function orderFromDatabase(row) {
  return {
    id: row.id,
    code: row.code,
    customer: { name: row.customer_name, phone: row.customer_phone },
    source: row.source,
    kitchenStatus: row.kitchen_status,
    kitchenNote: row.kitchen_note,
    withdrawn: Boolean(row.withdrawn_at),
    combos: row.items.map((item) => {
      const removed = Array.isArray(item.removed) ? item.removed : [];
      const note = typeof item.note === 'string' ? item.note : '';
      return { mode: removed.length || note ? 'customized' : 'complete', removed, note };
    }),
  };
}

export function recoveryOrderFromDatabase(row) {
  const order = orderFromDatabase({
    ...row,
    source: 'online',
    kitchen_status: 'new',
    kitchen_note: '',
    withdrawn_at: null,
  });
  delete order.id;
  return order;
}

function operationError(error, fallback) {
  if (!error) return null;
  return new Error(error.message || fallback);
}

export function createPibgClient() {
  if (!globalThis.supabase?.createClient) throw new Error('Não foi possível carregar o serviço de pedidos.');
  return globalThis.supabase.createClient(PROJECT_URL, PUBLISHABLE_KEY);
}

export async function fetchActiveSale(client, publicToken) {
  if (!publicToken) return null;
  const { data, error } = await client.rpc('active_sale_status', { p_public_token: publicToken });
  if (error) throw operationError(error, 'Não foi possível consultar o estoque.');
  return data?.[0];
}

export async function fetchTeamSale(client) {
  const { data, error } = await client.rpc('team_active_sale_status');
  if (error) throw operationError(error, 'Não foi possível consultar a venda atual.');
  return data?.[0];
}

export async function reserveOrder(client, order, publicToken) {
  const { data, error } = await client.rpc('reserve_order', { ...orderRpcPayload(order), p_public_token: publicToken });
  if (error) throw operationError(error, 'Não foi possível reservar os combos.');
  return data?.[0];
}

export async function recoverTickets(client, { publicToken, name, phone }) {
  const { data, error } = await client.rpc('recover_tickets', {
    p_public_token: publicToken,
    p_customer_name: name.trim(),
    p_customer_phone: phone.trim(),
  });
  if (error) throw operationError(error, 'Não foi possível procurar o comprovante agora.');
  return (data ?? []).map(recoveryOrderFromDatabase);
}

export async function confirmOrder(client, orderId, accessToken) {
  const { data, error } = await client.rpc('confirm_order', { p_order_id: orderId, p_access_token: accessToken });
  if (error) throw operationError(error, 'Não foi possível confirmar o pedido.');
  return data?.[0];
}

export async function signInTeam(client, email, password) {
  const { data, error } = await client.auth.signInWithPassword({ email: email.trim(), password });
  if (error) throw operationError(error, 'Não foi possível entrar no painel.');
  return data.user;
}

export async function fetchTeamOrders(client) {
  const { data, error } = await client.rpc('list_team_orders');
  if (error) throw operationError(error, 'Você não tem acesso aos pedidos da equipe.');
  return (data ?? []).map(orderFromDatabase);
}

export async function fetchTeamRole(client) {
  const { data, error } = await client.rpc('current_team_role');
  if (error || !data) throw operationError(error, 'Você não tem acesso aos pedidos da equipe.');
  return data;
}

export async function createManualOrder(client, order) {
  const { data, error } = await client.rpc('create_manual_order', {
    ...orderRpcPayload(order),
    p_kitchen_note: order.kitchenNote?.trim() ?? '',
  });
  if (error) throw operationError(error, 'Não foi possível registrar a venda presencial.');
  return data?.[0];
}

export async function updateKitchenStatus(client, orderId, kitchenStatus) {
  const { error } = await client.rpc('set_kitchen_status', { p_order_id: orderId, p_kitchen_status: kitchenStatus });
  if (error) throw operationError(error, 'Não foi possível atualizar a cozinha.');
}

export async function withdrawOrder(client, orderId) {
  const { error } = await client.rpc('mark_order_withdrawn', { p_order_id: orderId });
  if (error) throw operationError(error, 'Não foi possível registrar a retirada.');
}

export async function updateStockTotal(client, stockTotal) {
  const { data, error } = await client.rpc('set_active_stock_total', { p_stock_total: stockTotal });
  if (error) throw operationError(error, 'Não foi possível atualizar a quantidade de combos.');
  return data?.[0];
}

export async function createSaleEvent(client, { name, eventDate, stockTotal }) {
  const { data, error } = await client.rpc('start_sale_event', { p_name: name.trim(), p_event_date: eventDate, p_stock_total: stockTotal });
  if (error) throw operationError(error, 'Não foi possível criar o novo domingo.');
  return data?.[0];
}

export async function endSaleEvent(client) {
  const { error } = await client.rpc('end_active_sale_event');
  if (error) throw operationError(error, 'Não foi possível encerrar o domingo atual.');
}
