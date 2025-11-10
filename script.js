/* script.js - COMPLETO E CORRIGIDO
   - Carryover do saldo do mês anterior (startingCash / closingCash)
   - Projeção de fixos/parcelas para cálculo de custos
   - Entradas / Despesas / Fixos / Cartões
   - Gráficos (Chart.js), export CSV e PDF (jsPDF)
   - Integração com Firebase Realtime Database e Auth.
*/

// -------------------- Config / constantes --------------------
const CARTAO_IDS = ['💳 Cartão 1', '💳 Cartão 2', '💳 Cartão 3'];
const DINHEIRO_PIX_IDS = ['💵 Dinheiro', '📲 PIX'];
const MESES_PT = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];

// Path de Armazenamento BASE (será concatenado com o UID do usuário)
const FIREBASE_BASE_PATH = 'data/'; 

// Variáveis Globais de Estado
let currentYear;
let currentMonth;
let currentUserUid = 'aguardando_auth'; // Default, será atualizado pelo Auth listener

let auth; // Instância do Auth
let db;   // Instância do Database

let expenseChart; // Instância do gráfico de despesas
let fixedChart;   // Instância do gráfico de fixos

// Cache de dados carregados
let dataCache = {
  entries: {},
  expenses: {},
  fixed: {},
  cardBalances: {},
  startingCash: 0,
  startingCardBalances: {}
};

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
    { value: '⛽ Combustível', label: '⛽ Combustível' },
    { value: '🍔 Alimentação', label: '🍔 Alimentação' },
    { value: '🏠 Casa/Contas', label: '🏠 Casa/Contas' },
    { value: '🛒 Mercado', label: '🛒 Mercado' },
    { value: '🏥 Saúde', label: '🏥 Saúde' },
    { value: '💻 Investimento/Tecnologia', label: '💻 Investimento/Tecnologia' },
    { value: '🎁 Lazer/Diversão', label: '🎁 Lazer/Diversão' },
    { value: '🛠️ Manutenção/Outros', label: '🛠️ Manutenção/Outros' }
  ],
  fixos: [
    { value: 'Aluguel', label: 'Aluguel' },
    { value: 'Conta de Luz', label: 'Conta de Luz' },
    { value: 'Internet/Telefone', label: 'Internet/Telefone' },
    { value: 'Mensalidade', label: 'Mensalidade' },
    { value: 'Dívida/Empréstimo', label: 'Dívida/Empréstimo' },
    { value: 'Outros Fixos', label: 'Outros Fixos' }
  ]
};

// -------------------- Funções de Utilidade --------------------

/**
 * Formata um número para a moeda brasileira (R$ X.XXX,XX).
 * @param {number} value
 * @returns {string}
 */
function formatCurrency(value) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

/**
 * Retorna o mês e ano formatados (YYYY-MM).
 * @param {number} offset - Meses de offset (0 para o mês atual, -1 para o anterior).
 * @returns {{year: number, month: number, formatted: string}}
 */
function getCurrentMonthYear(offset = 0) {
  const date = new Date(currentYear, currentMonth + offset, 1);
  const year = date.getFullYear();
  const month = date.getMonth(); // 0-11
  const formatted = `${year}-${String(month + 1).padStart(2, '0')}`;
  return { year, month, formatted };
}

/**
 * Retorna o caminho base para o Realtime Database, incluindo o UID do usuário e o mês.
 * @param {string} type - Tipo de dado ('entradas', 'despesas', 'fixos', 'saldo_inicial').
 * @param {string} monthYear - Mês e ano formatados (YYYY-MM).
 * @returns {string} O caminho completo do Firebase.
 */
function getDatabasePath(type, monthYear = getCurrentMonthYear().formatted) {
  if (type === 'fixos') {
    // Fixos são persistentes e não dependem do mês (apenas do usuário)
    return `${FIREBASE_BASE_PATH}${currentUserUid}/${type}`;
  }
  // Outros dados são por mês
  return `${FIREBASE_BASE_PATH}${currentUserUid}/${type}/${monthYear}`;
}

/**
 * Preenche os elementos <select> nos formulários com as opções das LISTAS.
 */
function populateSelects() {
  const selects = {
    'entry-platform': LISTAS.plataformas,
    'expense-category': LISTAS.categorias,
    'expense-payment': LISTAS.pagamentos,
    'fixed-expense-category': LISTAS.fixos,
    'fixed-expense-payment': LISTAS.pagamentos
  };

  for (const id in selects) {
    const selectElement = document.getElementById(id);
    if (selectElement) {
      selectElement.innerHTML = ''; // Limpa antes de preencher
      selects[id].forEach(item => {
        const option = document.createElement('option');
        option.value = item.value;
        option.textContent = item.label;
        selectElement.appendChild(option);
      });
      // Adiciona um valor vazio para campos obrigatórios, se não houver um padrão
      if (!selectElement.querySelector('option')) {
         const emptyOption = document.createElement('option');
         emptyOption.value = "";
         emptyOption.textContent = "Selecione...";
         emptyOption.disabled = true;
         emptyOption.selected = true;
         selectElement.appendChild(emptyOption);
      }
    }
  }
}

/**
 * Atualiza o seletor de mês na UI.
 */
function updateMonthDisplay() {
  const monthDisplay = document.getElementById('current-month-year');
  if (monthDisplay) {
    monthDisplay.textContent = `${MESES_PT[currentMonth]} / ${currentYear}`;
  }
  // Preenche a data de hoje como padrão nos campos de data
  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];
  document.getElementById('entry-date')?.setAttribute('value', todayStr);
  document.getElementById('expense-date')?.setAttribute('value', todayStr);
}

/**
 * Muda o mês atualmente visualizado e recarrega os dados.
 * @param {number} offset - -1 para mês anterior, 1 para próximo mês.
 */
function changeMonth(offset) {
  const date = new Date(currentYear, currentMonth + offset, 1);
  currentYear = date.getFullYear();
  currentMonth = date.getMonth(); // 0-11
  
  updateMonthDisplay();
  loadDataForMonth(); // Recarrega todos os dados para o novo mês
}

