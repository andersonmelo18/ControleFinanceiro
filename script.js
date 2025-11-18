/* script.js - CÓDIGO REFATORADO COM NOVAS FUNCIONALIDADES */

// -------------------- Config / constantes --------------------
// Configuração do Firebase é carregada nos arquivos HTML
const CARTAO_IDS = ['💳 Cartão 1', '💳 Cartão 2', '💳 Cartão 3'];
const DINHEIRO_PIX_IDS = ['💵 Dinheiro', '📲 PIX'];
const MESES_PT = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];

const FIREBASE_PATH = 'data/usuario_padrao/';

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
  ],
  // NOVO: Lista de Bancos para Investimentos
  bancos: [
    { value: 'NuBank', label: '🟣 NuBank' },
    { value: 'Inter', label: '🧡 Inter' },
    { value: 'BTG Pactual', label: '🟦 BTG Pactual' },
    { value: 'Caixa Econômica', label: '🏛️ Caixa Econômica' },
    { value: 'Outro', label: 'Outro' }
  ]
};

// -------------------- Estado (mudará por mês) --------------------
let currentMonthDate = new Date(); 
let entries = [];      
let expenses = [];     
let fixedExpenses = [];
let cardMonthlyData = {}; 
let masterPlans = {};  
let currentMonthKey = formatMonthKey(currentMonthDate);
let cardSpecs = {}; // NOVO: Especificações mestre dos cartões
let investments = []; // NOVO: Investimentos
let pendencies = [];  // NOVO: Pendências

let globalMeta = 0; // NOVO: Meta mensal

// Chart instances
let chartDonut = null;
let chartBar = null;
let chartInvestment = null; // NOVO: Instância do gráfico de investimento

// -------------------- Utilitários --------------------
function formatBRL(value) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value || 0);
}
function formatMonthKey(date) {
  const year = date.getFullYear();
  const month = date.getMonth() + 1;
  return `${year}-${String(month).padStart(2, '0')}`;
}
function parseMonthKey(key) {
    const [year, month] = key.split('-').map(Number);
    // Retorna a data no dia 1 do mês. O JS usa 0-11 para meses, então (month - 1)
    return new Date(year, month - 1, 1); 
}
function getDataRef(type, monthKey = currentMonthKey) {
  return db.ref(`${FIREBASE_PATH}${monthKey}/${type}`);
}
function getMasterRef(type) {
  return db.ref(`${FIREBASE_PATH}master_${type}`);
}
function getGlobalRef(type) {
    return db.ref(`${FIREBASE_PATH}global_settings/${type}`);
}

// Converte objeto para array (usado no load)
const toArray = (data) => data && typeof data === 'object' && !Array.isArray(data) ? Object.values(data) : (data || []);

// -------------------- Load / Save --------------------
async function loadData() {
  currentMonthKey = formatMonthKey(currentMonthDate);

  const readMonthData = async (type) => {
    const snapshot = await getDataRef(type).once('value');
    return snapshot.val() || (type === 'cards' ? {} : (type === 'meta' ? {} : []));
  };
  
  const readMasterData = async (type) => {
    const snapshot = await getMasterRef(type).once('value');
    return snapshot.val() || {};
  };

  const readGlobalData = async (type) => {
    const snapshot = await getGlobalRef(type).once('value');
    return snapshot.val() || 0;
  };

  let data;
  try {
     data = await Promise.all([
      readMonthData('entries'),
      readMonthData('expenses'),
      readMonthData('fixedExpenses'),
      readMonthData('cards'),
      readMasterData('plans'),
      readMasterData('cardSpecs'), // NOVO: Carregar specs do cartão
      readGlobalData('goal'), // NOVO: Carregar meta
      readMasterData('investments'), // NOVO: Carregar investimentos
      readMasterData('pendencies') // NOVO: Carregar pendências
    ]);
  } catch(error) {
    console.error("Erro ao carregar dados do Firebase:", error);
    // Apenas ignora em caso de erro para permitir o funcionamento offline/parcial
    return;
  }

  [entries, expenses, fixedExpenses, cardMonthlyData, masterPlans, cardSpecs, globalMeta, investments, pendencies] = data;
  
  entries = toArray(entries);
  expenses = toArray(expenses);
  fixedExpenses = toArray(fixedExpenses);
  investments = toArray(investments);
  pendencies = toArray(pendencies);

  // Inicializa 'paid' para compatibilidade (fixo/parcelado)
  fixedExpenses.forEach(exp => {
    if (exp.paid === undefined) {
      exp.paid = false;
    }
  });
  
  if (!masterPlans || Array.isArray(masterPlans)) masterPlans = {};
  if (!cardSpecs || Array.isArray(cardSpecs)) cardSpecs = {};

  // Inicializa dados mensais de cartões
  if (!cardMonthlyData.initialBalances) cardMonthlyData.initialBalances = {};
  CARTAO_IDS.forEach(id => { if (cardMonthlyData.initialBalances[id] === undefined) cardMonthlyData.initialBalances[id] = 0; });

  if (!cardMonthlyData.monthlyExpenses) {
    cardMonthlyData.monthlyExpenses = {};
    CARTAO_IDS.forEach(id => cardMonthlyData.monthlyExpenses[id] = 0);
  }

  // Carryover (Saldos em Caixa)
  if (cardMonthlyData.startingCash === undefined) {
    const prevMonthDate = new Date(currentMonthDate);
    prevMonthDate.setMonth(prevMonthDate.getMonth() - 1);
    const prevKey = formatMonthKey(prevMonthDate);
    
    const prevMetaSnapshot = await db.ref(`${FIREBASE_PATH}${prevKey}/meta`).once('value');
    const prevMeta = prevMetaSnapshot.val() || null;
    
    cardMonthlyData.startingCash = prevMeta?.closingCash || 0;
  }

  if (cardMonthlyData.closingCash === undefined) cardMonthlyData.closingCash = 0;
}

