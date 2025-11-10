/* script.js - ATUALIZADO PARA FIREBASE REALTIME DATABASE E AUTENTICAÇÃO */

// -------------------- Config / constantes --------------------
const CARTAO_IDS = ['💳 Cartão 1', '💳 Cartão 2', '💳 Cartão 3'];
const DINHEIRO_PIX_IDS = ['💵 Dinheiro', '📲 PIX'];
const MESES_PT = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];

// Path de Armazenamento BASE (será concatenado com o UID do usuário)
const FIREBASE_BASE_PATH = 'data/'; 

// listas usadas nos selects
const LISTAS = {
  plataformas: [
    { value: '🏍️ Uber Moto', label: '🏍️ Uber Moto' },
    { value: '🛵 99 Moto', label: '🛵 99 Moto' },
    { value: '📦 Shopee', label: '📦 Shopee' },
    { value: '🌐 Vendas Online', label: '🌐 Vendas Online' }
  ],
  pagamentos: [
    ...DINHEIRO_PIX_IDS.map(id => ({ value: id, label: id })),
    ...CARTAO_IDS.map(id => ({ value: id, label: id }))
  ],
  categorias: [
    { value: 'Combustível', label: '⛽ Combustível' },
    { value: 'Alimentação', label: '🍔 Alimentação' },
    { value: 'Manutenção Moto', label: '🛠️ Manutenção Moto' },
  	 { value: 'Pessoal', label: '👤 Pessoal' },
  	 { value: 'Assinaturas', label: '🔔 Assinaturas' },
  	 { value: 'Moradia/Aluguel', label: '🏠 Moradia/Aluguel' },
  	 { value: 'Contas Fixas', label: '🧾 Contas Fixas' },
  	 { value: 'Outros', label: '❓ Outros' }
  ]
};

// -------------------- Estado Global e Auth --------------------
let currentMonthDate = new Date(); // inicializa com mês atual
let currentMonthKey = formatMonthKey(currentMonthDate);
let currentUserId = null; // ID do usuário logado (UID) - NOVO

let entries = [];       // lista de entradas do mês
let expenses = [];      // despesas variáveis do mês
let fixedExpenses = []; // despesas fixas / projeções do mês
let cardMonthlyData = {}; // { initialBalances: {...}, monthlyExpenses: {...}, startingCash, closingCash }
let masterPlans = {};   // plano mestre para fixos/parcelados

// Chart instances
let chartDonut = null;
let chartBar = null;

// -------------------- Utilitários --------------------
function formatBRL(value) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value || 0);
}
function formatMonthKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

// Funções de referência do Firebase (USAM O ID DO USUÁRIO)
function getDataRef(type, monthKey = currentMonthKey) {
  if (!currentUserId) return null; // VERIFICA SE ESTÁ LOGADO
  // Caminho: data/[UID]/[MÊS]/[TIPO]
  return db.ref(`${FIREBASE_BASE_PATH}${currentUserId}/${monthKey}/${type}`);
}

function getMasterRef(type) {
  if (!currentUserId) return null; // VERIFICA SE ESTÁ LOGADO
  // Caminho: data/[UID]/master_[TIPO]
  return db.ref(`${FIREBASE_BASE_PATH}${currentUserId}/master_${type}`);
}

// Função utilitária para converter objetos do Firebase de volta para arrays
const toArray = (data) => data && typeof data === 'object' && !Array.isArray(data) ? Object.values(data) : (data || []);

// -------------------- Load / Save (ATUALIZADAS PARA FIREBASE COM UID) --------------------

