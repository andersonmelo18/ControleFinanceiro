/* script.js - LÓGICA DE CONTROLE FINANCEIRO */

// -------------------- Config / constantes --------------------
// IDs de meios de pagamento
const CARTAO_IDS = ['💳 Cartão 1', '💳 Cartão 2', '💳 Cartão 3'];
const DINHEIRO_PIX_IDS = ['💵 Dinheiro', '📲 PIX'];
const MESES_PT = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];

// Variáveis globais de controle
let currentMonth, currentYear;
let isFirstLoad = true; // Para prevenir carregamentos múltiplos iniciais
let myDoughnutChart, myBarChart;
let globalData = {
  entries: [],
  expenses: [],
  fixedExpenses: [],
  cards: {}
};

// Firestore imports (via window.db e window.auth definidos no HTML)
import { 
  collection, 
  query, 
  where, 
  getDocs, 
  onSnapshot, 
  addDoc, 
  deleteDoc, 
  doc, 
  updateDoc, 
  getDoc 
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// Variáveis para Firestore (serão definidas após a autenticação)
let db, auth;
let appId;

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
    { value: 'Manutenção', label: '🛠️ Manutenção (Moto)' },
    { value: 'Pessoal', label: '👤 Despesas Pessoais' },
    { value: 'Casa', label: '🏠 Casa' },
    { value: 'Outros', label: '📦 Outros' }
  ]
};

// -------------------- Funções de Utilitários --------------------

/**
 * Formata um número para a moeda brasileira (R$).
 * @param {number} value
 * @returns {string}
 */