function saveData() {
  getDataRef('entries').set(entries);
  getDataRef('expenses').set(expenses);
  getDataRef('fixedExpenses').set(fixedExpenses);
  getDataRef('cards').set(cardMonthlyData);
  
  getMasterRef('plans').set(masterPlans);
  getMasterRef('cardSpecs').set(cardSpecs); // NOVO: Salvar specs
  getMasterRef('investments').set(investments); // NOVO: Salvar investimentos
  getMasterRef('pendencies').set(pendencies); // NOVO: Salvar pendências

  getGlobalRef('goal').set(globalMeta); // NOVO: Salvar meta global

  // Salva meta (closingCash) no mês atual
  const meta = { closingCash: cardMonthlyData.closingCash || 0 };
  getDataRef('meta').set(meta);
}

// -------------------- Projeção de fixos/parcelados --------------------
function projectExpensesForMonth() {
  // 1. Aplica projeções de Cartões Specs (se existirem)
  applyCardSpecsProjection();

  // Se já houver despesas fixas para este mês, não projeta novamente.
  if (fixedExpenses.length > 0) return;

  const projectedExpenses = [];
  const currentMonthStart = parseMonthKey(currentMonthKey);

  Object.values(masterPlans)
    // Filtra planos cuja recorrência não é Única E que são iguais ou posteriores ao mês atual
    .filter(plan => 
        plan.recurrence !== 'Unica' && 
        parseMonthKey(plan.startMonthKey) <= currentMonthStart // Somente planos criados no passado ou neste mês
    )
    .forEach(plan => {
      // PROJEÇÃO MENSAL
      if (plan.recurrence === 'Mensal') {
        projectedExpenses.push({
          id: Date.now() + Math.random(),
          dueDate: plan.dueDate, // NOVO
          description: plan.description,
          category: plan.category,
          payment: plan.payment,
          value: plan.value,
          recurrence: 'Mensal',
          masterId: plan.id,
          isProjected: true,
          paid: false
        });
      }
      
      // PROJEÇÃO PARCELADA
      if (plan.recurrence === 'Parcelada') {
        if (plan.paidInstallments < plan.totalInstallments) {
          const nextInstallment = plan.paidInstallments + 1;
          projectedExpenses.push({
            id: Date.now() + Math.random(),
            dueDate: plan.dueDate, // NOVO
            description: `${plan.description} (${nextInstallment}/${plan.totalInstallments})`,
            category: plan.category,
            payment: plan.payment,
            value: plan.value,
            recurrence: 'Parcelada',
            masterId: plan.id,
            installment: nextInstallment,
            totalInstallments: plan.totalInstallments,
            isProjected: true,
            paid: false
          });
        }
      }
    });

  fixedExpenses = projectedExpenses;
  saveData();
}

// NOVO: Aplica projeção de parcelas de cartão
function applyCardSpecsProjection() {
    CARTAO_IDS.forEach(cardId => {
        const spec = Object.values(cardSpecs).find(s => s.cardId === cardId);
        if (!spec || spec.installments.length === 0) return;

        let totalProjectedExpense = 0;
        spec.installments.forEach(item => {
            const dueDate = item.dueDate || 1; // Dia de vencimento do cartão
            const installmentValue = item.value / item.totalInstallments;

            // Calcula qual parcela está ativa neste mês.
            // A data de início é a data da compra (item.startMonthKey).
            const startMonth = parseMonthKey(item.startMonthKey);
            const currentMonth = parseMonthKey(currentMonthKey);
            
            // Diferença em meses (mês atual - mês da compra)
            let diffMonths = (currentMonth.getFullYear() - startMonth.getFullYear()) * 12;
            diffMonths -= startMonth.getMonth();
            diffMonths += currentMonth.getMonth();
            
            // O número da parcela (1-based)
            const currentInstallment = diffMonths + 1;

            if (currentInstallment > 0 && currentInstallment <= item.totalInstallments) {
                totalProjectedExpense += installmentValue;
            }
        });

        // Atualiza o monthlyExpenses (usado em calculateSummary)
        // Se houver specs, o valor manual em cartoes.html é ignorado.
        cardMonthlyData.monthlyExpenses[cardId] = totalProjectedExpense;
    });
}