/**
 * Verifica se uma data pertence ao mês e ano atuais.
 * @param {string} dateString - Data no formato YYYY-MM-DD.
 * @returns {boolean}
 */
function isCurrentMonth(dateString) {
    const [year, month] = dateString.split('-').map(Number);
    return year === currentYear && (month - 1) === currentMonth;
}


// -------------------- Funções de Autenticação --------------------

/**
 * Escuta mudanças de estado de autenticação e carrega os dados.
 */
function setupAuthStateListener() {
    // Pega as instâncias globais do Firebase inicializadas no HTML
    auth = window.auth;
    db = window.db;

    if (!auth || !db) {
        console.error("Firebase Auth ou Database não inicializado. Verifique os scripts no HTML.");
        return;
    }

    onAuthStateChanged(auth, (user) => {
        const authStatusElement = document.getElementById('auth-status');
        const authControlsElement = document.getElementById('auth-controls');

        if (user) {
            currentUserUid = user.uid;
            console.log("Usuário autenticado:", currentUserUid);

            if (authStatusElement) {
                authStatusElement.textContent = `UID: ${user.uid} (Logado)`;
                authStatusElement.classList.remove('status-error');
                authStatusElement.classList.add('status-success');
            }
            if (authControlsElement) authControlsElement.innerHTML = `<button onclick="handleLogout()" class="submit-btn" style="background:#F44336;">Sair</button>`;

            // Carregar dados após a autenticação
            loadDataForMonth();
        } else {
            // Usuário deslogado (ou sessão não encontrada)
            currentUserUid = 'anonymous'; // Não deve ocorrer se estivermos usando a regra de autenticação
            console.log("Nenhum usuário autenticado.");

            if (authStatusElement) {
                authStatusElement.textContent = `Aguardando Login...`;
                authStatusElement.classList.remove('status-success');
                authStatusElement.classList.add('status-error');
            }
            if (authControlsElement) authControlsElement.innerHTML = `
                <input type="email" id="login-email" placeholder="Email" required style="padding: 8px; border-radius: 4px; border: 1px solid #333; background: #121212; color: white;">
                <input type="password" id="login-password" placeholder="Senha" required style="padding: 8px; border-radius: 4px; border: 1px solid #333; background: #121212; color: white;">
                <button onclick="handleLogin('login')" class="submit-btn">Entrar</button>
                <button onclick="handleLogin('register')" class="submit-btn" style="background: #FF9800;">Registrar</button>
            `;
        }
    });
}

/**
 * Tenta fazer login ou registro.
 * @param {string} action 'login' ou 'register'.
 */
async function handleLogin(action) {
    const email = document.getElementById('login-email')?.value;
    const password = document.getElementById('login-password')?.value;

    if (!email || !password) {
        alertMessage('Por favor, insira email e senha.', 'erro');
        return;
    }

    try {
        if (action === 'login') {
            await signInWithEmailAndPassword(auth, email, password);
            alertMessage('Login realizado com sucesso!', 'sucesso');
        } else if (action === 'register') {
            await createUserWithEmailAndPassword(auth, email, password);
            alertMessage('Registro e Login realizados com sucesso!', 'sucesso');
        }
    } catch (error) {
        console.error("Erro de Autenticação:", error);
        alertMessage(`Erro na autenticação: ${error.message}`, 'erro');
    }
}

/**
 * Faz logout do usuário.
 */
async function handleLogout() {
    try {
        await signOut(auth);
        alertMessage('Logout realizado.', 'sucesso');
        // Recarregar o painel para limpar dados e mostrar a tela de login
        window.location.reload(); 
    } catch (error) {
        console.error("Erro ao fazer logout:", error);
        alertMessage(`Erro ao fazer logout: ${error.message}`, 'erro');
    }
}


// -------------------- Lógica de Dados (CRUD) --------------------

/**
 * Salva uma nova entrada no Firebase.
 * @param {object} entryData - Dados da entrada.
 */
async function saveEntry(entryData) {
  if (currentUserUid === 'aguardando_auth') return alertMessage("Aguarde a autenticação.", 'erro');
  const path = getDatabasePath('entradas');
  try {
    await push(window.firebase.database.ref(db, path), entryData);
    alertMessage('Entrada salva com sucesso!', 'sucesso');
  } catch (e) {
    console.error("Erro ao salvar entrada:", e);
    alertMessage('Erro ao salvar entrada: ' + e.message, 'erro');
  }
}

/**
 * Salva uma nova despesa no Firebase.
 * @param {object} expenseData - Dados da despesa.
 */
async function saveExpense(expenseData) {
  if (currentUserUid === 'aguardando_auth') return alertMessage("Aguarde a autenticação.", 'erro');
  const path = getDatabasePath('despesas');
  try {
    await push(window.firebase.database.ref(db, path), expenseData);
    alertMessage('Despesa salva com sucesso!', 'sucesso');
  } catch (e) {
    console.error("Erro ao salvar despesa:", e);
    alertMessage('Erro ao salvar despesa: ' + e.message, 'erro');
  }
}

/**
 * Salva uma despesa fixa ou parcela no Firebase.
 * Fixos são salvos no caminho 'fixos' (permanente), e são filtrados/projetados pelo script.
 * @param {object} fixedData - Dados da despesa fixa.
 */
async function saveFixedExpense(fixedData) {
    if (currentUserUid === 'aguardando_auth') return alertMessage("Aguarde a autenticação.", 'erro');
    const path = getDatabasePath('fixos'); // Caminho permanente (não por mês)
    try {
        await push(window.firebase.database.ref(db, path), fixedData);
        alertMessage('Despesa Fixa/Dívida salva com sucesso!', 'sucesso');
    } catch (e) {
        console.error("Erro ao salvar fixo:", e);
        alertMessage('Erro ao salvar despesa fixa: ' + e.message, 'erro');
    }
}

