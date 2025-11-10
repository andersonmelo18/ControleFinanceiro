// script.js - VERSÃO DEFINITIVA COM FIRESTORE

// Importações do Firebase Firestore (necessário pois o script.js é carregado como module)
import { 
    doc, 
    getDoc, 
    setDoc, 
    writeBatch 
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// -------------------- Config / constantes --------------------
const CARTAO_IDS = ['💳 Cartão 1', '💳 Cartão 2', '💳 Cartão 3'];
const DINHEIRO_PIX_IDS = ['💵 Dinheiro', '📲 PIX'];
const MESES_PT = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];

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

// -------------------- Estado (mudará por mês) --------------------
let currentMonthDate = new Date(); 
let currentMonthKey = formatMonthKey(currentMonthDate);

let entries = [];       
let expenses = [];      
let fixedExpenses = []; 
let cardMonthlyData = {}; 
let masterPlans = {};   

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

// Helper para gerar IDs únicos (Firestore usa strings)
function generateUniqueId() {
    return `id_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

// -------------------- Utilitários de Firestore --------------------

// Acessa o documento do mês atual (e.g., users/uid/months/2025-11)
function getMonthDocRef(monthKey = currentMonthKey) {
  if (typeof db === 'undefined' || !window.currentUserId) {
    console.error("Erro: Firestore (db) ou ID do Usuário não está disponível.");
    return null;
  }
  // Estrutura: Coleção 'users' -> Documento '{userId}' -> Subcoleção 'months' -> Documento '{monthKey}'
  return doc(db, 'users', window.currentUserId, 'months', monthKey);
}

// Acessa o documento de planos mestres (e.g., users/uid/masterData/plans)
function getMasterPlansDocRef() {
  if (typeof db === 'undefined' || !window.currentUserId) {
    console.error("Erro: Firestore (db) ou ID do Usuário não está disponível.");
    return null;
  }
  // Estrutura: Coleção 'users' -> Documento '{userId}' -> Subcoleção 'masterData' -> Documento 'plans'
  return doc(db, 'users', window.currentUserId, 'masterData', 'plans');
}


// -------------------- Load / Save (FUNÇÕES ATUALIZADAS PARA FIRESTORE) --------------------

async function loadData() {
  currentMonthKey = formatMonthKey(currentMonthDate);
  const monthDocRef = getMonthDocRef();
  const masterPlansDocRef = getMasterPlansDocRef();

  if (!monthDocRef || !masterPlansDocRef) {
      // Se não há referência, o usuário está desconectado ou o Firebase falhou.
      // Retorna para que o initApp use dados vazios.
      return; 
  }

  try {
    // 1. Carregar dados do mês atual
    const monthSnapshot = await getDoc(monthDocRef);
    const monthData = monthSnapshot.data() || {};
    
    entries = monthData.entries || [];
    expenses = monthData.expenses || [];
    fixedExpenses = monthData.fixedExpenses || [];
    cardMonthlyData = monthData.cards || {};
    const meta = monthData.meta || {};

    // 2. Carregar planos mestres
    const masterSnapshot = await getDoc(masterPlansDocRef);
    const masterData = masterSnapshot.data() || {};
    masterPlans = masterData.masterPlans || {};

    // Inicializa estruturas de cartões
    if (!cardMonthlyData.initialBalances) cardMonthlyData.initialBalances = {};
    CARTAO_IDS.forEach(id => { if (cardMonthlyData.initialBalances[id] === undefined) cardMonthlyData.initialBalances[id] = 0; });
    if (!cardMonthlyData.monthlyExpenses) {
      cardMonthlyData.monthlyExpenses = {};
      CARTAO_IDS.forEach(id => cardMonthlyData.monthlyExpenses[id] = 0);
    }

    // 3. Carryover (Ler o saldo final do mês anterior)
    if (cardMonthlyData.startingCash === undefined) {
      const prevMonthDate = new Date(currentMonthDate);
      prevMonthDate.setMonth(prevMonthDate.getMonth() - 1);
      const prevKey = formatMonthKey(prevMonthDate);
      
      const prevMonthDocRef = getMonthDocRef(prevKey);
      const prevMonthSnapshot = await getDoc(prevMonthDocRef);
      const prevMonthMeta = prevMonthSnapshot.data()?.meta || null;
      
      // Define o saldo inicial do mês atual com o saldo final do mês anterior, ou 0
      cardMonthlyData.startingCash = prevMonthMeta?.closingCash || 0;
    }
    
    // Garante que closingCash existe
    cardMonthlyData.closingCash = meta.closingCash || 0;

  } catch(error) {
    console.error("Erro ao carregar dados do Firestore. Verifique as regras de segurança.", error);
    // Em caso de erro, garante arrays vazios para evitar falhas no resto do script
    entries = []; expenses = []; fixedExpenses = []; cardMonthlyData = {}; masterPlans = {};
  }
}

function saveData() {
  const monthDocRef = getMonthDocRef();
  const masterPlansDocRef = getMasterPlansDocRef();
  if (!monthDocRef || !masterPlansDocRef) return;
  
  // 1. Dados do mês atual (Documento users/uid/months/monthKey)
  const monthData = {
    entries: entries,
    expenses: expenses,
    fixedExpenses: fixedExpenses,
    cards: cardMonthlyData,
    meta: { closingCash: cardMonthlyData.closingCash || 0 }
  };
  // setDoc com merge: true garante que o documento é criado/atualizado sem apagar campos que não enviamos.
  setDoc(monthDocRef, monthData, { merge: true }).catch(err => console.error("Erro ao salvar dados do mês:", err));

  // 2. Planos mestres (Documento users/uid/masterData/plans)
  const masterData = {
    masterPlans: masterPlans
  };
  setDoc(masterPlansDocRef, masterData, { merge: true }).catch(err => console.error("Erro ao salvar planos mestres:", err));
}

// -------------------- Projeção de fixos/parcelados --------------------
function projectExpensesForMonth() {
  if (fixedExpenses.length > 0) return;

  const projectedExpenses = [];

  // Projeção Mensal
  Object.values(masterPlans)
    .filter(plan => plan.recurrence === 'Mensal')
    .forEach(plan => {
      projectedExpenses.push({
        id: generateUniqueId(), // Novo ID
        description: plan.description,
        category: plan.category,
        payment: plan.payment,
        value: plan.value,
        recurrence: 'Mensal',
        masterId: plan.id,
        isProjected: true
      });
    });

  // Projeção Parcelada
  Object.values(masterPlans)
    .filter(plan => plan.recurrence === 'Parcelada')
    .forEach(plan => {
      if (plan.paidInstallments < plan.totalInstallments) {
        const nextInstallment = plan.paidInstallments + 1;
        projectedExpenses.push({
          id: generateUniqueId(), // Novo ID
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
  // Inicialização de totais... (o resto da função é puramente lógica JS e permanece igual)
  let totalEntradas = 0;
  let totalKm = 0;
  let totalHours = 0;
  let totalDespesasDinheiroPix = 0;
  let totalDespesasCartao = 0;
  let totalDespesasFixas = 0;

  cardMonthlyData.monthlyExpenses = {};
  CARTAO_IDS.forEach(id => cardMonthlyData.monthlyExpenses[id] = 0);

  // 1. Entradas
  entries.forEach(entry => {
    totalEntradas += entry.value || 0;
    totalKm += entry.km || 0;
    totalHours += entry.hours || 0;
    totalDespesasDinheiroPix += (entry.gas || 0) + (entry.otherCosts || 0); 
  });

  // 2. Despesas variáveis
  expenses.forEach(exp => {
    const value = exp.value || 0;
    if (DINHEIRO_PIX_IDS.includes(exp.payment)) {
      totalDespesasDinheiroPix += value;
    } else if (CARTAO_IDS.includes(exp.payment)) {
      totalDespesasCartao += value;
      cardMonthlyData.monthlyExpenses[exp.payment] += value;
    } else {
      totalDespesasDinheiroPix += value;
    }
  });

  // 3. Despesas fixas (inclui projeções)
  fixedExpenses.forEach(exp => {
    const value = exp.value || 0;
    totalDespesasFixas += value; 
    if (DINHEIRO_PIX_IDS.includes(exp.payment)) {
      totalDespesasDinheiroPix += value;
    } else if (CARTAO_IDS.includes(exp.payment)) {
      totalDespesasCartao += value;
      cardMonthlyData.monthlyExpenses[exp.payment] += value;
    } else {
      totalDespesasDinheiroPix += value;
    }
  });

  const totalDespesasGeral = totalDespesasDinheiroPix + totalDespesasCartao;
  const totalDespesasVariaveis = totalDespesasGeral - totalDespesasFixas;
  const lucroLiquido = totalEntradas - totalDespesasGeral;

  const startingCash = cardMonthlyData.startingCash || 0;
  const saldoEmCaixa = startingCash + totalEntradas - totalDespesasDinheiroPix;

  cardMonthlyData.closingCash = saldoEmCaixa;

  // Renderização no dashboard (index.html)
  const elTotalEntradas = document.querySelector('#total-entradas .value');
  const elTotalDespesas = document.querySelector('#total-despesas .value');
  const elLucro = document.querySelector('#lucro-liquido .value');
  const elSaldo = document.querySelector('#saldo-caixa .value');
  const elKm = document.getElementById('total-km');
  const elHours = document.getElementById('total-hours');
  const elVarExp = document.getElementById('var-exp-value');
  const elFixExp = document.getElementById('fix-exp-value');

  if (elTotalEntradas) elTotalEntradas.textContent = formatBRL(totalEntradas);
  if (elTotalDespesas) elTotalDespesas.textContent = formatBRL(totalDespesasGeral);
  if (elLucro) elLucro.textContent = formatBRL(lucroLiquido);
  if (elSaldo) {
    elSaldo.textContent = formatBRL(saldoEmCaixa);
    let note = document.querySelector('#saldo-caixa .small');
    if (!note) {
      const p = document.createElement('p');
      p.classList.add('small');
      p.style.margin = '6px 0 0';
      p.textContent = `(Saldo Inicial: ${formatBRL(startingCash)})`;
      const parent = document.getElementById('saldo-caixa');
      if (parent) parent.appendChild(p);
    } else {
      note.textContent = `(Saldo Inicial: ${formatBRL(startingCash)})`;
    }
  }
  if (elKm) elKm.textContent = totalKm.toFixed(1) + ' km';
  if (elHours) elHours.textContent = totalHours.toFixed(1) + ' h';
  if (elVarExp) elVarExp.textContent = formatBRL(totalDespesasVariaveis);
  if (elFixExp) elFixExp.textContent = formatBRL(totalDespesasFixas);

  renderCardControls();
  saveData();

  renderSummaryTable();
  renderCharts();
}

// -------------------- Inserção de dados --------------------
function removeLogItem(id, type) {
  if (!confirm('Tem certeza que deseja remover este item?')) return;
  if (type === 'entry') entries = entries.filter(i => i.id !== id);
  if (type === 'expense') expenses = expenses.filter(i => i.id !== id);
  if (type === 'fixed') fixedExpenses = fixedExpenses.filter(i => i.id !== id);
  saveData();
  renderLogs();
  calculateSummary();
}

function toggleRecurrenceForm(recurrenceType) {
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
  if (e) e.preventDefault();
  const form = document.getElementById('fixed-expense-form');
  if (!form) return;

  const recurrence = document.getElementById('fixed-expense-recurrence').value;
  const totalInstallments = parseInt(document.getElementById('fixed-expense-total-installments').value || '0');
  const value = parseFloat(document.getElementById('fixed-expense-value').value || '0');
  const masterId = generateUniqueId(); // ID único para o plano mestre

  const newFixedExpenseMaster = {
    id: masterId,
    description: document.getElementById('fixed-expense-description').value,
    category: document.getElementById('fixed-expense-category').value,
    payment: document.getElementById('fixed-expense-payment').value,
    value: value,
    recurrence: recurrence,
    paidInstallments: 0,
    totalInstallments: (recurrence === 'Parcelada' ? totalInstallments : 0)
  };

  // Salva no plano mestre se for recorrente
  if (recurrence !== 'Unica') {
    masterPlans[masterId] = newFixedExpenseMaster;
  }

  // Cria o item de log para o mês atual
  const logItem = {
    ...newFixedExpenseMaster,
    id: generateUniqueId(), // ID único para o log do mês
    masterId: masterId,
    isProjected: false 
  };

  if (recurrence === 'Parcelada') {
    logItem.description = `${logItem.description} (1/${totalInstallments})`;
    logItem.installment = 1; 
  }

  fixedExpenses.push(logItem);
  saveData();
  form.reset();
  toggleRecurrenceForm('Unica');
  renderLogs();
  calculateSummary();
}

function editFixedExpenseValue(id, currentValue) {
  const newValue = prompt('Editar valor da despesa para o mês atual (R$):', (currentValue || 0).toFixed(2));
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
  if (e) e.preventDefault();
  const form = document.getElementById('entry-form');
  if (!form) return;
  const newEntry = {
    id: generateUniqueId(),
    date: document.getElementById('entry-date').value,
    platform: document.getElementById('entry-platform').value,
    value: parseFloat(document.getElementById('entry-value').value) || 0,
    km: parseFloat(document.getElementById('entry-km').value) || 0,
    hours: parseFloat(document.getElementById('entry-hours').value) || 0,
    gas: parseFloat(document.getElementById('entry-gas').value) || 0,
    otherCosts: parseFloat(document.getElementById('entry-other-costs').value) || 0
  };
  entries.push(newEntry);
  saveData();
  form.reset();
  renderLogs();
  calculateSummary();
}

function handleExpenseSubmit(e) {
  if (e) e.preventDefault();
  const form = document.getElementById('expense-form');
  if (!form) return;
  const newExpense = {
    id: generateUniqueId(),
    date: document.getElementById('expense-date').value,
    category: document.getElementById('expense-category').value,
    description: document.getElementById('expense-description').value,
    payment: document.getElementById('expense-payment').value,
    value: parseFloat(document.getElementById('expense-value').value) || 0
  };
  expenses.push(newExpense);
  saveData();
  form.reset();
  renderLogs();
  calculateSummary();
}

// -------------------- Render logs / tabelas --------------------
function renderLogs() {
  const monthDisplay = document.getElementById('current-month-display');
  const elMonthLog = document.getElementById('current-month-log-display');
  if (elMonthLog && monthDisplay) elMonthLog.textContent = monthDisplay.textContent;

  // Entradas
  const entriesBody = document.getElementById('entries-log-body');
  if (entriesBody) {
    entriesBody.innerHTML = entries.map(entry => `
      <tr>
        <td>${entry.date}</td>
        <td>${entry.platform}</td>
        <td>${formatBRL(entry.value)}</td>
        <td>${entry.km}</td>
        <td><button class="delete-btn" onclick="removeLogItem('${entry.id}', 'entry')">X</button></td>
      </tr>
    `).join('');
  }

  // Despesas variáveis
  const expensesBody = document.getElementById('expenses-log-body');
  if (expensesBody) {
    expensesBody.innerHTML = expenses.map(exp => `
      <tr>
        <td>${exp.date}</td>
        <td>${exp.category}</td>
        <td>${formatBRL(exp.value)}</td>
        <td>${exp.payment}</td>
        <td><button class="delete-btn" onclick="removeLogItem('${exp.id}', 'expense')">X</button></td>
      </tr>
    `).join('');
  }

  // Despesas fixas
  const fixedBody = document.getElementById('fixed-expenses-log-body');
  if (fixedBody) {
    fixedBody.innerHTML = fixedExpenses.map(exp => {
      const isProjectedIcon = exp.isProjected ? ' <span style="color:var(--cor-destaque); font-size:12px;">(Proj.)</span>' : '';
      const displayDesc = exp.recurrence === 'Parcelada' ? `${exp.description}` : `${exp.description} (${exp.category})`;
      // Valor clicável para edição
      const valueClickable = `<span onclick="editFixedExpenseValue('${exp.id}', ${exp.value})" style="cursor:pointer; text-decoration:underline;">${formatBRL(exp.value)}</span>${isProjectedIcon}`;
      return `
        <tr>
          <td>${displayDesc}</td>
          <td>${valueClickable}</td>
          <td>${exp.payment}</td>
          <td><button class="delete-btn" onclick="removeLogItem('${exp.id}', 'fixed')">X</button></td>
        </tr>
      `;
    }).join('');
  }
}

// -------------------- Mês / navegação --------------------
function updateMonthDisplay() {
  const year = currentMonthDate.getFullYear();
  const month = currentMonthDate.getMonth();
  const el = document.getElementById('current-month-display');
  if (el) el.textContent = `${MESES_PT[month]} ${year}`;
  currentMonthKey = formatMonthKey(currentMonthDate);
}

// CRÍTICO: Função de persistência de parcelas para o mês anterior (Firestore)
async function updateMasterPlansForPreviousMonth(prevMonthKey) {
  const prevMonthDocRef = getMonthDocRef(prevMonthKey);
  const masterPlansDocRef = getMasterPlansDocRef();
  if (!prevMonthDocRef || !masterPlansDocRef || typeof db === 'undefined') return;

  // Cria um lote de escrita para operações atômicas
  const batch = writeBatch(db);

  try {
    const prevMonthSnapshot = await getDoc(prevMonthDocRef);
    const prevMonthData = prevMonthSnapshot.data() || {};
    const prevFixedExpenses = prevMonthData.fixedExpenses || [];

    const masterPlansSnapshot = await getDoc(masterPlansDocRef);
    let masterPlansToUpdate = masterPlansSnapshot.data()?.masterPlans || {};
    
    let needsUpdate = false;

    prevFixedExpenses.forEach(expense => {
      // Condição de atualização: é parcela, não é projeção (foi paga/confirmada) e o número da parcela é válido.
      if (expense.recurrence === 'Parcelada' && expense.isProjected === false && expense.masterId && expense.installment) {
        const masterPlan = masterPlansToUpdate[expense.masterId];
        // Atualiza apenas se a parcela paga registrada no master for menor que a parcela paga neste mês
        if (masterPlan && masterPlan.paidInstallments < expense.installment) {
          masterPlan.paidInstallments = expense.installment;
          needsUpdate = true;
        }
      }
    });
    
    if (needsUpdate) {
        // Salva a atualização no Firestore
        batch.set(masterPlansDocRef, { masterPlans: masterPlansToUpdate }, { merge: true });
        await batch.commit();

        // Atualiza a variável global
        masterPlans = masterPlansToUpdate;
    }

  } catch (error) {
    console.error("Erro ao atualizar planos mestres no Firestore:", error);
  }
}

// CRÍTICO: Função de navegação agora é ASYNC
async function changeMonth(delta) {
  // 1. Antes de mudar, ATUALIZA status de parcelas do mês atual (aguarda)
  await updateMasterPlansForPreviousMonth(currentMonthKey);

  // 2. Muda o estado do mês
  currentMonthDate.setMonth(currentMonthDate.getMonth() + delta);
  updateMonthDisplay();
  
  // 3. Espera os dados do novo mês (aguarda)
  await loadData();
  
  // 4. Recalcula e renderiza
  projectExpensesForMonth();
  renderLogs();
  calculateSummary();
}

// -------------------- Resumo tabela e Gráficos --------------------
// (A lógica de resumo/gráficos não mudou, apenas usa os dados carregados)
function renderSummaryTable() {
  const container = document.getElementById('monthly-summary-table');
  if (!container) return;

  // ... (cálculos omitidos, pois são a repetição da calculateSummary)
  let totalEntradas = 0;
  let totalDespesasDinheiroPix = 0;
  let totalDespesasCartao = 0;
  let totalDespesasFixas = 0;

  entries.forEach(e => { totalEntradas += (e.value || 0); totalDespesasDinheiroPix += ((e.gas || 0) + (e.otherCosts || 0)); });
  expenses.forEach(exp => {
    if (DINHEIRO_PIX_IDS.includes(exp.payment)) totalDespesasDinheiroPix += exp.value || 0;
    else if (CARTAO_IDS.includes(exp.payment)) totalDespesasCartao += exp.value || 0;
    else totalDespesasDinheiroPix += exp.value || 0;
  });
  fixedExpenses.forEach(f => {
    totalDespesasFixas += f.value || 0;
    if (DINHEIRO_PIX_IDS.includes(f.payment)) totalDespesasDinheiroPix += f.value || 0;
    else if (CARTAO_IDS.includes(f.payment)) totalDespesasCartao += f.value || 0;
    else totalDespesasDinheiroPix += f.value || 0;
  });

  const totalDespesasGeral = totalDespesasDinheiroPix + totalDespesasCartao;
  const lucro = totalEntradas - totalDespesasGeral;
  const startingCash = cardMonthlyData.startingCash || 0;
  const saldoFinal = cardMonthlyData.closingCash || (startingCash + totalEntradas - totalDespesasDinheiroPix);

  container.innerHTML = `
    <table class="log-table">
      <thead><tr><th>Item</th><th>Valor</th></tr></thead>
      <tbody>
        <tr><td>Total Entradas</td><td>${formatBRL(totalEntradas)}</td></tr>
        <tr><td>Total Despesas Fixas</td><td>${formatBRL(totalDespesasFixas)}</td></tr>
        <tr><td>Total Despesas Variáveis</td><td>${formatBRL(totalDespesasGeral - totalDespesasFixas)}</td></tr>
        <tr><td>Total Despesas (Geral)</td><td>${formatBRL(totalDespesasGeral)}</td></tr>
        <tr><td>Lucro Líquido</td><td>${formatBRL(lucro)}</td></tr>
        <tr><td>Saldo Inicial (carryover)</td><td>${formatBRL(startingCash)}</td></tr>
        <tr><td>Saldo Final (caixa)</td><td>${formatBRL(saldoFinal)}</td></tr>
      </tbody>
    </table>
  `;
}

function renderCharts() {
  const donutCtx = document.getElementById('chart-donut')?.getContext?.('2d');
  const barCtx = document.getElementById('chart-bar')?.getContext?.('2d');

  let totalIncome = 0;
  let totalExpense = 0;
  entries.forEach(e => totalIncome += (e.value || 0));
  fixedExpenses.forEach(f => totalExpense += (f.value || 0));
  expenses.forEach(e => totalExpense += (e.value || 0));

  if (donutCtx) {
    const data = [ totalExpense, totalIncome ];
    if (chartDonut) { chartDonut.data.datasets[0].data = data; chartDonut.update(); }
    else {
      chartDonut = new Chart(donutCtx, {
        type: 'doughnut',
        data: { labels: ['Despesas','Receitas'], datasets: [{ data, backgroundColor: ['#ef5350','#66bb6a'] }] },
        options: { maintainAspectRatio: false }
      });
    }
  }

  if (barCtx) {
    const categories = LISTAS.categorias.map(c => c.value);
    const catSums = categories.map(cat => {
      let s = 0;
      fixedExpenses.forEach(f => { if (f.category === cat) s += f.value || 0; });
      expenses.forEach(e => { if (e.category === cat) s += e.value || 0; });
      return s;
    });

    if (chartBar) { chartBar.data.labels = categories; chartBar.data.datasets[0].data = catSums; chartBar.update(); }
    else {
      chartBar = new Chart(barCtx, {
        type: 'bar',
        data: { labels: categories, datasets: [{ label: 'Gastos por Categoria', data: catSums }]},
        options: { maintainAspectRatio: false, scales: { x: { ticks: { maxRotation: 90 } } } }
      });
    }
  }
}

// -------------------- Export CSV / PDF --------------------
function exportMonthCSV() {
  const rows = [];
  rows.push(['Tipo','Data','Descrição','Categoria/Plataforma','Pagamento','Valor']);
  entries.forEach(e => rows.push(['Entrada', e.date || '', e.platform || '', '', '', (e.value || 0).toFixed(2)]));
  expenses.forEach(e => rows.push(['Despesa Variável', e.date || '', e.description || '', e.category || '', e.payment || '', (e.value || 0).toFixed(2)]));
  fixedExpenses.forEach(f => rows.push(['Despesa Fixa', '', f.description || '', f.category || '', f.payment || '', (f.value || 0).toFixed(2)]));

  const csvContent = rows.map(r => r.map(cell => `"${String(cell).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `finance_${currentMonthKey}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function exportMonthPDF() {
  if (typeof window.jspdf?.jsPDF === 'undefined') {
    alert('A biblioteca jsPDF não está carregada. Você pode exportar em CSV (Excel) em vez disso.');
    return;
  }
  const { jsPDF: JsPDF } = window.jspdf;
  const doc = new JsPDF();
  doc.setFontSize(12);
  doc.text(`Resumo Financeiro - ${currentMonthKey}`, 10, 14);

  const summaryEl = document.getElementById('monthly-summary-table');
  let y = 24;
  if (summaryEl) {
    const lines = summaryEl.innerText.split('\n').filter(Boolean);
    lines.forEach(line => { doc.text(line, 10, y); y += 6; });
  }
  doc.save(`finance_${currentMonthKey}.pdf`);
}