function formatCurrency(value) {
  return (value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/**
 * Normaliza uma data para o formato YYYY-MM-DD.
 * @param {Date | string} date
 * @returns {string}
 */
function formatDate(date) {
    if (typeof date === 'string') date = new Date(date + 'T00:00:00'); 
    return date.toISOString().split('T')[0];
}

/**
 * Obtém o nome da coleção no Firestore.
 * @param {string} collectionName
 * @returns {string}
 */
function getCollectionPath(collectionName) {
    const userId = window.currentUserId || 'anonymous';
    // Padrão: /artifacts/{appId}/users/{userId}/{collectionName}
    return `artifacts/${appId}/users/${userId}/${collectionName}`;
}

/**
 * Cria a referência para os dados mensais.
 * @param {string} collectionName
 * @param {string} monthKey - Chave do mês (YYYY-MM)
 * @returns {import('firebase/firestore').CollectionReference}
 */
function getDataRef(collectionName, monthKey) {
    if (!db) {
        console.error("Erro: 'db' não está definido. Verifique a inicialização do Firebase no index.html.");
        return null;
    }
    const path = getCollectionPath(collectionName);
    // Para coleções de log, adicionamos o mês como subcoleção ou como filtro
    // Aqui usaremos o filtro para manter a estrutura do app (ex: entries/123, expenses/456)
    return collection(db, path);
}

// -------------------- Funções de Inicialização de UI --------------------

/**
 * Popula os elementos <select> com os dados das LISTAS.
 */
function populateSelects() {
  const selects = [
    { id: 'entry-platform', data: LISTAS.plataformas },
    { id: 'expense-category', data: LISTAS.categorias },
    { id: 'fixed-expense-category', data: LISTAS.categorias },
    { id: 'expense-payment', data: LISTAS.pagamentos },
    { id: 'fixed-expense-payment', data: LISTAS.pagamentos },
  ];

  selects.forEach(({ id, data }) => {
    const selectElement = document.getElementById(id);
    if (selectElement) {
      selectElement.innerHTML = ''; // Limpar antes de popular
      data.forEach(item => {
        const option = document.createElement('option');
        option.value = item.value;
        option.textContent = item.label;
        selectElement.appendChild(option);
      });
    }
  });

  // Define a data atual como padrão nos formulários
  const today = formatDate(new Date());
  document.getElementById('entry-date')?.setAttribute('value', today);
  document.getElementById('expense-date')?.setAttribute('value', today);
}

/**
 * Define o mês e ano atual, e carrega os dados.
 * @param {Date | null} date
 */
function setMonth(date = new Date()) {
  currentMonth = date.getMonth();
  currentYear = date.getFullYear();

  const display = document.getElementById('current-month-display');
  if (display) {
    display.textContent = `${MESES_PT[currentMonth]} / ${currentYear}`;
  }
  
  const logDisplay = document.getElementById('current-month-log-display');
  if (logDisplay) {
    logDisplay.textContent = `${MESES_PT[currentMonth]} / ${currentYear}`;
  }

  loadData();
}

/**
 * Altera o mês atual de visualização/registro.
 * @param {number} delta - +1 para próximo mês, -1 para mês anterior.
 */
window.changeMonth = function(delta) {
  const newDate = new Date(currentYear, currentMonth + delta, 1);
  setMonth(newDate);
}

// -------------------- Funções de Leitura de Dados (Firestore) --------------------

/**
 * Lê dados de uma coleção para o mês atual.
 * @param {string} collectionName
 * @param {string} monthKey - Chave do mês (YYYY-MM)
 * @returns {Promise<Array<Object>>}
 */
async function readMonthData(collectionName, monthKey) {
  const colRef = getDataRef(collectionName, monthKey);
  if (!colRef) return [];
  
  // Filtra por 'monthKey' (campo que deve existir nos documentos de log)
  const q = query(colRef, where('monthKey', '==', monthKey));
  
  try {
    const querySnapshot = await getDocs(q);
    const data = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    return data;
  } catch (e) {
    console.error(`Erro ao ler dados de ${collectionName} para ${monthKey}:`, e);
    return [];
  }
}

/**
 * Lê os dados de um documento específico (usado para cartões).
 * @param {string} collectionName
 * @param {string} docId
 * @returns {Promise<Object>}
 */
async function readDocData(collectionName, docId) {
    if (!db) return {};
    const path = getCollectionPath(collectionName);
    const docRef = doc(db, path, docId);
    try {
        const docSnap = await getDoc(docRef);
        return docSnap.exists() ? docSnap.data() : {};
    } catch (e) {
        console.error(`Erro ao ler documento ${docId} em ${collectionName}:`, e);
        return {};
    }
}

/**
 * Carrega todos os dados do mês atual.
 */
async function loadData() {
  if (!window.db || !window.currentUserId) {
    // Espera a inicialização do Firebase
    setTimeout(loadData, 50);
    return;
  }
  
  db = window.db;
  appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

  const monthKey = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`;
  
  // 1. Logs de Entradas, Despesas Variáveis e Fixas (do mês)
  globalData.entries = await readMonthData('entries', monthKey);
  globalData.expenses = await readMonthData('expenses', monthKey);
  globalData.fixedExpenses = await getMonthFixedExpenses(monthKey); 
  
  // 2. Dados de Cartões e Saldo Inicial
  const cardData = await readDocData('settings', 'cards');
  globalData.cards = cardData.balances || {};
  
  const balanceData = await readDocData('settings', 'monthly_balances');
  const monthBalance = balanceData[monthKey] || { initialCashBalance: 0 };
  globalData.initialCashBalance = monthBalance.initialCashBalance || 0;


  // 3. Atualiza UI/Cálculos
  if (document.getElementById('entries-log-body')) {
    renderEntriesLog();
  } else if (document.getElementById('expenses-log-body')) {
    renderExpensesLog();
  } else if (document.getElementById('fixed-expenses-log-body')) {
    renderFixedExpensesLog();
  } else if (document.getElementById('card-list')) {
    renderCardControls();
  }
  
  calculateSummary();
}

/**
 * Obtém despesas fixas para o mês, incluindo a projeção de recorrências.
 * @param {string} monthKey
 * @returns {Promise<Array<Object>>}
 */
async function getMonthFixedExpenses(monthKey) {
  const fixedColRef = getDataRef('fixed_templates', monthKey);
  if (!fixedColRef) return [];

  // 1. Obtém todos os templates fixos (recorrentes ou parcelados)
  const templateSnapshot = await getDocs(fixedColRef);
  let templates = templateSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

  const [targetYear, targetMonth] = monthKey.split('-').map(Number);
  let monthlyExpenses = [];

  // 2. Processa cada template
  for (const template of templates) {
    if (template.recurrence === 'Mensal') {
      // Despesa Mensal
      monthlyExpenses.push({
        ...template,
        monthKey: monthKey,
        currentMonthValue: template.value, // Valor padrão
        isRecurrent: true,
        instanceId: template.id // ID do template
      });
    } else if (template.recurrence === 'Parcelada') {
      // Despesa Parcelada
      const startMonthKey = template.monthKey; // Mês inicial da dívida
      const [startYear, startMonth] = startMonthKey.split('-').map(Number);
      
      const monthDiff = (targetYear - startYear) * 12 + (targetMonth - startMonth);
      const currentInstallment = monthDiff + 1;

      if (currentInstallment > 0 && currentInstallment <= template.totalInstallments) {
        monthlyExpenses.push({
          ...template,
          description: `${template.description} (${currentInstallment}/${template.totalInstallments})`,
          monthKey: monthKey,
          currentMonthValue: template.value, // Valor da parcela
          isRecurrent: true,
          installmentNumber: currentInstallment,
          instanceId: template.id // ID do template
        });
      }
    }
  }

  // 3. Obtém despesas fixas lançadas especificamente para este mês (Recorrência 'Unica' ou Edições)
  const uniqueFixedExpenses = await readMonthData('fixed_expenses', monthKey);

  // 4. Consolida: Se houver uma despesa 'fixed_expenses' (manual ou edição) para um template recorrente, usa seu valor.
  const finalExpenses = [...monthlyExpenses];

  for (const expense of uniqueFixedExpenses) {
    if (expense.instanceId) {
      // Se for uma edição de uma despesa recorrente, atualiza o valor
      const index = finalExpenses.findIndex(fe => fe.instanceId === expense.instanceId && fe.installmentNumber === expense.installmentNumber);
      if (index !== -1) {
        finalExpenses[index].currentMonthValue = expense.value;
        finalExpenses[index].id = expense.id; // Mantém o ID do documento de 'fixed_expenses' para exclusão
      } else {
         // Não deve acontecer se a lógica for bem aplicada, mas adiciona por segurança
         finalExpenses.push({...expense, currentMonthValue: expense.value, isRecurrent: false});
      }
    } else {
      // Se for uma despesa única lançada neste mês (Recorrência: 'Unica' no form 'fixos.html')
      finalExpenses.push({...expense, currentMonthValue: expense.value, isRecurrent: false});
    }
  }

  return finalExpenses;
}


// -------------------- Funções de Renderização e Cálculos --------------------

/**
 * Calcula e exibe o resumo financeiro no Painel.
 */
window.calculateSummary = function() {
  const monthKey = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`;
  
  // Totais
  const totalEntries = globalData.entries.reduce((sum, item) => sum + (item.value || 0), 0);
  
  // Despesas Variáveis (cash e card)
  const varExpenses = globalData.expenses;
  const totalVarExpensesCash = varExpenses.filter(e => DINHEIRO_PIX_IDS.includes(e.payment)).reduce((sum, item) => sum + (item.value || 0), 0);
  const totalVarExpensesCard = varExpenses.filter(e => CARTAO_IDS.includes(e.payment)).reduce((sum, item) => sum + (item.value || 0), 0);
  
  // Despesas Fixas (incluindo gasolina e outros custos de Entradas)
  const fixedExpenses = globalData.fixedExpenses;
  const totalFixedExpenses = fixedExpenses.reduce((sum, item) => sum + (item.currentMonthValue || 0), 0);
  
  // Despesas de gasolina e outros custos pagos em Dinheiro/PIX (já estão incluídos no log de Despesas Fixas se a recorrência for 'Mensal' ou 'Parcelada' e a forma de pagamento for 'Dinheiro/PIX')
  // No entanto, as despesas de 'Gasto Gasolina' e 'Outros Gastos em Dinheiro/PIX' do formulário de 'Entradas' **não são despesas variáveis** (elas são despesas operacionais do dia) e nem fixas.
  // Vamos incluí-las no cálculo do fluxo de caixa e total de despesas.
  const totalOperationalCosts = globalData.entries.reduce((sum, item) => sum + (item.gas || 0) + (item.otherCosts || 0), 0);
  
  // Despesas totais
  const totalExpenses = totalVarExpensesCard + totalFixedExpenses + totalOperationalCosts + totalVarExpensesCash;

  // Lucro Líquido
  const lucroLiquido = totalEntries - totalExpenses;
  
  // Saldo em Caixa (Dinheiro/PIX)
  const initialBalance = globalData.initialCashBalance; // Saldo inicial do mês
  const entriesCashFlow = totalEntries; // Todo o dinheiro que entra
  
  // Todo o dinheiro/PIX que sai:
  const outflowsCashFlow = totalVarExpensesCash + totalFixedExpenses;
  // + Despesas operacionais do dia (Gasolina/Outros custos nas Entradas)
  // Nota: Se uma despesa fixa usa Dinheiro/PIX, ela já foi contabilizada em 'outflowsCashFlow'

  const saldoCaixa = initialBalance + entriesCashFlow - outflowsCashFlow - totalOperationalCosts;
  
  // Total de Faturas a Pagar
  let totalFaturasPagar = totalVarExpensesCard; // Despesas variáveis no cartão

  // Adiciona as despesas fixas pagas com cartão
  totalFaturasPagar += fixedExpenses.filter(e => CARTAO_IDS.includes(e.payment)).reduce((sum, item) => sum + (item.currentMonthValue || 0), 0);

  // Exibição no Painel (index.html)
  document.getElementById('total-entradas')?.querySelector('.value').textContent = formatCurrency(totalEntries);
  document.getElementById('total-despesas')?.querySelector('.value').textContent = formatCurrency(totalExpenses);
  document.getElementById('lucro-liquido')?.querySelector('.value').textContent = formatCurrency(lucroLiquido);
  document.getElementById('saldo-caixa')?.querySelector('.value').textContent = formatCurrency(saldoCaixa);
  document.getElementById('total-faturas-display')?.textContent = formatCurrency(totalFaturasPagar);

  // Detalhamento de Despesas
  document.getElementById('var-exp-value')?.textContent = formatCurrency(totalVarExpensesCard + totalVarExpensesCash);
  document.getElementById('fix-exp-value')?.textContent = formatCurrency(totalFixedExpenses + totalOperationalCosts);
  
  // Totais Operacionais (apenas para o dashboard principal)
  const totalKm = globalData.entries.reduce((sum, item) => sum + (item.km || 0), 0);
  const totalHours = globalData.entries.reduce((sum, item) => sum + (item.hours || 0), 0);
  document.getElementById('total-km')?.textContent = `${totalKm.toFixed(1)} km`;
  document.getElementById('total-hours')?.textContent = `${totalHours.toFixed(1)} h`;

  // Renderiza Gráficos
  renderDonutChart(totalEntries, totalExpenses);
  renderBarChart(varExpenses, fixedExpenses);
  renderMonthlySummaryTable(totalEntries, totalExpenses, lucroLiquido, totalVarExpensesCard, totalFixedExpenses, totalOperationalCosts);
};

/**
 * Renderiza a tabela de resumo mensal.
 */
function renderMonthlySummaryTable(totalEntries, totalExpenses, lucroLiquido, totalVarExpensesCard, totalFixedExpenses, totalOperationalCosts) {
    const tableContainer = document.getElementById('monthly-summary-table');
    if (!tableContainer) return;

    const currentMonthData = MESES_PT[currentMonth];

    const data = [
        { label: "Receita Bruta", value: totalEntries, color: 'var(--cor-sucesso)' },
        { label: "Despesas Totais", value: totalExpenses, color: 'var(--cor-erro)' },
        { label: "Lucro Líquido", value: lucroLiquido, color: lucroLiquido >= 0 ? 'var(--cor-sucesso)' : 'var(--cor-erro)' },
        { label: "--- Detalhes ---", value: null, color: 'var(--cor-texto)' },
        { label: "Despesas Variáveis (Din/Pix)", value: totalVarExpensesCard, color: 'var(--cor-erro)' },
        { label: "Despesas Fixas & Dívidas", value: totalFixedExpenses, color: 'var(--cor-erro)' },
        { label: "Custos Operacionais (Gas/Outros)", value: totalOperationalCosts, color: 'var(--cor-erro)' },
    ];

    let html = `<div style="font-size:14px;">`;
    data.forEach(item => {
        if (item.value === null) {
            html += `<h5 style="margin-top:10px; margin-bottom:4px; color:var(--cor-primaria);">${item.label}</h5>`;
        } else {
            html += `<div class="card-item" style="padding:6px 0;">
                        <span>${item.label}</span>
                        <span style="font-weight:bold; color:${item.color}">${formatCurrency(item.value)}</span>
                     </div>`;
        }
    });
    html += `</div>`;
    tableContainer.innerHTML = html;
}

/**
 * Renderiza o gráfico de pizza/donut para Receitas vs Despesas.
 */
function renderDonutChart(totalEntries, totalExpenses) {
  const ctx = document.getElementById('chart-donut');
  if (!ctx) return;
  
  if (myDoughnutChart) myDoughnutChart.destroy();

  const data = {
    labels: ['Receita Total', 'Despesa Total'],
    datasets: [{
      data: [totalEntries, totalExpenses],
      backgroundColor: ['var(--cor-sucesso)', 'var(--cor-erro)'],
      hoverOffset: 4
    }]
  };

  myDoughnutChart = new Chart(ctx, {
    type: 'doughnut',
    data: data,
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: 'var(--cor-texto)' } }
      }
    }
  });
}