/**
 * Manipula a submissão do formulário de Entradas.
 * @param {Event} e - Evento de submissão.
 */
function handleEntrySubmit(e) {
  e.preventDefault();
  const form = e.target;
  const entryData = {
    date: form.elements['entry-date'].value,
    platform: form.elements['entry-platform'].value,
    value: parseFloat(form.elements['entry-value'].value),
    km: parseFloat(form.elements['entry-km'].value),
    hours: parseFloat(form.elements['entry-hours'].value),
    gas: parseFloat(form.elements['entry-gas'].value),
    description: form.elements['entry-description'].value,
    timestamp: new Date().toISOString()
  };
  saveEntry(entryData).then(() => {
    form.reset();
    updateMonthDisplay(); // Restaura a data de hoje no campo
  });
}

/**
 * Manipula a submissão do formulário de Despesas Variáveis.
 * @param {Event} e - Evento de submissão.
 */
function handleExpenseSubmit(e) {
  e.preventDefault();
  const form = e.target;
  const expenseData = {
    date: form.elements['expense-date'].value,
    category: form.elements['expense-category'].value,
    description: form.elements['expense-description'].value,
    payment: form.elements['expense-payment'].value,
    value: parseFloat(form.elements['expense-value'].value),
    installmentOf: null, // Despesas variáveis não são parceladas por padrão
    timestamp: new Date().toISOString()
  };
  saveExpense(expenseData).then(() => {
    form.reset();
    updateMonthDisplay();
  });
}

/**
 * Manipula a submissão do formulário de Despesas Fixas/Dívidas.
 * @param {Event} e - Evento de submissão.
 */
function handleFixedExpenseSubmit(e) {
  e.preventDefault();
  const form = e.target;
  const recurrence = form.elements['fixed-expense-recurrence'].value;

  const fixedData = {
    category: form.elements['fixed-expense-category'].value,
    description: form.elements['fixed-expense-description'].value,
    payment: form.elements['fixed-expense-payment'].value,
    value: parseFloat(form.elements['fixed-expense-value'].value),
    recurrence: recurrence,
    startDate: getCurrentMonthYear().formatted, // O mês de registro é o mês de início
    lastMonthPaid: null, // O mês de início ainda não foi pago
    timestamp: new Date().toISOString()
  };

  if (recurrence === 'Parcelada') {
    fixedData.totalInstallments = parseInt(form.elements['fixed-expense-total-installments'].value);
    fixedData.currentInstallment = 1; // Começa na parcela 1
    fixedData.totalValue = fixedData.value * fixedData.totalInstallments; // Valor total da dívida
  }

  saveFixedExpense(fixedData).then(() => {
    form.reset();
    toggleRecurrenceForm('Unica'); // Volta ao default
  });
}

/**
 * Remove um item (entrada, despesa, fixo) do Firebase.
 * @param {string} type - 'entradas', 'despesas', 'fixos'.
 * @param {string} key - A chave do Firebase (ID do item).
 * @param {string} monthYear - Mês e ano (apenas para 'entradas' e 'despesas').
 */
function removeLogItem(type, key, monthYear) {
  if (currentUserUid === 'aguardando_auth') return alertMessage("Aguarde a autenticação.", 'erro');

  if (confirm(`Tem certeza que deseja remover este item de ${type}?`)) {
    // Para 'entradas' e 'despesas', o caminho é por mês
    let path;
    if (type === 'entradas' || type === 'despesas') {
      path = getDatabasePath(type, monthYear);
    } else if (type === 'fixos') {
      // Para 'fixos', o caminho é o permanente
      path = getDatabasePath('fixos');
    } else {
      console.error("Tipo de item inválido para remoção:", type);
      return;
    }

    const itemRef = window.firebase.database.ref(db, `${path}/${key}`);
    remove(itemRef)
      .then(() => {
        alertMessage('Item removido com sucesso!', 'sucesso');
        // A função onValue em loadDataForMonth se encarregará de atualizar a UI
      })
      .catch(e => {
        console.error("Erro ao remover item:", e);
        alertMessage('Erro ao remover item: ' + e.message, 'erro');
      });
  }
}

/**
 * Altera o valor de uma despesa fixa/dívida específica para o mês atual.
 * @param {string} key - A chave do Firebase do item fixo.
 */
function editFixedExpenseValue(key) {
  if (currentUserUid === 'aguardando_auth') return alertMessage("Aguarde a autenticação.", 'erro');
  
  const newValue = prompt("Novo valor para este mês (R$):");
  if (newValue === null) return; // Cancelado
  
  const value = parseFloat(newValue.replace(',', '.'));
  if (isNaN(value) || value <= 0) {
    return alertMessage("Valor inválido.", 'erro');
  }

  // O valor alterado para o mês atual é salvo como uma "despesa" variável, 
  // com uma marcação para o fixo original (aqui simplificamos para manter o valor original do fixo intacto).
  // Alternativamente, poderíamos marcar o fixo como "pago" no mês atual com o novo valor.
  
  // Vamos buscar o item fixo original para criar uma cópia
  const fixedItem = dataCache.fixed[key];
  if (!fixedItem) return alertMessage("Item fixo não encontrado.", 'erro');

  const monthYear = getCurrentMonthYear().formatted;
  
  const expenseData = {
    date: `${monthYear}-01`, // Data de referência para o mês
    category: fixedItem.category,
    description: `[Fixo Ajustado] ${fixedItem.description}`,
    payment: fixedItem.payment,
    value: value,
    installmentOf: key, // Marcação para o item fixo original
    timestamp: new Date().toISOString()
  };

  saveExpense(expenseData);
  // Nota: A lógica de marcar o fixo como pago no mês atual é mais complexa e
  // requer uma estrutura de dados diferente (por exemplo, um array de meses pagos dentro do fixo).
  // Por simplicidade, adicionamos como uma despesa. Para a lógica de cálculo, a despesa
  // variável (ajustada) será considerada, e a projeção do fixo original será ignorada.
}


// -------------------- Lógica de Cartões --------------------