// A função LoadData agora é ASYNC
async function loadData() {
  if (!currentUserId) return; // Sai se não estiver logado

  currentMonthKey = formatMonthKey(currentMonthDate);

  // --- Funções de leitura ---
  const readMonthData = async (type) => {
    const ref = getDataRef(type);
    if (!ref) return null; // Sai se a referência for nula (sem UID)
    const snapshot = await ref.once('value');
    return snapshot.val() || (type === 'cards' ? {} : (type === 'meta' ? {} : []));
  };
  
  const readMasterData = async (type) => {
    const ref = getMasterRef(type);
    if (!ref) return null; // Sai se a referência for nula (sem UID)
    const snapshot = await ref.once('value');
    return snapshot.val() || {};
  };

  // Carrega todos os dados do mês atual e planos mestres em paralelo
  let data;
  try {
     data = await Promise.all([
      readMonthData('entries'),
      readMonthData('expenses'),
      readMonthData('fixedExpenses'),
      readMonthData('cards'),
      readMasterData('plans')
    ]);
  } catch(error) {
    console.error("Erro ao carregar dados do Firebase:", error);
    alert("Erro ao carregar dados do Firebase. Verifique sua conexão e console de erros.");
    return; 
  }


  [entries, expenses, fixedExpenses, cardMonthlyData, masterPlans] = data;
  
  // Converte de volta para arrays
  entries = toArray(entries);
  expenses = toArray(expenses);
  fixedExpenses = toArray(fixedExpenses);
  
  if (!masterPlans || Array.isArray(masterPlans)) masterPlans = {};


  // Inicializa estruturas de cartões (se estiverem vazias)
  if (!cardMonthlyData.initialBalances) cardMonthlyData.initialBalances = {};
  CARTAO_IDS.forEach(id => { if (cardMonthlyData.initialBalances[id] === undefined) cardMonthlyData.initialBalances[id] = 0; });

  if (!cardMonthlyData.monthlyExpenses) {
    cardMonthlyData.monthlyExpenses = {};
    CARTAO_IDS.forEach(id => cardMonthlyData.monthlyExpenses[id] = 0);
  }

  // --- Carryover (Lê o 'meta' do mês anterior) ---
  if (cardMonthlyData.startingCash === undefined) {
    const prevMonthDate = new Date(currentMonthDate);
    prevMonthDate.setMonth(prevMonthDate.getMonth() - 1);
    const prevKey = formatMonthKey(prevMonthDate);
    
    // Leitura do meta (closingCash) do mês anterior usando o UID
    const prevMetaSnapshot = await db.ref(`${FIREBASE_BASE_PATH}${currentUserId}/${prevKey}/meta`).once('value');
    const prevMeta = prevMetaSnapshot.val() || null;
    
    cardMonthlyData.startingCash = prevMeta?.closingCash || 0;
  }

  if (cardMonthlyData.closingCash === undefined) cardMonthlyData.closingCash = 0;
  
  // CHAMA AS FUNÇÕES DE RENDERIZAÇÃO
  projectExpensesForMonth();
  renderLogs();
  calculateSummary();
}

// A função saveData salva no Firebase
function saveData() {
  if (!currentUserId) return; // Sai se não estiver logado

  // Salva os dados do mês atual
  getDataRef('entries').set(entries);
  getDataRef('expenses').set(expenses);
  getDataRef('fixedExpenses').set(fixedExpenses);
  getDataRef('cards').set(cardMonthlyData);
  
  // Salva planos mestres globalmente
  getMasterRef('plans').set(masterPlans);

  // meta para carryover (fechamento do mês)
  const meta = { closingCash: cardMonthlyData.closingCash || 0 };
  getDataRef('meta').set(meta);
}

// -------------------- Autenticação (NOVAS FUNÇÕES) --------------------

function renderAuthControls(loggedIn) {
    const authSection = document.getElementById('auth-section');
    const authOverlay = document.getElementById('auth-overlay');
    const appContainer = document.querySelector('.container');

    if (!authSection || !authOverlay || !appContainer) return;

    if (loggedIn) {
        // Logado: Oculta overlay, mostra aplicação
        authOverlay.style.display = 'none';
        appContainer.style.display = 'block';
        
        // Adiciona botão de logout na área de navegação se desejar
        // Por enquanto, apenas garante que a tela principal está visível.
    } else {
        // Deslogado: Mostra overlay, oculta aplicação
        appOverlay.style.display = 'flex'; 
        appContainer.style.display = 'none';
        
        authSection.innerHTML = `
            <h2>Controle Financeiro</h2>
            <p>Faça login para acessar seus dados.</p>
            <form id="login-form" onsubmit="event.preventDefault(); handleLogin()">
                <input type="email" id="auth-email" placeholder="E-mail" required style="width: 100%; margin: 5px 0; padding: 10px; border: 1px solid #ddd; border-radius: 4px;">
                <input type="password" id="auth-password" placeholder="Senha" required style="width: 100%; margin: 5px 0 10px; padding: 10px; border: 1px solid #ddd; border-radius: 4px;">
                <button type="submit" class="submit-btn" style="width: 100%; margin-bottom: 5px;">Entrar</button>
                <button type="button" onclick="handleLogin(true)" class="submit-btn" style="width: 100%; background-color: var(--cor-principal);">Criar Conta</button>
            </form>
            <p id="auth-message" style="color: var(--cor-erro); margin-top: 10px; text-align: center;"></p>
        `;
        // Adiciona botão de logout no painel para facilitar
        const navTabs = document.querySelector('.nav-tabs');
        if (navTabs) navTabs.innerHTML += `<button onclick="handleLogout()" class="tab-button" style="margin-left: auto;">🚪 Sair</button>`;
    }
}