/**
 * Renderiza o gráfico de barras para Gastos por Categoria.
 */
function renderBarChart(varExpenses, fixedExpenses) {
  const ctx = document.getElementById('chart-bar');
  if (!ctx) return;

  if (myBarChart) myBarChart.destroy();

  const allExpenses = [...varExpenses, ...fixedExpenses.map(f => ({ ...f, value: f.currentMonthValue }))];

  const categoryTotals = allExpenses.reduce((acc, item) => {
    const category = item.category || 'Outros';
    const value = item.value || 0;
    acc[category] = (acc[category] || 0) + value;
    return acc;
  }, {});

  const labels = Object.keys(categoryTotals);
  const dataValues = Object.values(categoryTotals);

  const data = {
    labels: labels.map(label => LISTAS.categorias.find(c => c.value === label)?.label || label),
    datasets: [{
      label: 'Gasto por Categoria (R$)',
      data: dataValues,
      backgroundColor: 'var(--cor-primaria)',
      borderColor: 'var(--cor-primaria)',
      borderWidth: 1
    }]
  };

  myBarChart = new Chart(ctx, {
    type: 'bar',
    data: data,
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: { beginAtZero: true, ticks: { color: 'var(--cor-texto)' }, grid: { color: '#333' } },
        x: { ticks: { color: 'var(--cor-texto)' }, grid: { display: false } }
      },
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (context) => formatCurrency(context.parsed.y) } }
      }
    }
  });
}