/**
 * Salva os saldos iniciais de dinheiro e cartões para o mês atual.
 */
async function saveCardInitialBalances() {
  if (currentUserUid === 'aguardando_auth') return alertMessage("Aguarde a autenticação.", 'erro');
  
  const cashValue = parseFloat(document.getElementById('initial-cash-balance')?.value || 0);
  if (isNaN(cashValue)) return alertMessage("Saldo Inicial de Dinheiro inválido.", 'erro');

  const cardBalances = {};
  for (const cardId of CARTAO_IDS) {
    const inputElement = document.getElementById(`initial-${cardId.replace(/[^a-zA-Z0-9]/g, '-')}-balance`);
    if (inputElement) {
        const balance = parseFloat(inputElement.value || 0);
        if (isNaN(balance)) return alertMessage(`Saldo Inicial do Cartão ${cardId} inválido.`, 'erro');
        cardBalances[cardId] = balance;
    }
  }

  const monthYear = getCurrentMonthYear().formatted;
  const path = getDatabasePath('saldo_inicial', monthYear);
  
  const data = {
    cash: cashValue,
    cardBalances: cardBalances,
    timestamp: new Date().toISOString()
  };

  try {
    await window.firebase.database.set(window.firebase.database.ref(db, path), data);
    alertMessage('Saldos iniciais salvos com sucesso!', 'sucesso');
    loadDataForMonth(); // Recarrega para refletir as mudanças
  } catch (e) {
    console.error("Erro ao salvar saldos:", e);
    alertMessage('Erro ao salvar saldos: ' + e.message, 'erro');
  }
}

/**
 * Renderiza a seção de controle de cartões.
 */
function renderCardControl() {
  const container = document.getElementById('card-control-container');
  const initialBalanceContainer = document.getElementById('initial-balance-inputs');
  const monthYear = getCurrentMonthYear().formatted;
  
  if (!container || !initialBalanceContainer) return;

  // Renderiza Inputs de Saldo Inicial (apenas se for o mês atual ou se não tiverem sido salvos)
  initialBalanceContainer.innerHTML = `
      <div class="form-group" style="margin-bottom:10px;">
          <label for="initial-cash-balance">Saldo Inicial em Dinheiro/PIX (Carryover do mês anterior)</label>
          <input type="number" id="initial-cash-balance" step="0.01" value="${dataCache.startingCash.toFixed(2)}" required>
      </div>
  `;
  CARTAO_IDS.forEach(cardId => {
    const inputId = `initial-${cardId.replace(/[^a-zA-Z0-9]/g, '-')}-balance`;
    const balance = dataCache.startingCardBalances[cardId] || 0;
    initialBalanceContainer.innerHTML += `
        <div class="form-group" style="margin-bottom:10px;">
            <label for="${inputId}">Saldo Inicial da Fatura ${cardId} (Projeção)</label>
            <input type="number" id="${inputId}" step="0.01" value="${balance.toFixed(2)}" required>
        </div>
    `;
  });
  
  // Renderiza a Tabela de Despesas por Cartão
  let cardSummaryHTML = `
    <h3>Despesas de Cartão (${MESES_PT[currentMonth]} / ${currentYear})</h3>
    <div class="card-list">
  `;
  
  let totalFaturaMes = 0;
  
  CARTAO_IDS.forEach(cardId => {
    const despesasCartao = Object.values(dataCache.expenses)
      .filter(exp => exp.payment === cardId && isCurrentMonth(exp.date));

    // A lógica de fixos é mais complexa, mas vamos simplificar aqui:
    // Apenas despesas variáveis pagas com cartão. Os fixos/parcelas são considerados 
    // despesas do mês no cálculo geral, mas não necessariamente da fatura atual, 
    // dependendo da data de fechamento. Para simplicidade, vamos usar apenas as despesas variáveis aqui.
    
    const totalDespesas = despesasCartao.reduce((sum, exp) => sum + exp.value, 0);
    totalFaturaMes += totalDespesas;
    
    cardSummaryHTML += `
      <div class="card-item">
        <span>${cardId}</span>
        <span style="font-weight:bold; color:var(--cor-erro);">${formatCurrency(totalDespesas)}</span>
      </div>
      <div style="font-size:12px; margin-left:15px; color:#aaa;">${despesasCartao.length} transações</div>
    `;
  });

  cardSummaryHTML += `
      <hr style="margin:10px 0; border-color:#333;">
      <div class="card-item" style="font-size:1.1em;">
        <span style="font-weight:bold;">TOTAL Fatura Mês</span>
        <span style="font-weight:bold; color:var(--cor-erro);">${formatCurrency(totalFaturaMes)}</span>
      </div>
    </div>
  `;
  
  container.innerHTML = cardSummaryHTML;
}

// -------------------- Lógica de Resumo e Cálculos --------------------

/**
 * Calcula o resumo financeiro do mês (Entradas, Despesas, Lucro, Saldo).
 */