// -------------------- Cartões --------------------
function renderCardControls() {
  const container = document.getElementById('card-list');
  if (!container) return;
  container.innerHTML = '';
  let totalFaturas = 0;

  CARTAO_IDS.forEach(id => {
    const hasSpecs = Object.values(cardSpecs).some(s => s.cardId === id && s.installments.length > 0);
    const initialBalance = cardMonthlyData.initialBalances?.[id] || 0;
    const totalExpenses = cardMonthlyData.monthlyExpenses?.[id] || 0;
    const totalFatura = initialBalance + totalExpenses;
    totalFaturas += totalFatura;

    // Desabilita input se houver specs
    const disabledAttr = hasSpecs ? 'disabled' : ''; 
    const disabledMessage = hasSpecs ? `<br><span style="font-size:10px; color:var(--cor-sucesso);">* Projeção por Specs Ativa.</span>` : '';

    const cardItem = document.createElement('div');
    cardItem.classList.add('card-item');
    cardItem.innerHTML = `
      <span>${id} (Fatura) ${disabledMessage}</span>
      <input type="number" class="card-initial-input" data-card-id="${id}" step="0.01" value="${initialBalance.toFixed(2)}" placeholder="Saldo Inicial" ${disabledAttr}>
      <span>+ ${formatBRL(totalExpenses)} (${hasSpecs ? 'Projetado' : 'Gastos Mês'})</span>
      <span class="card-fatura-total">${formatBRL(totalFatura)}</span>
    `;
    container.appendChild(cardItem);
  });

  const totalFaturasDisplay = document.getElementById('total-faturas-display');
  if (totalFaturasDisplay) totalFaturasDisplay.textContent = formatBRL(totalFaturas);
}

function saveCardInitialBalances() {
  const inputs = document.querySelectorAll('.card-initial-input:not([disabled])');
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
  let totalEntradas = 0;
  let totalKm = 0;
  let totalHours = 0;
  let totalDespesasDinheiroPix = 0;
  let totalDespesasCartao = 0;
  
  let totalDespesasFixasProjetadas = 0; 
  let totalFixedDiluida = 0; // SÓ FIXAS PAGAS!
  let totalDespesasVariaveis = 0; 

  cardMonthlyData.monthlyExpenses = {};
  CARTAO_IDS.forEach(id => cardMonthlyData.monthlyExpenses[id] = 0);
  applyCardSpecsProjection(); // Recalcula se houver specs

  // 1. ENTRADAS
  entries.forEach(entry => {
    totalEntradas += entry.value || 0;
    totalKm += entry.km || 0;
    totalHours += entry.hours || 0;
    totalDespesasDinheiroPix += (entry.gas || 0) + (entry.otherCosts || 0);
  });

  // 2. DESPESAS VARIÁVEIS
  expenses.forEach(exp => {
    const value = exp.value || 0;
    totalDespesasVariaveis += value;

    if (DINHEIRO_PIX_IDS.includes(exp.payment)) {
      totalDespesasDinheiroPix += value;
    } else if (CARTAO_IDS.includes(exp.payment)) {
      totalDespesasCartao += value;
      // Adiciona ao gasto mensal, a menos que haja projeção de specs (que já foi aplicada)
      if (!Object.values(cardSpecs).some(s => s.cardId === exp.payment && s.installments.length > 0)) {
           cardMonthlyData.monthlyExpenses[exp.payment] += value;
      }
    } else {
      totalDespesasDinheiroPix += value;
    }
  });

  // 3. DESPESAS FIXAS (PROJETADAS E DILUÍDAS)
  fixedExpenses.forEach(exp => {
    const value = exp.value || 0;
    totalDespesasFixasProjetadas += value;

    // NOVO: SOMENTE DESPESAS FIXAS MARCADAS COMO PAGAS SÃO DILUÍDAS NO TOTAL
    if (exp.paid) {
        totalFixedDiluida += value;
        if (DINHEIRO_PIX_IDS.includes(exp.payment)) {
          totalDespesasDinheiroPix += value;
        } else if (CARTAO_IDS.includes(exp.payment)) {
          totalDespesasCartao += value;
          // Adiciona ao gasto mensal
          if (!Object.values(cardSpecs).some(s => s.cardId === exp.payment && s.installments.length > 0)) {
            cardMonthlyData.monthlyExpenses[exp.payment] += value;
          }
        } else {
          totalDespesasDinheiroPix += value;
        }
    }
  });

  // 4. PENDÊNCIAS (Impactam Saldo em Caixa)
  pendencies.forEach(p => {
    // Se for débito (eu devo) E PAGO, reduz caixa
    if (p.type === 'debit' && p.paid) {
        totalDespesasDinheiroPix += p.value || 0;
    }
    // Se for crédito (me devem) E RECEBIDO, aumenta caixa
    if (p.type === 'credit' && p.paid) {
        totalEntradas += p.value || 0;
    }
  });

  // 5. INVESTIMENTOS (Impactam Saldo em Caixa)
  // Investimento é uma despesa de caixa, então subtrai do caixa
  const totalInvestments = investments.reduce((sum, inv) => sum + (inv.value || 0), 0);
  totalDespesasDinheiroPix += totalInvestments;


  const totalDespesasGeral = totalDespesasVariaveis + totalFixedDiluida; // Diluídas
  const lucroLiquido = totalEntradas - totalDespesasGeral;

  const startingCash = cardMonthlyData.startingCash || 0;
  // Saldo: Saldo Inicial + Entradas (incluindo crédito de pendência) - Despesas Dinheiro/PIX (incluindo fixas pagas e débitos de pendência) - Investimentos
  const saldoEmCaixa = startingCash + totalEntradas - totalDespesasDinheiroPix;

  cardMonthlyData.closingCash = saldoEmCaixa;

  // Renderização
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
    if (note) note.textContent = `(Saldo Inicial: ${formatBRL(startingCash)})`;
  }
  if (elKm) elKm.textContent = totalKm.toFixed(1) + ' km';
  if (elHours) elHours.textContent = totalHours.toFixed(1) + ' h';
  if (elVarExp) elVarExp.textContent = formatBRL(totalDespesasVariaveis);
  if (elFixExp) elFixExp.textContent = formatBRL(totalDespesasFixasProjetadas); // Total Projetado

  // NOVO: Renderiza a meta
  renderMonthlyGoal(totalEntradas);
  
  renderCardControls();
  saveData();

  renderSummaryTable();
  renderCharts();
}