/**
 * Renderiza o log de Entradas (entradas.html).
 */
function renderEntriesLog() {
  const tbody = document.getElementById('entries-log-body');
  if (!tbody) return;

  tbody.innerHTML = '';
  globalData.entries
    .sort((a, b) => (b.date || '').localeCompare(a.date || '')) // Ordena por data (mais recente primeiro)
    .forEach(item => {
      const row = tbody.insertRow();
      row.innerHTML = `
        <td>${formatDate(item.date)}</td>
        <td>${item.platform}</td>
        <td>${formatCurrency(item.value)}</td>
        <td>${(item.km || 0).toFixed(1)} km</td>
        <td><button onclick="removeLogItem('entries', '${item.id}')" class="delete-btn">Excluir</button></td>
      `;
    });
}

/**
 * Renderiza o log de Despesas Variáveis (despesas.html).
 */
function renderExpensesLog() {
  const tbody = document.getElementById('expenses-log-body');
  if (!tbody) return;

  tbody.innerHTML = '';
  globalData.expenses
    .sort((a, b) => (b.date || '').localeCompare(a.date || '')) // Ordena por data
    .forEach(item => {
      const row = tbody.insertRow();
      const categoryLabel = LISTAS.categorias.find(c => c.value === item.category)?.label || item.category;
      row.innerHTML = `
        <td>${formatDate(item.date)}</td>
        <td>${categoryLabel}</td>
        <td>${formatCurrency(item.value)}</td>
        <td>${item.payment}</td>
        <td><button onclick="removeLogItem('expenses', '${item.id}')" class="delete-btn">Excluir</button></td>
      `;
    });
}

/**
 * Renderiza o log de Despesas Fixas (fixos.html).
 */