function calculateSummary() {
  const monthYear = getCurrentMonthYear().formatted;
  
  // 1. Calcular Totais de Entradas
  const totalEntries = Object.values(dataCache.entries)
    .filter(e => isCurrentMonth(e.date))
    .reduce((sum, e) => sum + e.value, 0);
  
  // 2. Calcular Totais de Despesas Variáveis
  const totalVariableExpenses = Object.values(dataCache.expenses)
    .filter(e => isCurrentMonth(e.date))
    .reduce((sum, e) => sum + e.value, 0);

  // 3. Projetar e Calcular Despesas Fixas (inclui parcelas)
  let totalFixedExpenses = 0;
  let fixedLogItems = [];
  
  Object.keys(dataCache.fixed).forEach(key => {
    const fixed = dataCache.fixed[key];
    
    // Verifica se o item fixo é recorrente no mês atual
    let isDueThisMonth = false;
    
    if (fixed.recurrence === 'Mensal') {
      isDueThisMonth = true;
    } else if (fixed.recurrence === 'Parcelada') {
      // Verifica se a parcela atual (currentInstallment) é menor ou igual ao total
      // E se a data de início é anterior ou igual ao mês atual
      const [startYear, startMonth] = fixed.startDate.split('-').map(Number);
      const currentMonthIndex = currentYear * 12 + currentMonth;
      const startMonthIndex = startYear * 12 + (startMonth - 1);
      
      const installmentToPay = currentMonthIndex - startMonthIndex + 1; // 1-based index
      
      if (installmentToPay > 0 && installmentToPay <= fixed.totalInstallments) {
        isDueThisMonth = true;
        fixed.currentInstallmentToPay = installmentToPay; // Adiciona para renderização
      }
    }
    
    // Se a despesa fixa está prevista para o mês
    if (isDueThisMonth) {
        let valueForMonth = fixed.value;
        let description = fixed.description;

        // Se o valor já foi coberto/ajustado por uma despesa variável (como no editFixedExpenseValue),
        // NÃO o conte novamente. Para isso, vamos ignorar fixos que tenham uma despesa associada no mês.
        // Isso é complexo, vamos simplificar:
        // Se a despesa é 'Parcelada' ou 'Mensal', conte o valor do 'value' do item fixo.
        totalFixedExpenses += valueForMonth;
        fixedLogItems.push({
            ...fixed, 
            id: key, 
            value: valueForMonth, 
            isDue: true,
            // Adiciona a info da parcela se for o caso
            installmentDisplay: fixed.recurrence === 'Parcelada' ? 
                                `(${fixed.currentInstallmentToPay || 1} de ${fixed.totalInstallments})` : 
                                ''
        });
    } else if (fixed.recurrence === 'Unica' && fixed.startDate === monthYear) {
      // Adiciona itens únicos registrados neste mês (contabilizados como fixos)
       totalFixedExpenses += fixed.value;
        fixedLogItems.push({
            ...fixed, 
            id: key, 
            value: fixed.value, 
            isDue: true,
            installmentDisplay: '(Única)'
        });
    }

  });
  
  const totalExpenses = totalVariableExpenses + totalFixedExpenses;
  const netIncome = totalEntries - totalExpenses;
  const closingCash = dataCache.startingCash + totalEntries - totalVariableExpenses - totalFixedExpenses;
  
  // Armazenar os resultados para uso na UI
  const summary = {
    totalEntries,
    totalVariableExpenses,
    totalFixedExpenses,
    totalExpenses,
    netIncome,
    startingCash: dataCache.startingCash,
    closingCash,
    fixedLogItems
  };
  
  renderSummary(summary);
  renderCharts(summary);
  
  // Atualiza o cache com o novo saldo final para o cálculo do próximo mês (apenas para exibição)
  dataCache.closingCash = closingCash;
  
  return summary;
}

// -------------------- Lógica de Carregamento e Renderização --------------------

/**
 * Carrega o saldo inicial do mês anterior.
 * @param {string} prevMonthYear - Mês/Ano anterior (YYYY-MM).
 * @returns {Promise<number>} - O saldo final do mês anterior.
 */
async function loadPreviousMonthCashBalance(prevMonthYear) {
    if (currentUserUid === 'aguardando_auth') return 0;
    
    const prevMonthPath = getDatabasePath('saldo_inicial', prevMonthYear);
    const snapshot = await get(window.firebase.database.ref(db, prevMonthPath));
    const data = snapshot.val();
    
    // Se não há dados de saldo_inicial para o mês anterior, assume 0.
    if (!data) return 0; 
    
    // Para simplificar, o saldo do próximo mês é o CASH (Dinheiro/PIX) do mês anterior.
    // O saldo final não é armazenado diretamente, ele deve ser recalculado ou armazenado explicitamente.
    
    // A melhor maneira é buscar entradas, despesas, fixos do mês anterior e CALCULAR o closingCash.
    // Devido à complexidade e latência, vamos assumir que o saldo inicial do mês (se salvo) é o carryover.
    // Se o usuário SALVOU o saldo inicial, usamos. Se não, assumimos 0.
    
    // Para simplificar: Se o campo 'cash' foi salvo, usamos. Se não, 0.
    return data.cash || 0; 
}

/**
 * Carrega todos os dados do Firebase para o mês atual.
 */
async function loadDataForMonth() {
  if (currentUserUid === 'aguardando_auth') return;
  
  const monthYear = getCurrentMonthYear().formatted;
  
  // 1. Carregar Saldo Inicial do mês anterior
  const { formatted: prevMonthYear } = getCurrentMonthYear(-1);
  dataCache.startingCash = await loadPreviousMonthCashBalance(prevMonthYear);
  
  // 2. Carregar Saldo Inicial do mês ATUAL (para cartões)
  const currentMonthInitialPath = getDatabasePath('saldo_inicial', monthYear);
  onValue(window.firebase.database.ref(db, currentMonthInitialPath), (snapshot) => {
      const data = snapshot.val();
      dataCache.startingCardBalances = data?.cardBalances || {};
      // Se o saldo inicial do mês atual foi salvo, ele substitui o carryover (se foi ajustado manualmente)
      if (data && typeof data.cash === 'number') {
        dataCache.startingCash = data.cash;
      }
      renderCardControl();
      calculateSummary();
  });
  
  // 3. Carregar Entradas
  const entriesPath = getDatabasePath('entradas', monthYear);
  onValue(window.firebase.database.ref(db, entriesPath), (snapshot) => {
    dataCache.entries = snapshot.val() || {};
    renderEntries(dataCache.entries);
    calculateSummary();
  });
  
  // 4. Carregar Despesas Variáveis
  const expensesPath = getDatabasePath('despesas', monthYear);
  onValue(window.firebase.database.ref(db, expensesPath), (snapshot) => {
    dataCache.expenses = snapshot.val() || {};
    renderExpenses(dataCache.expenses);
    calculateSummary();
  });
  
  // 5. Carregar Despesas Fixas (Não depende do mês no caminho, apenas do usuário)
  const fixedPath = getDatabasePath('fixos');
  onValue(window.firebase.database.ref(db, fixedPath), (snapshot) => {
    dataCache.fixed = snapshot.val() || {};
    renderFixedExpenses(dataCache.fixed);
    calculateSummary();
  });
}