async function handleLogin(isSignUp = false) {
    const email = document.getElementById('auth-email').value;
    const password = document.getElementById('auth-password').value;
    const msg = document.getElementById('auth-message');
    msg.textContent = 'Processando...';

    try {
        if (isSignUp) {
            await firebase.auth().createUserWithEmailAndPassword(email, password);
            msg.textContent = 'Conta criada! Entrando...';
        } else {
            await firebase.auth().signInWithEmailAndPassword(email, password);
            msg.textContent = 'Login realizado com sucesso!';
        }
        // O listener de estado cuidará do resto (loadData)
    } catch (error) {
        console.error("Erro de Autenticação:", error.code, error.message);
        let errorMsg = error.message;
        if (error.code === 'auth/wrong-password') errorMsg = 'Senha incorreta.';
        if (error.code === 'auth/user-not-found') errorMsg = 'Usuário não encontrado.';
        if (error.code === 'auth/email-already-in-use') errorMsg = 'E-mail já cadastrado.';
        
        msg.textContent = `Erro: ${errorMsg}`;
    }
}

function handleLogout() {
    firebase.auth().signOut().then(() => {
        // O listener de estado cuidará de renderizar a tela de login
        alert("Sessão encerrada.");
    }).catch((error) => {
        console.error("Erro ao sair:", error);
    });
}

function setupAuthStateListener() {
    firebase.auth().onAuthStateChanged(async (user) => {
        if (user) {
            // Usuário logado
            currentUserId = user.uid;
            renderAuthControls(true); // Renderiza a aplicação
            updateMonthDisplay();
            await loadData(); // Carrega os dados do Firebase para o UID
        } else {
            // Usuário deslogado
            currentUserId = null;
            renderAuthControls(false); // Renderiza a tela de login
            // Limpa o estado local para evitar exibição de dados antigos
            entries = []; expenses = []; fixedExpenses = []; masterPlans = {};
            calculateSummary();
        }
    });
}


// -------------------- Projeção de fixos/parcelados --------------------
function projectExpensesForMonth() {
    if (!currentUserId) return; // VERIFICA SE ESTÁ LOGADO
  // se o usuário já adicionou fixos para o mês, não sobrescrever
  if (fixedExpenses.length > 0) return;

// ... (restante da lógica de projectExpensesForMonth - NÃO MUDOU) ...

  const projectedExpenses = [];

  Object.values(masterPlans)
    .filter(plan => plan.recurrence === 'Mensal')
    .forEach(plan => {
      projectedExpenses.push({
        id: Date.now() + Math.random(),
        description: plan.description,
        category: plan.category,
        payment: plan.payment,
        value: plan.value,
        recurrence: 'Mensal',
        masterId: plan.id,
        isProjected: true
      });
    });

  Object.values(masterPlans)
    .filter(plan => plan.recurrence === 'Parcelada')
    .forEach(plan => {
      if (plan.paidInstallments < plan.totalInstallments) {
        const nextInstallment = plan.paidInstallments + 1;
        projectedExpenses.push({
          id: Date.now() + Math.random(),
          description: `${plan.description} (${nextInstallment}/${plan.totalInstallments})`,
          category: plan.category,
          payment: plan.payment,
          value: plan.value,
          recurrence: 'Parcelada',
          masterId: plan.id,
          installment: nextInstallment,
          totalInstallments: plan.totalInstallments,
          isProjected: true
        });
      }
    });

  fixedExpenses = projectedExpenses;
  saveData();
}