// -------------------- Inicialização --------------------
function populateSelect(elementId, options) {
  const s = document.getElementById(elementId);
  if (!s) return;
  s.innerHTML = '<option value="">Selecione...</option>';
  options.forEach(option => {
    const o = document.createElement('option');
    o.value = option.value;
    o.textContent = option.label;
    s.appendChild(o);
  });
}

// CRÍTICO: initApp agora é async para esperar o loadData do Firestore
async function initApp() {
  // O código precisa esperar até que window.currentUserId seja definido (após a autenticação em index.html)
  if (!window.currentUserId) {
    // Adiciona um listener para tentar novamente quando o ID do usuário estiver disponível.
    // Isso é uma medida de segurança, o ideal é que onAuthStateChanged em index.html seja rápido.
    setTimeout(initApp, 100); 
    return;
  }
  
  // exibir mês atual
  updateMonthDisplay();

  // carrega dados do mês (AGORA ESPERA PELO FIRESTORE)
  await loadData();

  // projeta fixos/parcelas
  projectExpensesForMonth();

  // renderiza
  calculateSummary();
  renderLogs();

  // popula selects
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
  
  // listeners de botões (index.html)
  const exportCsvBtn = document.getElementById('export-csv-btn'); if (exportCsvBtn) exportCsvBtn.addEventListener('click', exportMonthCSV);
  const exportPdfBtn = document.getElementById('export-pdf-btn'); if (exportPdfBtn) exportPdfBtn.addEventListener('click', exportMonthPDF);

  // expor funções para onclick inline (CRÍTICO para botões em HTML)
  window.changeMonth = changeMonth;
  window.saveCardInitialBalances = saveCardInitialBalances;
  window.removeLogItem = removeLogItem;
  window.editFixedExpenseValue = editFixedExpenseValue;
  window.toggleRecurrenceForm = toggleRecurrenceForm;
}

// executar init quando DOM pronto
document.addEventListener('DOMContentLoaded', initApp);