// NOVO: Lógica da Meta
function renderMonthlyGoal(currentTotalEntries) {
    const goalDisplay = document.getElementById('goal-display');
    const progressBar = document.getElementById('goal-progress-bar');
    const goalRemaining = document.getElementById('goal-remaining');
    
    if (goalDisplay) goalDisplay.textContent = formatBRL(globalMeta);

    if (progressBar) {
        if (globalMeta > 0) {
            let percentage = (currentTotalEntries / globalMeta) * 100;
            percentage = Math.min(percentage, 100);
            progressBar.style.width = `${percentage.toFixed(0)}%`;
            progressBar.textContent = `${percentage.toFixed(0)}%`;
            progressBar.style.backgroundColor = percentage >= 100 ? 'var(--cor-sucesso)' : 'var(--cor-destaque)';
        } else {
            progressBar.style.width = '0%';
            progressBar.textContent = '0%';
        }
    }

    if (goalRemaining) {
        const remaining = Math.max(0, globalMeta - currentTotalEntries);
        goalRemaining.textContent = formatBRL(remaining);
    }
}
function editMonthlyGoal() {
    const newValue = prompt('Definir a meta de entrada mensal (R$):', globalMeta.toFixed(2));
    if (newValue !== null) {
        const numValue = parseFloat(newValue);
        if (!isNaN(numValue) && numValue >= 0) {
            globalMeta = numValue;
            saveData();
            calculateSummary();
        } else {
            alert('Valor inválido. Digite um número.');
        }
    }
}

// -------------------- Inserção / Remoção de dados --------------------
// Função de submissão de Entradas
function handleEntrySubmit(e) {
  if (e) e.preventDefault();
  const form = document.getElementById('entry-form');
  if (!form) return;

  const newEntry = {
    id: Date.now(),
    date: document.getElementById('entry-date').value,
    platform: document.getElementById('entry-platform').value,
    description: document.getElementById('entry-description').value,
    value: parseFloat(document.getElementById('entry-value').value || '0'),
    km: parseFloat(document.getElementById('entry-km').value || '0'),
    hours: parseFloat(document.getElementById('entry-hours').value || '0'),
    gas: parseFloat(document.getElementById('entry-gas').value || '0'),
    otherCosts: parseFloat(document.getElementById('entry-other-costs').value || '0')
  };

  entries.push(newEntry);
  saveData();
  form.reset();
  // Reinicializa a data para a de hoje
  document.getElementById('entry-date').value = new Date().toISOString().split('T')[0];
  renderLogs();
  calculateSummary();
}

// Função de submissão de Despesas Variáveis
function handleExpenseSubmit(e) {
  if (e) e.preventDefault();
  const form = document.getElementById('expense-form');
  if (!form) return;

  const newExpense = {
    id: Date.now(),
    date: document.getElementById('expense-date').value,
    category: document.getElementById('expense-category').value,
    description: document.getElementById('expense-description').value,
    payment: document.getElementById('expense-payment').value,
    value: parseFloat(document.getElementById('expense-value').value || '0')
  };

  expenses.push(newExpense);
  saveData();
  form.reset();
  document.getElementById('expense-date').value = new Date().toISOString().split('T')[0];
  renderLogs();
  calculateSummary();
}

function removeLogItem(id, type) {
  if (type === 'fixed') {
      const choice = prompt('Tem certeza que deseja remover esta despesa fixa? Digite "Atual" para remover só deste mês ou "Todas" para remover o plano mestre (Atual e Restantes):', 'Atual').toLowerCase();
      if (choice === 'atual') {
          fixedExpenses = fixedExpenses.filter(i => i.id !== id);
      } else if (choice === 'todas') {
          const expense = fixedExpenses.find(i => i.id === id);
          if (expense && expense.masterId) {
              // Remove o plano mestre para evitar futuras projeções
              delete masterPlans[expense.masterId];
          }
          // Remove a despesa do mês atual
          fixedExpenses = fixedExpenses.filter(i => i.id !== id);
      } else {
          return;
      }
  } else if (type === 'entry') {
      if (!confirm('Tem certeza que deseja remover esta entrada?')) return;
      entries = entries.filter(i => i.id !== id);
  } else if (type === 'expense') {
      if (!confirm('Tem certeza que deseja remover esta despesa?')) return;
      expenses = expenses.filter(i => i.id !== id);
  } else if (type === 'investment') {
      if (!confirm('Tem certeza que deseja remover este investimento?')) return;
      investments = investments.filter(i => i.id !== id);
  } else if (type === 'pendency') {
      if (!confirm('Tem certeza que deseja remover esta pendência?')) return;
      pendencies = pendencies.filter(i => i.id !== id);
  }
  
  saveData();
  renderLogs();
  calculateSummary();
}