// -------------------- Cartões --------------------
function renderCardControls() {
    if (!currentUserId) return; // VERIFICA SE ESTÁ LOGADO

// ... (restante da lógica de renderCardControls - NÃO MUDOU) ...

  const container = document.getElementById('card-list');
  if (!container) return;
  container.innerHTML = '';
  let totalFaturas = 0;

  CARTAO_IDS.forEach(id => {
    const initialBalance = cardMonthlyData.initialBalances?.[id] || 0;
    const totalExpenses = cardMonthlyData.monthlyExpenses?.[id] || 0;
    const totalFatura = initialBalance + totalExpenses;
    totalFaturas += totalFatura;

    const cardItem = document.createElement('div');
    cardItem.classList.add('card-item');
    cardItem.innerHTML = `
      <span>${id} (Fatura)</span>
      <input type="number" class="card-initial-input" data-card-id="${id}" step="0.01" value="${initialBalance.toFixed(2)}" placeholder="Saldo Inicial">
      <span>+ ${formatBRL(totalExpenses)} (Gastos Mês)</span>
      <span class="card-fatura-total">${formatBRL(totalFatura)}</span>
    `;
    container.appendChild(cardItem);
  });

  const totalFaturasDisplay = document.getElementById('total-faturas-display');
  if (totalFaturasDisplay) totalFaturasDisplay.textContent = formatBRL(totalFaturas);
}

function saveCardInitialBalances() {
    if (!currentUserId) return; // VERIFICA SE ESTÁ LOGADO
// ... (restante da lógica de saveCardInitialBalances - NÃO MUDOU) ...

  const inputs = document.querySelectorAll('.card-initial-input');
  inputs.forEach(input => {
    const id = input.dataset.cardId;
    const newInitial = parseFloat(input.value) || 0;
    cardMonthlyData.initialBalances[id] = newInitial;
  });
  saveData();
  calculateSummary();
  alert('Saldos iniciais de cartões salvos!');
}

// -------------------- Cálculos & Resumo --------------------
function calculateSummary() {
    if (!currentUserId) return; // VERIFICA SE ESTÁ LOGADO

// ... (restante da lógica de calculateSummary - NÃO MUDOU) ...

  let totalEntradas = 0;
  let totalKm = 0;
  let totalHours = 0;
  let totalDespesasDinheiroPix = 0;
  let totalDespesasCartao = 0;
  let totalDespesasFixas = 0;

// ... (restante da lógica de calculateSummary - NÃO MUDOU) ...

  // reset card monthly expenses
  cardMonthlyData.monthlyExpenses = {};
  CARTAO_IDS.forEach(id => cardMonthlyData.monthlyExpenses[id] = 0);

// ... (restante da lógica de calculateSummary - NÃO MUDOU) ...
// ... (renderização no dashboard) ...
// ... (atualizar cartões e salvar) ...

  // atualizar cartões e salvar
  renderCardControls();
  saveData();

  // atualizar tabela resumo e gráficos
  renderSummaryTable();
  renderCharts();
}

// -------------------- Inserção de dados --------------------
function removeLogItem(id, type) {
    if (!currentUserId) return; // VERIFICA SE ESTÁ LOGADO
// ... (restante da lógica de removeLogItem - NÃO MUDOU) ...

  if (!confirm('Tem certeza que deseja remover este item?')) return;
  if (type === 'entry') entries = entries.filter(i => i.id !== id);
  if (type === 'expense') expenses = expenses.filter(i => i.id !== id);
  if (type === 'fixed') fixedExpenses = fixedExpenses.filter(i => i.id !== id);
  saveData();
  renderLogs();
  calculateSummary();
}

function toggleRecurrenceForm(recurrenceType) {
// ... (lógica de toggleRecurrenceForm - NÃO MUDOU) ...
  const parcelasGroup = document.getElementById('parcelas-group');
  if (!parcelasGroup) return;
  if (recurrenceType === 'Parcelada') {
    parcelasGroup.style.display = 'flex';
    const el = document.getElementById('fixed-expense-total-installments');
    if (el) el.required = true;
  } else {
    parcelasGroup.style.display = 'none';
    const el = document.getElementById('fixed-expense-total-installments');
    if (el) el.required = false;
  }
}

function handleFixedExpenseSubmit(e) {
    if (!currentUserId) return; // VERIFICA SE ESTÁ LOGADO
// ... (restante da lógica de handleFixedExpenseSubmit - NÃO MUDOU) ...

  if (e) e.preventDefault();
  const form = document.getElementById('fixed-expense-form');
  if (!form) return;

// ... (lógica de criação e salvamento - NÃO MUDOU) ...

  const recurrence = document.getElementById('fixed-expense-recurrence').value;
// ...
  fixedExpenses.push(logItem);
  saveData();
  form.reset();
  toggleRecurrenceForm('Unica');
  renderLogs();
  calculateSummary();
}