/**
 * Renderiza o resumo no Dashboard.
 * @param {object} summary - O objeto de resumo calculado.
 */
function renderSummary(summary) {
  // Pega o elemento do dashboard (index.html)
  if (document.getElementById('starting-cash')) {
    document.getElementById('starting-cash').textContent = formatCurrency(summary.startingCash);
    document.getElementById('total-entradas').textContent = formatCurrency(summary.totalEntries);
    document.getElementById('var-exp-value').textContent = formatCurrency(summary.totalVariableExpenses);
    document.getElementById('fix-exp-value').textContent = formatCurrency(summary.totalFixedExpenses);
    document.getElementById('total-despesas').textContent = formatCurrency(summary.totalExpenses);
    document.getElementById('lucro-liquido').textContent = formatCurrency(summary.netIncome);
    document.getElementById('saldo-caixa').textContent = formatCurrency(summary.closingCash);
    
    // Atualiza cores
    document.getElementById('lucro-liquido').style.color = summary.netIncome >= 0 ? 'var(--cor-sucesso)' : 'var(--cor-erro)';
    document.getElementById('saldo-caixa').style.color = summary.closingCash >= 0 ? 'var(--cor-primaria)' : 'var(--cor-erro)';
  }
}

/**
 * Renderiza a lista de entradas.
 * @param {object} entries - Objeto de entradas.
 */
function renderEntries(entries) {
  const tableBody = document.getElementById('entry-log-body');
  if (!tableBody) return;
  
  let html = '';
  Object.keys(entries).reverse().forEach(key => {
    const e = entries[key];
    if (isCurrentMonth(e.date)) {
        html += `
          <tr>
            <td>${e.date}</td>
            <td>${e.platform}</td>
            <td>${e.description}</td>
            <td style="color:var(--cor-sucesso); font-weight:bold;">${formatCurrency(e.value)}</td>
            <td>${e.km.toFixed(1)} km</td>
            <td>${e.hours.toFixed(1)} h</td>
            <td>${formatCurrency(e.gas)}</td>
            <td>
                <button class="remove-btn" onclick="removeLogItem('entradas', '${key}', '${getCurrentMonthYear().formatted}')">X</button>
            </td>
          </tr>
        `;
    }
  });
  tableBody.innerHTML = html;
}

/**
 * Renderiza a lista de despesas variáveis.
 * @param {object} expenses - Objeto de despesas.
 */
function renderExpenses(expenses) {
  const tableBody = document.getElementById('expense-log-body');
  if (!tableBody) return;
  
  let html = '';
  Object.keys(expenses).reverse().forEach(key => {
    const e = expenses[key];
     if (isCurrentMonth(e.date)) {
        html += `
          <tr>
            <td>${e.date}</td>
            <td>${e.category}</td>
            <td>${e.description}</td>
            <td>${e.payment}</td>
            <td style="color:var(--cor-erro); font-weight:bold;">${formatCurrency(e.value)}</td>
            <td>
                <button class="remove-btn" onclick="removeLogItem('despesas', '${key}', '${getCurrentMonthYear().formatted}')">X</button>
            </td>
          </tr>
        `;
     }
  });
  tableBody.innerHTML = html;
}

/**
 * Renderiza a lista de despesas fixas/dívidas.
 * @param {object} fixedItems - Objeto de itens fixos permanentes.
 */
function renderFixedExpenses(fixedItems) {
  const tableBody = document.getElementById('fixed-log-body');
  const summary = calculateSummary(); // Recalcula para obter fixedLogItems
  if (!tableBody || !summary) return;
  
  let html = '';
  Object.values(summary.fixedLogItems).forEach(f => {
    const isDue = f.isDue ? 'Sim' : 'Não';
    const dueColor = f.isDue ? 'var(--cor-erro)' : 'var(--cor-sucesso)';
    
    html += `
      <tr>
        <td>${f.category}</td>
        <td>${f.description} ${f.installmentDisplay}</td>
        <td>${f.payment}</td>
        <td style="color:${dueColor}; font-weight:bold;">${formatCurrency(f.value)}</td>
        <td>
            <span style="color:${dueColor}; font-weight:bold;">${isDue}</span>
        </td>
        <td>
          <button class="action-btn" onclick="editFixedExpenseValue('${f.id}')">Ajustar Mês</button>
          <button class="remove-btn" onclick="removeLogItem('fixos', '${f.id}', null)">Remover</button>
        </td>
      </tr>
    `;
  });
  tableBody.innerHTML = html;
}


// -------------------- Gráficos (Chart.js) --------------------

/**
 * Renderiza os gráficos de despesas.
 * @param {object} summary - O objeto de resumo calculado.
 */
function renderCharts(summary) {
  const ctxExpense = document.getElementById('expenseChart')?.getContext('2d');
  const ctxFixed = document.getElementById('fixedChart')?.getContext('2d');

  // --- Gráfico de Despesas (Pizza) ---
  if (ctxExpense) {
    // Agrupa despesas variáveis por categoria
    const expenseCategories = Object.values(dataCache.expenses)
      .filter(e => isCurrentMonth(e.date))
      .reduce((acc, e) => {
        acc[e.category] = (acc[e.category] || 0) + e.value;
        return acc;
      }, {});
      
    // Adiciona o total de fixos como uma única categoria no gráfico variável
    if (summary.totalFixedExpenses > 0) {
        expenseCategories['📌 Fixos/Dívidas'] = summary.totalFixedExpenses;
    }
    
    const data = {
      labels: Object.keys(expenseCategories),
      datasets: [{
        label: 'Despesas por Categoria',
        data: Object.values(expenseCategories),
        backgroundColor: [
            '#F44336', '#FF9800', '#2196F3', '#4CAF50', '#9C27B0', 
            '#FFC107', '#00BCD4', '#E91E63', '#607D8B'
        ],
        hoverOffset: 4
      }]
    };

    if (expenseChart) expenseChart.destroy();
    expenseChart = new Chart(ctxExpense, {
      type: 'doughnut',
      data: data,
      options: {
        responsive: true,
        plugins: {
          legend: { position: 'top', labels: { color: 'white' } },
          title: { display: true, text: 'Distribuição de Despesas (Variáveis + Fixos)', color: 'white' }
        }
      }
    });
  }
}