function toggleFixedExpensePaid(id) {
  const expense = fixedExpenses.find(e => e.id === id);
  if (expense) {
    expense.paid = !expense.paid;
    saveData();
    renderLogs();
    calculateSummary();
  }
}

// NOVO: Função de toggle para pendências
function togglePendencyPaid(id) {
    const pendency = pendencies.find(p => p.id === id);
    if (pendency) {
        pendency.paid = !pendency.paid;
        saveData();
        renderLogs();
        calculateSummary();
    }
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
  const masterId = Date.now();
  const dueDate = parseInt(document.getElementById('fixed-expense-due-date').value || '1'); // NOVO: Data de vencimento

  const newFixedExpenseMaster = {
    id: masterId,
    description: document.getElementById('fixed-expense-description').value,
    category: document.getElementById('fixed-expense-category').value,
    payment: document.getElementById('fixed-expense-payment').value,
    value: value,
    dueDate: dueDate, // NOVO
    recurrence: recurrence,
    paidInstallments: 0,
    totalInstallments: (recurrence === 'Parcelada' ? totalInstallments : 0),
    startMonthKey: currentMonthKey // NOVO: Marca o mês de criação
  };

  if (recurrence !== 'Unica') {
    masterPlans[masterId] = newFixedExpenseMaster;
  }

  const logItem = {
    ...newFixedExpenseMaster,
    id: Date.now() + Math.random(),
    masterId: masterId,
    isProjected: false,
    paid: false
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

// NOVO: Handler para Especificações do Cartão
function handleCardSpecsSubmit(e) {
    if (e) e.preventDefault();
    const form = document.getElementById('card-specs-form');
    if (!form) return;

    const cardId = document.getElementById('card-specs-id').value;
    const value = parseFloat(document.getElementById('card-specs-value').value) || 0;
    const totalInstallments = parseInt(document.getElementById('card-specs-installments').value || '1');
    const dueDate = parseInt(document.getElementById('card-specs-due-date').value || '1');

    if (!cardSpecs[cardId]) {
        cardSpecs[cardId] = { cardId, installments: [] };
    }

    const newInstallment = {
        id: Date.now(),
        description: document.getElementById('card-specs-description').value,
        value: value,
        totalInstallments: totalInstallments,
        dueDate: dueDate,
        startMonthKey: currentMonthKey
    };
    
    cardSpecs[cardId].installments.push(newInstallment);
    
    saveData();
    form.reset();
    renderCardSpecs();
    calculateSummary();
}

// NOVO: Handler para Investimentos
function handleInvestmentSubmit(e) {
    if (e) e.preventDefault();
    const form = document.getElementById('investment-form');
    if (!form) return;

    const newInvestment = {
        id: Date.now(),
        date: document.getElementById('investment-date').value,
        bank: document.getElementById('investment-bank').value,
        type: document.getElementById('investment-type').value,
        description: document.getElementById('investment-description').value,
        value: parseFloat(document.getElementById('investment-value').value) || 0
    };
    
    investments.push(newInvestment);
    saveData();
    form.reset();
    renderLogs(); // Renderiza Investimentos
    calculateSummary(); // Atualiza saldo em caixa
}

// NOVO: Handler para Pendências
function handlePendencySubmit(e) {
    if (e) e.preventDefault();
    const form = document.getElementById('pendency-form');
    if (!form) return;

    const newPendency = {
        id: Date.now(),
        date: document.getElementById('pendency-date').value,
        type: document.getElementById('pendency-type').value, // 'credit' ou 'debit'
        description: document.getElementById('pendency-description').value,
        value: parseFloat(document.getElementById('pendency-value').value) || 0,
        paid: false // Se já foi resolvido/pago
    };
    
    pendencies.push(newPendency);
    saveData();
    form.reset();
    document.getElementById('pendency-date').value = new Date().toISOString().split('T')[0];
    renderLogs(); // Renderiza Pendências
    calculateSummary(); // Atualiza saldo em caixa
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
        <td><button class="delete-btn" onclick="removeLogItem(${entry.id}, 'entry')">X</button></td>
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
        <td><button class="delete-btn" onclick="removeLogItem(${exp.id}, 'expense')">X</button></td>
      </tr>
    `).join('');
  }

  // Despesas fixas
  const fixedBody = document.getElementById('fixed-expenses-log-body');
  if (fixedBody) {
    fixedBody.innerHTML = fixedExpenses
      .sort((a, b) => {
        if (a.paid !== b.paid) {
          return a.paid ? 1 : -1; 
        }
        return (b.value || 0) - (a.value || 0);
      })
      .map(exp => {
      const displayDesc = exp.recurrence === 'Parcelada' ? `${exp.description}` : `${exp.description} (${exp.category})`;
      const valueClickable = `<span class="editable-value" onclick="editFixedExpenseValue(${exp.id}, ${exp.value})">${formatBRL(exp.value)}</span>`;
      const paidClass = exp.paid ? 'paid-row' : 'unpaid-row';
      const checked = exp.paid ? 'checked' : '';
      
      return `
        <tr class="${paidClass}">
          <td><input type="checkbox" ${checked} onclick="toggleFixedExpensePaid(${exp.id})"></td>
          <td>${String(exp.dueDate).padStart(2, '0')}</td> <td>${displayDesc}</td>
          <td>${valueClickable}</td>
          <td>${exp.payment}</td>
          <td><button class="delete-btn" onclick="removeLogItem(${exp.id}, 'fixed')">X</button></td>
        </tr>
      `;
    }).join('');
  }

  // NOVO: Renderiza Investimentos
  const investmentsBody = document.getElementById('investments-log-body');
  if (investmentsBody) {
    investmentsBody.innerHTML = investments.map(inv => `
      <tr>
        <td>${inv.date}</td>
        <td>${inv.bank}</td>
        <td>${inv.type}</td>
        <td>${formatBRL(inv.value)}</td>
        <td><button class="delete-btn" onclick="removeLogItem(${inv.id}, 'investment')">X</button></td>
      </tr>
    `).join('');
    // Se estiver na aba investimentos, simula o gráfico ao carregar
    if (document.getElementById('chart-investment')) {
        calculateInvestmentYield();
    }
  }

  // NOVO: Renderiza Pendências
  const pendenciesBody = document.getElementById('pendencies-log-body');
  if (pendenciesBody) {
    pendenciesBody.innerHTML = pendencies.map(p => {
        const typeClass = p.type === 'credit' ? 'pendency-credit' : 'pendency-debit';
        const checked = p.paid ? 'checked' : '';
        const paidText = p.paid ? 'Resolvido' : 'Pendente';
        const paidClass = p.paid ? 'paid-row' : 'unpaid-row';
        return `
            <tr class="${typeClass} ${paidClass}">
                <td><input type="checkbox" ${checked} onclick="togglePendencyPaid(${p.id})"></td>
                <td>${p.date}</td>
                <td>${p.type === 'credit' ? 'Me Devem' : 'Eu Devo'}</td>
                <td>${p.description}</td>
                <td>${formatBRL(p.value)}</td>
                <td>${paidText}</td>
                <td><button class="delete-btn" onclick="removeLogItem(${p.id}, 'pendency')">X</button></td>
            </tr>
        `;
    }).join('');
  }
}

// NOVO: Renderiza Specs do Cartão
function renderCardSpecs() {
    const container = document.getElementById('card-specs-log-body');
    if (!container) return;
    container.innerHTML = '';
    
    Object.values(cardSpecs).forEach(spec => {
        spec.installments.forEach(item => {
            container.innerHTML += `
                <tr>
                    <td>${spec.cardId}</td>
                    <td>${item.description}</td>
                    <td>${item.totalInstallments} x ${formatBRL(item.value / item.totalInstallments)}</td>
                    <td>${item.dueDate}</td>
                    <td><button class="delete-btn" onclick="removeCardInstallment(${item.id}, '${spec.cardId}')">X</button></td>
                </tr>
            `;
        });
    });
}
function removeCardInstallment(id, cardId) {
    if (!confirm('Tem certeza que deseja remover esta parcela e todas as futuras projeções?')) return;
    const spec = cardSpecs[cardId];
    if (spec) {
        spec.installments = spec.installments.filter(item => item.id !== id);
        // Se a lista ficar vazia, remove a spec
        if (spec.installments.length === 0) {
            delete cardSpecs[cardId];
        }
        saveData();
        renderCardSpecs();
        calculateSummary(); // Força recálculo das faturas
    }
}

// -------------------- Gráficos (Donut/Barra/Resumo) --------------------
function renderCharts() {
  const entradas = entries.reduce((sum, e) => sum + (e.value || 0), 0);
  // Total de despesas diluídas (fixas pagas + variáveis)
  const totalDespesasDiluidas = expenses.reduce((sum, e) => sum + (e.value || 0), 0) + 
                                fixedExpenses.filter(e => e.paid).reduce((sum, e) => sum + (e.value || 0), 0);

  // Gráfico de Rosca (Donut)
  const ctxDonut = document.getElementById('chart-donut');
  if (ctxDonut) {
    if (chartDonut) chartDonut.destroy();
    
    chartDonut = new Chart(ctxDonut, {
      type: 'doughnut',
      data: {
        labels: ['Entradas', 'Despesas (Diluídas)'],
        datasets: [{
          data: [entradas, totalDespesasDiluidas],
          backgroundColor: ['var(--cor-sucesso)', 'var(--cor-erro)'],
          hoverOffset: 4
        }]
      },
      options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
              legend: { position: 'bottom', labels: { color: 'var(--cor-texto)' } },
              tooltip: { callbacks: { label: function(context) { return context.label + ': ' + formatBRL(context.parsed); } } }
          }
      }
    });
  }

  // Gráfico de Barra por Categoria
  const categoryMap = {};
  const allExpenses = [...expenses, ...fixedExpenses.filter(e => e.paid)]; // Apenas fixas pagas
  allExpenses.forEach(e => {
    categoryMap[e.category] = (categoryMap[e.category] || 0) + (e.value || 0);
  });
  
  const categories = Object.keys(categoryMap);
  const dataValues = Object.values(categoryMap);

  const ctxBar = document.getElementById('chart-bar');
  if (ctxBar) {
    if (chartBar) chartBar.destroy();
    
    chartBar = new Chart(ctxBar, {
      type: 'bar',
      data: {
        labels: categories,
        datasets: [{
          label: 'Total Gasto',
          data: dataValues,
          backgroundColor: 'var(--cor-destaque)',
          borderColor: 'var(--cor-destaque)',
          borderWidth: 1
        }]
      },
      options: {
          responsive: true,
          maintainAspectRatio: false,
          scales: {
              y: { 
                  beginAtZero: true, 
                  ticks: { callback: function(value) { return formatBRL(value); }, color: 'var(--cor-texto)' },
                  grid: { color: '#333' }
              },
              x: {
                  ticks: { color: 'var(--cor-texto)' },
                  grid: { color: '#333' }
              }
          },
          plugins: {
              legend: { display: false },
              tooltip: { callbacks: { label: function(context) { return context.dataset.label + ': ' + formatBRL(context.parsed.y); } } }
          }
      }
    });
  }
}

// Tabela de Resumo Mensal
function renderSummaryTable() {
    const container = document.getElementById('monthly-summary-table');
    if (!container) return;

    const totalInvestments = investments.reduce((sum, inv) => sum + (inv.value || 0), 0);
    const totalFaturas = CARTAO_IDS.reduce((sum, id) => sum + (cardMonthlyData.initialBalances?.[id] || 0) + (cardMonthlyData.monthlyExpenses?.[id] || 0), 0);
    const totalDebits = pendencies.filter(p => p.type === 'debit' && p.paid).reduce((sum, p) => sum + (p.value || 0), 0);
    const totalCredits = pendencies.filter(p => p.type === 'credit' && p.paid).reduce((sum, p) => sum + (p.value || 0), 0);
    const totalPending = pendencies.filter(p => !p.paid).reduce((sum, p) => sum + (p.value || 0), 0);

    const tableHTML = `
        <table class="log-table">
            <thead>
                <tr><th>Item</th><th>Valor</th><th>Observação</th></tr>
            </thead>
            <tbody>
                <tr><td>Saldo Inicial em Caixa (PIX/Dinheiro)</td><td style="color:var(--cor-primaria)">${formatBRL(cardMonthlyData.startingCash || 0)}</td><td>Do fechamento do mês anterior.</td></tr>
                <tr><td>Total de Faturas de Cartão</td><td style="color:var(--cor-erro)">${formatBRL(totalFaturas)}</td><td>Soma de todos os cartões (Inicial + Gastos/Projeções).</td></tr>
                <tr><td>Total de Investimentos</td><td style="color:var(--cor-erro)">${formatBRL(totalInvestments)}</td><td>Valor que saiu do Saldo em Caixa.</td></tr>
                <tr><td>Pendências Pagas (Eu Devia)</td><td style="color:var(--cor-erro)">${formatBRL(totalDebits)}</td><td>Valor que saiu do Saldo em Caixa.</td></tr>
                <tr><td>Pendências Recebidas (Me Deviam)</td><td style="color:var(--cor-sucesso)">${formatBRL(totalCredits)}</td><td>Valor que entrou no Saldo em Caixa.</td></tr>
                <tr><td>Pendências em Aberto (a resolver)</td><td style="color:var(--cor-destaque)">${formatBRL(totalPending)}</td><td>Ainda não impacta o Saldo Final.</td></tr>
                <tr><td style="font-weight:bold;">SALDO FINAL EM CAIXA</td><td style="font-weight:bold; color:var(--cor-primaria)">${formatBRL(cardMonthlyData.closingCash || 0)}</td><td>Saldo final (PIX/Dinheiro) para o próximo mês.</td></tr>
            </tbody>
        </table>
    `;
    container.innerHTML = tableHTML;
}

// -------------------- Mês / navegação --------------------
function updateMonthDisplay() {
  const year = currentMonthDate.getFullYear();
  const month = currentMonthDate.getMonth();
  const el = document.getElementById('current-month-display');
  if (el) el.textContent = `${MESES_PT[month]} ${year}`;
  currentMonthKey = formatMonthKey(currentMonthDate);
}

// Corrigido para só avançar a parcela se 'paid' for true
async function updateMasterPlansForPreviousMonth(prevMonthKey) {
  const prevFixedRef = db.ref(`${FIREBASE_PATH}${prevMonthKey}/fixedExpenses`);
  const prevFixedSnapshot = await prevFixedRef.once('value');
  const prevMonthData = prevFixedSnapshot.val() || {};
  
  const masterPlansRef = getMasterRef('plans');
  const masterPlansSnapshot = await masterPlansRef.once('value');
  let masterPlansToUpdate = masterPlansSnapshot.val() || {};

  Object.values(prevMonthData).forEach(expense => {
    if (expense.recurrence === 'Parcelada' && expense.masterId && expense.installment) {
      const masterPlan = masterPlansToUpdate[expense.masterId];
      // ATENÇÃO: Apenas se a despesa foi paga no mês anterior (expense.paid)
      if (masterPlan && masterPlan.paidInstallments < expense.installment && expense.paid) {
        masterPlan.paidInstallments = expense.installment;
      }
    }
  });

  masterPlansRef.set(masterPlansToUpdate);
  masterPlans = masterPlansToUpdate;
}

async function changeMonth(delta) {
  // Ação ao sair do mês
  await updateMasterPlansForPreviousMonth(currentMonthKey);

  currentMonthDate.setMonth(currentMonthDate.getMonth() + delta);
  updateMonthDisplay();
  
  await loadData();
  
  projectExpensesForMonth();
  renderLogs();
  // Se a aba for Cartões Specs, forçar renderização
  if (document.getElementById('card-specs-log-body')) renderCardSpecs();
  calculateSummary();
}

// -------------------- Gráfico de Investimentos (COMPLETO) --------------------

// Função para simular e renderizar o gráfico
function calculateInvestmentYield() {
    const cdiRateInput = document.getElementById('cdi-rate');
    if (!cdiRateInput) return;

    const cdiFactor = (parseFloat(cdiRateInput.value) || 100) / 100;
    
    // Total investido é a soma de todos os investimentos
    const totalInvested = investments.reduce((sum, inv) => sum + (inv.value || 0), 0);
    
    if (totalInvested === 0) {
        // Renderiza um gráfico vazio ou com aviso se não houver investimento
        setupInvestmentChart([], [0], "Adicione investimentos para simular.");
        return;
    }
    
    // Taxa de juros anual base (Selic/CDI, usando 10.75% a.a. como exemplo razoável)
    const annualRateBase = 0.1075; 
    const monthlyRate = (annualRateBase * cdiFactor) / 12; // Taxa mensal ajustada pelo fator do cliente

    let projection = [totalInvested];
    let currentValue = totalInvested;
    const labels = ["Mês 0 (Início)"];

    for (let i = 1; i <= 12; i++) {
        currentValue = currentValue * (1 + monthlyRate);
        projection.push(currentValue);
        labels.push(`Mês ${i}`);
    }

    const title = `Projeção de Rendimento (CDI x ${cdiFactor.toFixed(2)})`;
    setupInvestmentChart(labels, projection, title);
}

// Configuração do gráfico de investimento
function setupInvestmentChart(labels, data, title) {
    const ctx = document.getElementById('chart-investment');
    if (!ctx) return;
    
    if (chartInvestment) {
        chartInvestment.destroy();
    }

    chartInvestment = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: title,
                data: data,
                borderColor: 'var(--cor-destaque)',
                backgroundColor: 'rgba(255, 152, 0, 0.2)',
                borderWidth: 2,
                tension: 0.3,
                fill: true
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        callback: function(value) { return formatBRL(value); },
                        color: 'var(--cor-texto)'
                    },
                    grid: { color: '#333' }
                },
                x: {
                    ticks: { color: 'var(--cor-texto)' },
                    grid: { color: '#333' }
                }
            },
            plugins: {
                legend: { labels: { color: 'var(--cor-texto)' } },
                tooltip: { callbacks: { label: function(context) { return context.dataset.label + ': ' + formatBRL(context.parsed.y); } } }
            }
        }
    });
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

async function initApp() {
  updateMonthDisplay();

  await loadData();

  projectExpensesForMonth();

  calculateSummary();
  renderLogs();

  // NOVO: Renderiza Specs do Cartão se estiver na página
  if (document.getElementById('card-specs-log-body')) renderCardSpecs();

  // Preenchimento de Selects
  populateSelect('entry-platform', LISTAS.plataformas);
  populateSelect('expense-category', LISTAS.categorias);
  populateSelect('expense-payment', LISTAS.pagamentos);
  populateSelect('fixed-expense-category', LISTAS.categorias);
  populateSelect('fixed-expense-payment', LISTAS.pagamentos);
  populateSelect('card-specs-id', CARTAO_IDS.map(id => ({ value: id, label: id }))); // NOVO: Select de Cartões
  populateSelect('investment-bank', LISTAS.bancos); // NOVO: Select de Bancos

  // Setup de Datas
  const today = new Date().toISOString().split('T')[0];
  const ed = document.getElementById('entry-date'); if (ed) ed.value = today;
  const exd = document.getElementById('expense-date'); if (exd) exd.value = today;
  const invd = document.getElementById('investment-date'); if (invd) invd.value = today;
  const pend = document.getElementById('pendency-date'); if (pend) pend.value = today;

  // Listeners de Formulários
  const entryForm = document.getElementById('entry-form'); if (entryForm) entryForm.addEventListener('submit', handleEntrySubmit);
  const expenseForm = document.getElementById('expense-form'); if (expenseForm) expenseForm.addEventListener('submit', handleExpenseSubmit);
  const fixedForm = document.getElementById('fixed-expense-form'); if (fixedForm) fixedForm.addEventListener('submit', handleFixedExpenseSubmit);
  const cardSpecsForm = document.getElementById('card-specs-form'); if (cardSpecsForm) cardSpecsForm.addEventListener('submit', handleCardSpecsSubmit);
  const investmentForm = document.getElementById('investment-form'); if (investmentForm) investmentForm.addEventListener('submit', handleInvestmentSubmit);
  const pendencyForm = document.getElementById('pendency-form'); if (pendencyForm) pendencyForm.addEventListener('submit', handlePendencySubmit);

  // Expor funções para onclick inline
  window.changeMonth = changeMonth;
  window.saveCardInitialBalances = saveCardInitialBalances;
  window.removeLogItem = removeLogItem;
  window.editFixedExpenseValue = editFixedExpenseValue;
  window.toggleRecurrenceForm = toggleRecurrenceForm;
  window.toggleFixedExpensePaid = toggleFixedExpensePaid;
  window.removeCardInstallment = removeCardInstallment; 
  window.togglePendencyPaid = togglePendencyPaid; 
  window.editMonthlyGoal = editMonthlyGoal; 
  window.calculateInvestmentYield = calculateInvestmentYield; // NOVO: Exportar função de gráfico
}

document.addEventListener('DOMContentLoaded', initApp);