function renderFixedExpensesLog() {
  const tbody = document.getElementById('fixed-expenses-log-body');
  if (!tbody) return;

  tbody.innerHTML = '';
  globalData.fixedExpenses
    .sort((a, b) => (a.description || '').localeCompare(b.description || '')) // Ordena por descrição
    .forEach(item => {
      const isCard = CARTAO_IDS.includes(item.payment);
      const isUnique = !item.isRecurrent; // Se for única (Recorrência 'Unica') ou uma instância editada

      const valueCell = isUnique || item.isRecurrent
        ? `<span class="editable-value" onclick="editFixedExpenseValue('${item.id}', '${item.instanceId}', ${item.installmentNumber})">${formatCurrency(item.currentMonthValue)}</span>`
        : `<span>${formatCurrency(item.currentMonthValue)}</span>`;

      const removeBtn = isUnique
        ? `<button onclick="removeLogItem('fixed_expenses', '${item.id}')" class="delete-btn">Excluir</button>`
        : `<button onclick="removeTemplateOrInstance('${item.id}', '${item.instanceId}', ${item.installmentNumber})" class="delete-btn">Remover</button>`;
        
      const row = tbody.insertRow();
      row.innerHTML = `
        <td>${item.description}</td>
        <td>${valueCell}</td>
        <td>${item.payment}</td>
        <td>${removeBtn}</td>
      `;
    });
}

/**
 * Renderiza o controle de saldo inicial dos cartões (cartoes.html).
 */
function renderCardControls() {
  const cardListDiv = document.getElementById('card-list');
  if (!cardListDiv) return;

  cardListDiv.innerHTML = '';
  
  CARTAO_IDS.forEach(cardName => {
    const initialBalance = globalData.cards[cardName] || 0;
    
    // Calcula o total gasto no cartão neste mês (Despesas Variáveis + Fixas com esse cartão)
    const varExpenses = globalData.expenses.filter(e => e.payment === cardName).reduce((sum, item) => sum + (item.value || 0), 0);
    const fixedExpenses = globalData.fixedExpenses.filter(e => e.payment === cardName).reduce((sum, item) => sum + (item.currentMonthValue || 0), 0);
    const totalSpent = varExpenses + fixedExpenses;

    const currentFatura = initialBalance + totalSpent;

    const cardHtml = `
      <div class="card-item card-control">
        <span>${cardName} (Fatura do mês anterior)</span>
        <input type="number" step="0.01" id="card-initial-${cardName.replace(/[^a-zA-Z0-9]/g, '-')}" value="${initialBalance.toFixed(2)}" class="card-input" data-card-name="${cardName}">
        <span style="font-weight:bold;">Fatura Atual: ${formatCurrency(currentFatura)}</span>
      </div>
    `;
    cardListDiv.innerHTML += cardHtml;
  });
}

// -------------------- Funções de Persistência (Firestore) --------------------

/**
 * Adiciona um novo documento ao Firestore.
 * @param {string} collectionName
 * @param {Object} data
 * @returns {Promise<boolean>} Sucesso da operação.
 */
async function addDocument(collectionName, data) {
    const colRef = getDataRef(collectionName);
    if (!colRef) return false;

    try {
        await addDoc(colRef, data);
        return true;
    } catch (e) {
        console.error(`Erro ao adicionar documento em ${collectionName}:`, e);
        return false;
    }
}

/**
 * Remove um documento do Firestore.
 * @param {string} collectionName
 * @param {string} docId
 */
window.removeLogItem = async function(collectionName, docId) {
    if (!docId) {
        console.error("ID do documento não fornecido.");
        return;
    }

    // Usamos a coleção 'fixed_expenses' apenas para despesas únicas, ou para edições de recorrentes.
    // Se o ID vier de 'fixed_expenses', deletamos lá. Se vier de 'entries' ou 'expenses', deletamos lá.
    const path = getCollectionPath(collectionName);
    const docRef = doc(db, path, docId);

    try {
        await deleteDoc(docRef);
        // Recarrega os dados para atualizar a UI
        loadData();
    } catch (e) {
        console.error(`Erro ao remover documento de ${collectionName}:`, e);
    }
}


/**
 * Remove um template fixo OU apenas a instância do mês.
 * @param {string} expenseId - ID do documento em 'fixed_expenses' (se existir)
 * @param {string} templateId - ID do documento em 'fixed_templates'
 * @param {number} installmentNumber - Número da parcela (0 para mensal)
 */