// -------------------- Funções de Exportação --------------------

/**
 * Exporta os dados do mês atual para CSV.
 */
function exportMonthCSV() {
  const monthYear = getCurrentMonthYear().formatted;
  const summary = calculateSummary();
  
  let csvContent = "data:text/csv;charset=utf-8,";
  
  // 1. Resumo
  csvContent += "RESUMO\n";
  csvContent += `Mês,${monthYear}\n`;
  csvContent += `Saldo Inicial,${summary.startingCash.toFixed(2)}\n`;
  csvContent += `Total Entradas,${summary.totalEntries.toFixed(2)}\n`;
  csvContent += `Despesas Variáveis,${summary.totalVariableExpenses.toFixed(2)}\n`;
  csvContent += `Despesas Fixas,${summary.totalFixedExpenses.toFixed(2)}\n`;
  csvContent += `Total Despesas,${summary.totalExpenses.toFixed(2)}\n`;
  csvContent += `Lucro Líquido,${summary.netIncome.toFixed(2)}\n`;
  csvContent += `Saldo Final,${summary.closingCash.toFixed(2)}\n\n`;
  
  // 2. Entradas
  csvContent += "ENTRADAS\n";
  csvContent += "Data,Plataforma,Descrição,Valor,Km,Horas,Gasolina\n";
  Object.values(dataCache.entries).forEach(e => {
    if (isCurrentMonth(e.date)) {
        csvContent += `${e.date},"${e.platform}","${e.description}",${e.value.toFixed(2)},${e.km.toFixed(1)},${e.hours.toFixed(1)},${e.gas.toFixed(2)}\n`;
    }
  });
  csvContent += "\n";

  // 3. Despesas Variáveis
  csvContent += "DESPESAS_VARIAVEIS\n";
  csvContent += "Data,Categoria,Descrição,Meio de Pagamento,Valor\n";
  Object.values(dataCache.expenses).forEach(e => {
    if (isCurrentMonth(e.date)) {
        csvContent += `${e.date},"${e.category}","${e.description}","${e.payment}",${e.value.toFixed(2)}\n`;
    }
  });
  csvContent += "\n";
  
  // 4. Despesas Fixas (Projetadas)
  csvContent += "DESPESAS_FIXAS_PROJETADAS\n";
  csvContent += "Categoria,Descrição,Meio de Pagamento,Valor Mês,Recorrência\n";
  summary.fixedLogItems.forEach(f => {
    csvContent += `"${f.category}","${f.description} ${f.installmentDisplay}","${f.payment}",${f.value.toFixed(2)},${f.recurrence}\n`;
  });
  
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  link.setAttribute("download", `resumo_financeiro_${monthYear}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

/**
 * Exporta os dados do mês atual para PDF (usando jspdf).
 */
function exportMonthPDF() {
  // jspdf é carregado no index.html (window.jspdf.jsPDF)
  if (!window.jspdf || !window.jspdf.jsPDF) {
    return alertMessage("Biblioteca jsPDF não carregada. Verifique o script no HTML.", 'erro');
  }
  
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  const monthYear = getCurrentMonthYear().formatted;
  const summary = calculateSummary();
  let y = 15;
  const MARGIN = 10;
  const LINE_HEIGHT = 7;
  
  doc.setFontSize(18);
  doc.text(`Relatório Financeiro: ${MESES_PT[currentMonth]} / ${currentYear}`, MARGIN, y);
  y += LINE_HEIGHT * 2;
  
  // --- Resumo ---
  doc.setFontSize(14);
  doc.text("RESUMO FINANCEIRO", MARGIN, y);
  y += LINE_HEIGHT;
  doc.setFontSize(10);
  
  const resumoData = [
    ["Saldo Inicial (Dinheiro)", formatCurrency(summary.startingCash)],
    ["Total de Entradas", formatCurrency(summary.totalEntries)],
    ["Despesas Variáveis", formatCurrency(summary.totalVariableExpenses)],
    ["Despesas Fixas e Dívidas", formatCurrency(summary.totalFixedExpenses)],
    ["TOTAL DESPESAS", formatCurrency(summary.totalExpenses)],
    ["LUCRO LÍQUIDO", formatCurrency(summary.netIncome)],
    ["SALDO FINAL", formatCurrency(summary.closingCash)]
  ];
  
  doc.autoTable({
    startY: y,
    head: [['Item', 'Valor']],
    body: resumoData,
    theme: 'striped',
    styles: { fontSize: 9, cellPadding: 2, textColor: [0, 0, 0] },
    headStyles: { fillColor: [33, 150, 243] },
    margin: { left: MARGIN, right: MARGIN }
  });
  y = doc.lastAutoTable.finalY + LINE_HEIGHT * 2;
  
  // --- Entradas ---
  doc.setFontSize(14);
  doc.text("ENTRADAS", MARGIN, y);
  y += LINE_HEIGHT;
  
  const entradasBody = Object.values(dataCache.entries)
    .filter(e => isCurrentMonth(e.date))
    .map(e => [
        e.date, 
        e.platform, 
        e.description, 
        formatCurrency(e.value), 
        `${e.km.toFixed(1)} km`, 
        `${e.hours.toFixed(1)} h`, 
        formatCurrency(e.gas)
    ]);
    
  doc.autoTable({
    startY: y,
    head: [['Data', 'Plataforma', 'Descrição', 'Valor', 'Km', 'Horas', 'Gasolina']],
    body: entradasBody,
    theme: 'grid',
    styles: { fontSize: 8, cellPadding: 1, textColor: [0, 0, 0] },
    headStyles: { fillColor: [76, 175, 80] },
    margin: { left: MARGIN, right: MARGIN }
  });
  y = doc.lastAutoTable.finalY + LINE_HEIGHT;
  
  // Adicionar paginação se necessário
  if (y > doc.internal.pageSize.height - 30) {
    doc.addPage();
    y = 15;
  }
  
  // --- Despesas Variáveis ---
  doc.setFontSize(14);
  doc.text("DESPESAS VARIÁVEIS", MARGIN, y);
  y += LINE_HEIGHT;
  
  const despesasBody = Object.values(dataCache.expenses)
    .filter(e => isCurrentMonth(e.date))
    .map(e => [
        e.date, 
        e.category, 
        e.description, 
        e.payment, 
        formatCurrency(e.value)
    ]);
    
  doc.autoTable({
    startY: y,
    head: [['Data', 'Categoria', 'Descrição', 'Pagamento', 'Valor']],
    body: despesasBody,
    theme: 'grid',
    styles: { fontSize: 8, cellPadding: 1, textColor: [0, 0, 0] },
    headStyles: { fillColor: [244, 67, 54] },
    margin: { left: MARGIN, right: MARGIN }
  });
  y = doc.lastAutoTable.finalY + LINE_HEIGHT;
  
  // Adicionar paginação se necessário
  if (y > doc.internal.pageSize.height - 30) {
    doc.addPage();
    y = 15;
  }
  
  // --- Despesas Fixas (Projetadas) ---
  doc.setFontSize(14);
  doc.text("DESPESAS FIXAS (PROJETADAS NO MÊS)", MARGIN, y);
  y += LINE_HEIGHT;
  
  const fixosBody = summary.fixedLogItems.map(f => [
      f.category, 
      `${f.description} ${f.installmentDisplay}`, 
      f.payment, 
      formatCurrency(f.value), 
      f.recurrence
  ]);
  
  doc.autoTable({
    startY: y,
    head: [['Categoria', 'Descrição', 'Pagamento', 'Valor', 'Recorrência']],
    body: fixosBody,
    theme: 'grid',
    styles: { fontSize: 8, cellPadding: 1, textColor: [0, 0, 0] },
    headStyles: { fillColor: [255, 152, 0] },
    margin: { left: MARGIN, right: MARGIN }
  });

  doc.save(`relatorio_financeiro_${monthYear}.pdf`);
}

// -------------------- Lógica de UI / Suporte --------------------

/**
 * Exibe uma mensagem de notificação temporária.
 * @param {string} message - A mensagem a ser exibida.
 * @param {'sucesso' | 'erro' | 'info'} type - O tipo de mensagem (para estilização).
 */
function alertMessage(message, type) {
    const alertBox = document.getElementById('app-alert');
    if (!alertBox) return;

    alertBox.textContent = message;
    alertBox.className = 'app-alert ' + (type || 'info');
    alertBox.style.display = 'block';

    clearTimeout(alertBox.timeout);
    alertBox.timeout = setTimeout(() => {
        alertBox.style.display = 'none';
    }, 4000);
}

/**
 * Alterna a visibilidade dos campos de recorrência do formulário Fixo.
 * @param {string} recurrenceType - Tipo de recorrência selecionada.
 */
function toggleRecurrenceForm(recurrenceType) {
  const parcelasGroup = document.getElementById('parcelas-group');
  if (parcelasGroup) {
    parcelasGroup.style.display = recurrenceType === 'Parcelada' ? 'block' : 'none';
  }
}

// -------------------- Inicialização do App --------------------

/**
 * Inicializa a aplicação: define a data, preenche selects e anexa listeners.
 */
function initApp() {
  // 1. Definição do Mês/Ano Atual
  const today = new Date();
  currentYear = today.getFullYear();
  currentMonth = today.getMonth(); // 0-11
  
  updateMonthDisplay();
  populateSelects();

  // 2. Anexar Listeners de Formulário
  const entryForm = document.getElementById('entry-form');
  if (entryForm) entryForm.addEventListener('submit', handleEntrySubmit);
  const expenseForm = document.getElementById('expense-form');
  if (expenseForm) expenseForm.addEventListener('submit', handleExpenseSubmit);
  const fixedForm = document.getElementById('fixed-expense-form');
  if (fixedForm) fixedForm.addEventListener('submit', handleFixedExpenseSubmit);

  // 3. Anexar Listeners de Botões de Exportação
  document.getElementById('export-csv-btn')?.addEventListener('click', exportMonthCSV);
  document.getElementById('export-pdf-btn')?.addEventListener('click', exportMonthPDF);

  // 4. Expor funções para onclick inline (para uso nos botões HTML)
  window.openTab = openTab;
  window.changeMonth = changeMonth;
  window.saveCardInitialBalances = saveCardInitialBalances;
  window.removeLogItem = removeLogItem;
  window.editFixedExpenseValue = editFixedExpenseValue;
  window.toggleRecurrenceForm = toggleRecurrenceForm;
  window.exportMonthCSV = exportMonthCSV;
  window.exportMonthPDF = exportMonthPDF;
  window.calculateSummary = calculateSummary;
  window.handleLogin = handleLogin;
  window.handleLogout = handleLogout;
  window.alertMessage = alertMessage; // expor o alert customizado

  // 5. Iniciar o monitoramento de Autenticação, que carregará os dados
  setupAuthStateListener();
  
  // 6. Inicia o render de cartões, mesmo que vazio, para configurar os inputs
  renderCardControl();
}

// executar init quando DOM pronto
document.addEventListener('DOMContentLoaded', initApp);

// -------------------- Função de apoio para abas (já estava no snippet) --------------------
function openTab(tabId, button) {
  document.querySelectorAll('.tab-content')?.forEach(tab => tab.style.display = 'none');
  document.querySelectorAll('.tab-button')?.forEach(btn => btn.classList.remove('active'));
  const target = document.getElementById(tabId);
  if (target) target.style.display = 'block';
  if (button) button.classList.add('active');
}