function editFixedExpenseValue(id, currentValue) {
    if (!currentUserId) return; // VERIFICA SE ESTÁ LOGADO
// ... (restante da lógica de editFixedExpenseValue - NÃO MUDOU) ...

  const newValue = prompt('Editar valor da despesa para o mês atual (R$):', (currentValue || 0).toFixed(2));
// ...
  if (newValue !== null) {
    const numValue = parseFloat(newValue);
    if (!isNaN(numValue) && numValue >= 0) {
      const index = fixedExpenses.findIndex(e => e.id === id);
      if (index !== -1) {
        fixedExpenses[index].value = numValue;
        fixedExpenses[index].isProjected = false;
        saveData();
        renderLogs();
        calculateSummary();
      }
    } else {
      alert('Valor inválido. Digite um número.');
    }
  }
}

function handleEntrySubmit(e) {
    if (!currentUserId) return; // VERIFICA SE ESTÁ LOGADO
// ... (restante da lógica de handleEntrySubmit - NÃO MUDOU) ...

  if (e) e.preventDefault();
  const form = document.getElementById('entry-form');
  if (!form) return;

// ... (lógica de criação e salvamento - NÃO MUDOU) ...
  const newEntry = {
    id: Date.now(),
// ...
  };
  entries.push(newEntry);
  saveData();
  form.reset();
  renderLogs();
  calculateSummary();
}

function handleExpenseSubmit(e) {
    if (!currentUserId) return; // VERIFICA SE ESTÁ LOGADO
// ... (restante da lógica de handleExpenseSubmit - NÃO MUDOU) ...

  if (e) e.preventDefault();
  const form = document.getElementById('expense-form');
  if (!form) return;
  const newExpense = {
// ...
  };
  expenses.push(newExpense);
  saveData();
  form.reset();
  renderLogs();
  calculateSummary();
}

// -------------------- Render logs / tabelas --------------------
function renderLogs() {
    if (!currentUserId) return; // VERIFICA SE ESTÁ LOGADO

// ... (restante da lógica de renderLogs - NÃO MUDOU) ...
  // atualizar display do mês na aba fixos
// ...
}

// -------------------- Mês / navegação --------------------
function updateMonthDisplay() {
  const year = currentMonthDate.getFullYear();
  const month = currentMonthDate.getMonth();
  const el = document.getElementById('current-month-display');
  if (el) el.textContent = `${MESES_PT[month]} ${year}`;
  currentMonthKey = formatMonthKey(currentMonthDate);
}

// ATENÇÃO: Função ASYNC para atualizar parcelas no Firebase
async function updateMasterPlansForPreviousMonth(prevMonthKey) {
  if (!currentUserId) return; // VERIFICA SE ESTÁ LOGADO

  // Carrega os dados fixos do mês anterior para verificar o que foi pago
  const prevFixedRef = db.ref(`${FIREBASE_BASE_PATH}${currentUserId}/${prevMonthKey}/fixedExpenses`); // Caminho alterado
  const prevFixedSnapshot = await prevFixedRef.once('value');
  const prevMonthData = prevFixedSnapshot.val() || {};
  
  // Carrega o plano mestre global para atualizar
  const masterPlansRef = getMasterRef('plans');
  const masterPlansSnapshot = await masterPlansRef.once('value');
  let masterPlansToUpdate = masterPlansSnapshot.val() || {};

// ... (restante da lógica de updateMasterPlansForPreviousMonth - NÃO MUDOU) ...
  // Salva a atualização no Firebase
  masterPlansRef.set(masterPlansToUpdate);
  // Atualiza a variável global também
  masterPlans = masterPlansToUpdate;
}

// ATENÇÃO: Função ASYNC para navegação entre meses
async function changeMonth(delta) {
  if (!currentUserId) return; // VERIFICA SE ESTÁ LOGADO
  // Antes de mudar, atualiza status de parcelas do mês atual
  await updateMasterPlansForPreviousMonth(currentMonthKey);

  currentMonthDate.setMonth(currentMonthDate.getMonth() + delta);
  updateMonthDisplay();
  
  // Espera os dados do novo mês do Firebase
  await loadData();
  
  // loadData já chama projectExpensesForMonth, renderLogs e calculateSummary
}