window.removeTemplateOrInstance = function(expenseId, templateId, installmentNumber) {
    // Implementar lógica de modal/confirmação
    
    // Por simplicidade, vamos apenas deletar o template.
    // Em um sistema real, você perguntaria se quer excluir SÓ a parcela do mês, ou o template inteiro.
    if (confirm("Você deseja excluir:\n- OK: Apenas esta instância do mês atual?\n- Cancelar: O modelo recorrente/parcelado inteiro?")) {
        // Excluir a instância (cria uma entrada de edição com valor 0 se for template)
        if (expenseId) {
            removeLogItem('fixed_expenses', expenseId);
        } else {
            // Se não tem ID de fixed_expenses, cria uma nova entrada de edição com valor 0 para este mês
            const item = globalData.fixedExpenses.find(e => e.instanceId === templateId && e.installmentNumber === installmentNumber);
            if (item) {
                const monthKey = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`;
                addDocument('fixed_expenses', {
                    description: item.description,
                    value: 0,
                    category: item.category,
                    payment: item.payment,
                    monthKey: monthKey,
                    instanceId: templateId,
                    installmentNumber: installmentNumber
                }).then(() => loadData());
            }
        }
    } else {
        // Excluir o template inteiro
        const templatePath = getCollectionPath('fixed_templates');
        const docRef = doc(db, templatePath, templateId);
        deleteDoc(docRef).then(() => loadData()).catch(e => console.error("Erro ao deletar template fixo:", e));
    }
};

/**
 * Permite editar o valor de uma despesa fixa para o mês atual.
 * @param {string} expenseId - ID do documento em 'fixed_expenses' (se existir)
 * @param {string} templateId - ID do documento em 'fixed_templates'
 * @param {number} installmentNumber - Número da parcela (0 para mensal)
 */
window.editFixedExpenseValue = function(expenseId, templateId, installmentNumber) {
    const item = globalData.fixedExpenses.find(e => 
      (e.id === expenseId && !e.instanceId) || 
      (e.instanceId === templateId && e.installmentNumber === installmentNumber)
    );
    
    if (!item) return;

    const newValue = prompt(`Editar valor para ${item.description}:`, item.currentMonthValue.toFixed(2));
    if (newValue === null || isNaN(parseFloat(newValue))) return;

    const parsedValue = parseFloat(newValue);
    if (parsedValue < 0) {
      alert("O valor não pode ser negativo.");
      return;
    }

    const monthKey = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`;
    const baseData = {
        description: item.description.replace(/\s\(\d+\/\d+\)$/, ''), // Remove a contagem de parcela
        value: parsedValue,
        category: item.category,
        payment: item.payment,
        monthKey: monthKey
    };

    if (item.instanceId) {
        // É uma edição de um template recorrente
        const docId = item.id;
        const dataToSave = { 
            ...baseData, 
            instanceId: templateId, 
            installmentNumber: installmentNumber 
        };

        const colRef = getDataRef('fixed_expenses');

        if (docId) {
            // Documento de edição já existe, atualiza
            updateDoc(doc(colRef, docId), dataToSave).then(() => loadData());
        } else {
            // Cria um novo documento de edição para este mês
            addDoc(colRef, dataToSave).then(() => loadData());
        }
    } else {
        // É uma despesa única lançada neste mês (Recorrência: 'Unica' ou sem instanceId)
        const docRef = doc(getDataRef('fixed_expenses'), expenseId);
        updateDoc(docRef, { value: parsedValue }).then(() => loadData());
    }
}

/**
 * Salva o Saldo Inicial de Caixa e Cartões.
 */
window.saveCardInitialBalances = async function() {
  const monthKey = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`;
  
  // 1. Salva Saldo Inicial de Cartões
  const cardInputs = document.querySelectorAll('.card-input');
  const cardBalances = {};
  cardInputs.forEach(input => {
    const cardName = input.getAttribute('data-card-name');
    cardBalances[cardName] = parseFloat(input.value) || 0;
  });

  const settingsRef = doc(getDataRef('settings'), 'cards');
  try {
    await setDoc(settingsRef, { balances: cardBalances }, { merge: true });
    alert("Saldos de Cartões salvos com sucesso!");
  } catch (e) {
    console.error("Erro ao salvar saldos de cartões:", e);
    alert("Erro ao salvar saldos de cartões.");
    return;
  }
  
  // 2. Salva Saldo Inicial de Caixa
  // O saldo inicial de caixa para o mês M é o saldo final do mês M-1.
  // Vamos armazenar isso em 'monthly_balances'
  // Por simplicidade na UI, a edição é feita no campo de Saldo em Caixa no Painel
  const saldoCaixaElement = document.getElementById('saldo-caixa')?.querySelector('.value');
  const saldoFinalCaixa = parseFloat(saldoCaixaElement?.textContent.replace(/[R$\.,]/g, '').replace(' ', '') / 100) || 0;
  
  // O valor que estamos vendo no painel é o SALDO FINAL. 
  // Para persistir o SALDO INICIAL, precisamos de uma UI dedicada (atualmente em cartoes.html, mas sem input).
  // Vamos pular a persistência do saldo FINAL aqui para evitar sobrescrever a lógica de cálculo.
  // A edição do SALDO INICIAL precisa ser feita no campo específico, que será um modal ou input em `cartoes.html`.
  
  loadData();
}

/**
 * Atualiza o saldo inicial de caixa (Dinheiro/PIX) para o mês atual.
 * @param {number} newBalance
 */
async function updateInitialCashBalance(newBalance) {
    const monthKey = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`;
    const balanceRef = doc(getDataRef('settings'), 'monthly_balances');
    
    try {
        await setDoc(balanceRef, { 
            [monthKey]: { initialCashBalance: newBalance } 
        }, { merge: true });
        console.log("Saldo inicial de caixa atualizado.");
        loadData();
    } catch (e) {
        console.error("Erro ao salvar saldo inicial de caixa:", e);
    }
}


// -------------------- Handlers de Formulário --------------------

/**
 * Handler para submissão do formulário de Entradas.
 */
async function handleEntrySubmit(e) {
  e.preventDefault();
  const monthKey = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`;

  const data = {
    date: document.getElementById('entry-date').value,
    platform: document.getElementById('entry-platform').value,
    value: parseFloat(document.getElementById('entry-value').value) || 0,
    km: parseFloat(document.getElementById('entry-km').value) || 0,
    hours: parseFloat(document.getElementById('entry-hours').value) || 0,
    gas: parseFloat(document.getElementById('entry-gas').value) || 0,
    otherCosts: parseFloat(document.getElementById('entry-other-costs').value) || 0,
    monthKey: monthKey
  };
  
  if (data.value <= 0 || !data.date) {
      alert("Preencha todos os campos obrigatórios com valores válidos.");
      return;
  }

  if (await addDocument('entries', data)) {
    e.target.reset();
    loadData(); // Recarrega os dados após a submissão
  }
}

/**
 * Handler para submissão do formulário de Despesas Variáveis.
 */
async function handleExpenseSubmit(e) {
  e.preventDefault();
  const monthKey = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`;

  const data = {
    date: document.getElementById('expense-date').value,
    category: document.getElementById('expense-category').value,
    description: document.getElementById('expense-description').value,
    payment: document.getElementById('expense-payment').value,
    value: parseFloat(document.getElementById('expense-value').value) || 0,
    monthKey: monthKey
  };
  
  if (data.value <= 0 || !data.date || !data.description) {
      alert("Preencha todos os campos obrigatórios com valores válidos.");
      return;
  }

  if (await addDocument('expenses', data)) {
    e.target.reset();
    loadData();
  }
}

/**
 * Handler para submissão do formulário de Despesas Fixas.
 */
async function handleFixedExpenseSubmit(e) {
  e.preventDefault();
  const monthKey = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`;

  const recurrence = document.getElementById('fixed-expense-recurrence').value;
  const value = parseFloat(document.getElementById('fixed-expense-value').value) || 0;

  if (value <= 0) {
      alert("O valor deve ser maior que zero.");
      return;
  }
  
  const baseData = {
    description: document.getElementById('fixed-expense-description').value,
    category: document.getElementById('fixed-expense-category').value,
    payment: document.getElementById('fixed-expense-payment').value,
    value: value,
    monthKey: monthKey,
    recurrence: recurrence
  };

  let collectionName = 'fixed_templates'; // Padrão para mensal/parcelado
  let dataToSave = baseData;

  if (recurrence === 'Unica') {
    // Despesa única é salva diretamente na coleção de despesas do mês
    collectionName = 'fixed_expenses'; 
    dataToSave = baseData; // Sem totalInstallments
  } else if (recurrence === 'Parcelada') {
    const totalInstallments = parseInt(document.getElementById('fixed-expense-total-installments').value);
    if (!totalInstallments || totalInstallments < 2) {
      alert("Para despesa parcelada, o total de parcelas deve ser 2 ou mais.");
      return;
    }
    dataToSave = { ...baseData, totalInstallments };
  }
  
  // Mensal e Parcelada salvam em 'fixed_templates' para projeção
  if (await addDocument(collectionName, dataToSave)) {
    e.target.reset();
    document.getElementById('fixed-expense-recurrence').value = 'Unica';
    toggleRecurrenceForm('Unica');
    loadData();
  }
}

/**
 * Alterna a visibilidade dos campos de recorrência (parcelas).
 */
window.toggleRecurrenceForm = function(recurrence) {
  const parcelasGroup = document.getElementById('parcelas-group');
  if (parcelasGroup) {
    if (recurrence === 'Parcelada') {
      parcelasGroup.style.display = 'block';
      document.getElementById('fixed-expense-total-installments').setAttribute('required', 'required');
    } else {
      parcelasGroup.style.display = 'none';
      document.getElementById('fixed-expense-total-installments').removeAttribute('required');
    }
  }
}


// -------------------- Funções de Exportação (CSV e PDF) --------------------

/**
 * Exporta os dados do mês atual para CSV.
 */
window.exportMonthCSV = function() {
  const monthName = MESES_PT[currentMonth];
  const monthKey = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`;
  
  let csvContent = "Tipo,Data,Descrição/Plataforma,Categoria,Forma de Pagamento,Valor,KM,Horas\n";

  // Entradas
  globalData.entries.forEach(item => {
    csvContent += `Entrada,${formatDate(item.date)},${item.platform},-,Dinheiro/PIX,${item.value},${item.km},${item.hours}\n`;
    if (item.gas > 0) csvContent += `Custo Operacional (Gas),${formatDate(item.date)},Gasolina,Combustível,Dinheiro/PIX,-${item.gas},, \n`;
    if (item.otherCosts > 0) csvContent += `Custo Operacional (Outros),${formatDate(item.date)},Outros Custos,Outros,Dinheiro/PIX,-${item.otherCosts},, \n`;
  });

  // Despesas Variáveis
  globalData.expenses.forEach(item => {
    const value = item.value * -1;
    csvContent += `Despesa Variável,,${item.description},${item.category},${item.payment},${value},,\n`;
  });

  // Despesas Fixas (incluindo projeções)
  globalData.fixedExpenses.forEach(item => {
    const value = item.currentMonthValue * -1;
    csvContent += `Despesa Fixa/Dívida,,${item.description},${item.category},${item.payment},${value},,\n`;
  });

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement("a");
  if (link.download !== undefined) {
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `Controle_Financeiro_${monthName}_${currentYear}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
}

/**
 * Exporta os dados do mês atual para PDF (usando jspdf).
 */
window.exportMonthPDF = function() {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  const monthName = MESES_PT[currentMonth];
  
  doc.setFontSize(16);
  doc.text(`Relatório Financeiro: ${monthName}/${currentYear}`, 10, 10);
  
  doc.setFontSize(10);
  doc.text(`Gerado em: ${formatDate(new Date())}`, 10, 15);

  let y = 25;
  
  // Função auxiliar para adicionar tabela
  const addTable = (title, headers, data) => {
    if (data.length === 0) return;
    doc.setFontSize(12);
    doc.text(title, 10, y);
    y += 5;
    
    const tableData = data.map(item => headers.map(header => item[header.key]));

    doc.autoTable({
        startY: y,
        head: [headers.map(h => h.title)],
        body: tableData,
        theme: 'striped',
        styles: { fontSize: 8, cellPadding: 2, overflow: 'linebreak' },
        headStyles: { fillColor: [33, 150, 243] } // Cor Primária
    });
    
    y = doc.autoTable.previous.finalY + 10;
  };
  
  const entriesHeaders = [
    { title: "Data", key: 'date' },
    { title: "Plataforma", key: 'platform' },
    { title: "Valor", key: 'value' },
    { title: "KM", key: 'km' },
    { title: "Horas", key: 'hours' },
    { title: "Gasolina", key: 'gas' },
    { title: "Outros Custos", key: 'otherCosts' }
  ];
  
  const entriesData = globalData.entries.map(e => ({
      date: formatDate(e.date),
      platform: e.platform,
      value: formatCurrency(e.value),
      km: e.km.toFixed(1),
      hours: e.hours.toFixed(1),
      gas: formatCurrency(e.gas * -1),
      otherCosts: formatCurrency(e.otherCosts * -1),
  }));

  const expensesHeaders = [
    { title: "Data", key: 'date' },
    { title: "Descrição", key: 'description' },
    { title: "Categoria", key: 'category' },
    { title: "Forma de Pgto", key: 'payment' },
    { title: "Valor", key: 'value' }
  ];

  const expensesData = globalData.expenses.map(e => ({
      date: formatDate(e.date),
      description: e.description,
      category: LISTAS.categorias.find(c => c.value === e.category)?.label || e.category,
      payment: e.payment,
      value: formatCurrency(e.value * -1)
  }));
  
  const fixedHeaders = [
    { title: "Descrição/Parcela", key: 'description' },
    { title: "Categoria", key: 'category' },
    { title: "Forma de Pgto", key: 'payment' },
    { title: "Valor", key: 'value' }
  ];
  
  const fixedData = globalData.fixedExpenses.map(e => ({
      description: e.description,
      category: LISTAS.categorias.find(c => c.value === e.category)?.label || e.category,
      payment: e.payment,
      value: formatCurrency(e.currentMonthValue * -1)
  }));
  
  addTable("Entradas do Mês", entriesHeaders, entriesData);
  addTable("Despesas Variáveis", expensesHeaders, expensesData);
  addTable("Despesas Fixas e Dívidas", fixedHeaders, fixedData);

  doc.save(`Relatorio_${monthName}_${currentYear}.pdf`);
}

// -------------------- Inicialização --------------------

/**
 * Função principal de inicialização da aplicação.
 */
function initApp() {
  // Inicializa o mês atual
  setMonth(new Date());

  // Popula os selects nos formulários
  populateSelects();

  // Adiciona listeners para os formulários
  const entryForm = document.getElementById('entry-form'); if (entryForm) entryForm.addEventListener('submit', handleEntrySubmit);
  const expenseForm = document.getElementById('expense-form'); if (expenseForm) expenseForm.addEventListener('submit', handleExpenseSubmit);
  const fixedForm = document.getElementById('fixed-expense-form'); if (fixedForm) fixedForm.addEventListener('submit', handleFixedExpenseSubmit);

  // botões export
  const exportCsvBtn = document.getElementById('export-csv-btn'); if (exportCsvBtn) exportCsvBtn.addEventListener('click', exportMonthCSV);
  const exportPdfBtn = document.getElementById('export-pdf-btn'); if (exportPdfBtn) exportPdfBtn.addEventListener('click', exportMonthPDF);

  // expor funções para onclick inline (para serem acessíveis no DOM)
  // window.openTab = openTab; // Não necessário devido à navegação por <a>
  window.changeMonth = changeMonth;
  window.saveCardInitialBalances = saveCardInitialBalances;
  window.removeLogItem = removeLogItem;
  window.editFixedExpenseValue = editFixedExpenseValue;
  window.toggleRecurrenceForm = toggleRecurrenceForm;
  window.exportMonthCSV = exportMonthCSV;
  window.exportMonthPDF = exportMonthPDF;
  window.calculateSummary = calculateSummary;
}

// Executar init quando o DOM estiver pronto.
// A função `loadData` aguarda a inicialização do Firebase (`window.db` e `window.currentUserId`) para começar a carregar os dados.
document.addEventListener('DOMContentLoaded', initApp);