// -------------------- Resumo tabela --------------------
function renderSummaryTable() {
    if (!currentUserId) return; // VERIFICA SE ESTÁ LOGADO

// ... (restante da lógica de renderSummaryTable - NÃO MUDOU) ...
// ...
}

// -------------------- Gráficos (Chart.js) --------------------
function renderCharts() {
    if (!currentUserId) return; // VERIFICA SE ESTÁ LOGADO

// ... (restante da lógica de renderCharts - NÃO MUDOU) ...
// ...
}

// -------------------- Export CSV / PDF --------------------
function exportMonthCSV() {
    if (!currentUserId) return; // VERIFICA SE ESTÁ LOGADO

// ... (restante da lógica de exportMonthCSV - NÃO MUDOU) ...
// ...
}

function exportMonthPDF() {
    if (!currentUserId) return; // VERIFICA SE ESTÁ LOGADO

// ... (restante da lógica de exportMonthPDF - NÃO MUDOU) ...
// ...
}

// -------------------- Inicialização (ATUALIZADA) --------------------
function populateSelect(elementId, options) {
// ... (lógica de populateSelect - NÃO MUDOU) ...
  const s = document.getElementById(elementId);
  if (!s) return;
  s.innerHTML = '<option value="">Selecione...</option>';
// ...
}

// ATENÇÃO: initApp agora APENAS configura listeners e o AuthStateListener
async function initApp() {
  // popula selects quando existirem
  populateSelect('entry-platform', LISTAS.plataformas);
  populateSelect('expense-category', LISTAS.categorias);
  populateSelect('expense-payment', LISTAS.pagamentos);
  populateSelect('fixed-expense-category', LISTAS.categorias);
  populateSelect('fixed-expense-payment', LISTAS.pagamentos);

  // define datas padrão nos forms
  const today = new Date().toISOString().split('T')[0];
  const ed = document.getElementById('entry-date'); if (ed) ed.value = today;
  const exd = document.getElementById('expense-date'); if (exd) exd.value = today;

  // listeners de formulários (se existirem)
  const entryForm = document.getElementById('entry-form'); if (entryForm) entryForm.addEventListener('submit', handleEntrySubmit);
  const expenseForm = document.getElementById('expense-form'); if (expenseForm) expenseForm.addEventListener('submit', handleExpenseSubmit);
  const fixedForm = document.getElementById('fixed-expense-form'); if (fixedForm) fixedForm.addEventListener('submit', handleFixedExpenseSubmit);

  // botões export
  const exportCsvBtn = document.getElementById('export-csv-btn'); if (exportCsvBtn) exportCsvBtn.addEventListener('click', exportMonthCSV);
  const exportPdfBtn = document.getElementById('export-pdf-btn'); if (exportPdfBtn) exportPdfBtn.addEventListener('click', exportMonthPDF);

  // expor funções para onclick inline (INCLUINDO AS NOVAS DE AUTH)
  window.openTab = openTab;
  window.changeMonth = changeMonth;
  window.saveCardInitialBalances = saveCardInitialBalances;
  window.removeLogItem = removeLogItem;
  window.editFixedExpenseValue = editFixedExpenseValue;
  window.toggleRecurrenceForm = toggleRecurrenceForm;
  window.exportMonthCSV = exportMonthCSV;
  window.exportMonthPDF = exportMonthPDF;
  window.calculateSummary = calculateSummary;
  // FUNÇÕES DE AUTH
  window.handleLogin = handleLogin;
  window.handleLogout = handleLogout;

  // ESTABELECE O MONITORAMENTO DE AUTENTICAÇÃO (Inicia o processo)
  setupAuthStateListener();
}

// executar init quando DOM pronto
document.addEventListener('DOMContentLoaded', initApp);

// -------------------- Função de apoio para abas (quando necessário) --------------------
function openTab(tabId, button) {
// ... (lógica de openTab - NÃO MUDOU) ...
  document.querySelectorAll('.tab-content')?.forEach(tab => tab.style.display = 'none');
  document.querySelectorAll('.tab-button')?.forEach(btn => btn.classList.remove('active'));
  const target = document.getElementById(tabId);
  if (target) target.style.display = 'block';
  if (button) button.classList.add('active');
}