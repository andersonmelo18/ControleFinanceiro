import { 
    collection, addDoc, onSnapshot, query, where, doc, deleteDoc, updateDoc, 
    getDocs, getDoc, runTransaction, setDoc 
} from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// -------------------- Config / Constantes --------------------
const CARTAO_IDS = ['💳 Cartão 1', '💳 Cartão 2', '💳 Cartão 3'];
const DINHEIRO_PIX_IDS = ['💵 Dinheiro', '📲 PIX'];
const MESES_PT = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];

// Coleções
const COLLECTIONS = {
    ENTRIES: 'entries',
    EXPENSES: 'expenses',
    FIXED: 'fixed',
    CARDS: 'cards_initial_balance'
};

// Listas usadas nos selects
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
    { value: 'Manutenção Veículo', label: '🔧 Manutenção Veículo' },
    { value: 'Pessoal', label: '🧑‍🤝‍🧑 Pessoal' },
    { value: 'Moradia', label: '🏠 Moradia' },
    { value: 'Outros', label: '💸 Outros' }
  ]
};

// Variáveis de Estado (Para o Mês Atual)
let currentMonth = new Date().getMonth();
let currentYear = new Date().getFullYear();

// Cache de Dados
let allEntries = [];
let allExpenses = [];
let allFixed = [];
let cardBalances = {};


// -------------------- Funções de Apoio --------------------

/**
 * Constrói o caminho completo da coleção no Firestore.
 * /artifacts/{appId}/users/{userId}/{collectionName}
 */
function getCollectionPath(collectionName) {
    if (!window.userId || !window.__app_id) {
        console.error("IDs de App/Usuário não definidos.");
        return null;
    }
    return `artifacts/${window.__app_id}/users/${window.userId}/${collectionName}`;
}

/**
 * Formata um número para o formato de moeda Real (R$).
 */
function formatCurrency(value) {
    return (value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/**
 * Retorna o mês/ano atual como string para consulta.
 */
function getCurrentMonthKey() {
    return `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`;
}

/**
 * Retorna uma string legível para exibição.
 */
function getCurrentMonthDisplay() {
    return `${MESES_PT[currentMonth]} de ${currentYear}`;
}


// -------------------- Inicialização e Listeners (DOM) --------------------

/**
 * Inicializa a aplicação (Chamado após autenticação do Firebase)
 */
window.initApp = function() {
    console.log("Iniciando a lógica principal da aplicação...");

    // 1. Carregar options dos Selects em todas as páginas
    loadOptions();

    // 2. Configura os Listeners do Firestore
    setupFirestoreListeners();

    // 3. Configura Listeners de Forms/Botões (AGORA SEM ONCLICK INLINE)
    setupEventListeners();

    // 4. Exibe o mês atual no seletor (se existir)
    if (document.getElementById('current-month-display')) {
        document.getElementById('current-month-display').textContent = getCurrentMonthDisplay();
    }
    if (document.getElementById('current-month-log-display')) {
        document.getElementById('current-month-log-display').textContent = getCurrentMonthDisplay();
    }
};

/**
 * Adiciona listeners de eventos aos formulários e botões.
 */
function setupEventListeners() {
    const entryForm = document.getElementById('entry-form');
    if (entryForm) entryForm.addEventListener('submit', handleEntrySubmit);

    const expenseForm = document.getElementById('expense-form');
    if (expenseForm) expenseForm.addEventListener('submit', handleExpenseSubmit);

    const fixedForm = document.getElementById('fixed-expense-form');
    if (fixedForm) fixedForm.addEventListener('submit', handleFixedExpenseSubmit);
    
    // NOVO: Adiciona listeners de navegação do mês
    const prevMonthBtn = document.getElementById('prev-month-btn');
    if (prevMonthBtn) prevMonthBtn.addEventListener('click', () => changeMonth(-1));

    const nextMonthBtn = document.getElementById('next-month-btn');
    if (nextMonthBtn) nextMonthBtn.addEventListener('click', () => changeMonth(1));

    // NOVO: Adiciona listeners de exportação
    const exportCsvBtn = document.getElementById('export-csv-btn');
    if (exportCsvBtn) exportCsvBtn.addEventListener('click', exportMonthCSV);
    
    const exportPdfBtn = document.getElementById('export-pdf-btn');
    if (exportPdfBtn) exportPdfBtn.addEventListener('click', exportMonthPDF);

    // NOVO: Adiciona listener para salvar cartões
    const saveCardBtn = document.getElementById('save-card-btn');
    if (saveCardBtn) saveCardBtn.addEventListener('click', saveCardInitialBalances);

    // NOVO: Adiciona listener para toggle de recorrência
    const fixedRecurrence = document.getElementById('fixed-expense-recurrence');
    if (fixedRecurrence) fixedRecurrence.addEventListener('change', (e) => toggleRecurrenceForm(e.target.value));

    // Expor funções globais para uso em botões criados dinamicamente no log (remove, edit)
    window.removeLogItem = removeLogItem;
    window.editFixedExpenseValue = editFixedExpenseValue;
    window.toggleRecurrenceForm = toggleRecurrenceForm;
    window.showModal = showModal; 
}


// -------------------- Funções de Banco de Dados (Firestore) --------------------

/**
 * Configura os listeners de real-time do Firestore para todas as coleções.
 */
function setupFirestoreListeners() {
    if (!window.db || !window.userId) {
        console.warn("Firestore ou userId não estão prontos. Adios.");
        return;
    }

    // Listener para Entradas (Real-time)
    const qEntries = collection(window.db, getCollectionPath(COLLECTIONS.ENTRIES));
    onSnapshot(qEntries, (snapshot) => {
        allEntries = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        if (document.getElementById('entries-log-body')) renderEntries();
        calculateSummary();
    }, error => console.error("Erro ao obter Entradas:", error));

    // Listener para Despesas Variáveis (Real-time)
    const qExpenses = collection(window.db, getCollectionPath(COLLECTIONS.EXPENSES));
    onSnapshot(qExpenses, (snapshot) => {
        allExpenses = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        if (document.getElementById('expenses-log-body')) renderExpenses();
        calculateSummary();
    }, error => console.error("Erro ao obter Despesas Variáveis:", error));

    // Listener para Despesas Fixas (Real-time)
    const qFixed = collection(window.db, getCollectionPath(COLLECTIONS.FIXED));
    onSnapshot(qFixed, (snapshot) => {
        allFixed = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        if (document.getElementById('fixed-expenses-log-body')) renderFixedExpenses();
        calculateSummary();
    }, error => console.error("Erro ao obter Despesas Fixas:", error));

    // Listener para Saldo Inicial de Cartões (Real-time)
    // Usamos um único documento para todos os saldos iniciais dos cartões
    const cardDocRef = doc(window.db, getCollectionPath(COLLECTIONS.CARDS), 'balances');
    onSnapshot(cardDocRef, (docSnap) => {
        cardBalances = docSnap.exists() ? docSnap.data() : {};
        if (document.getElementById('card-list')) renderCardControl();
        calculateSummary();
    }, error => console.error("Erro ao obter Saldo Inicial de Cartões:", error));
}


// -------------------- Manipuladores de Forms --------------------

/**
 * Envia uma nova entrada para o Firestore.
 */
async function handleEntrySubmit(e) {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target).entries());
    const entry = {
        date: data['entry-date'],
        platform: data['entry-platform'],
        value: parseFloat(data['entry-value']),
        km: parseFloat(data['entry-km']),
        hours: parseFloat(data['entry-hours']),
        gas: parseFloat(data['entry-gas']),
        otherCosts: parseFloat(data['entry-other-costs']),
        monthKey: data['entry-date'].substring(0, 7)
    };

    try {
        await addDoc(collection(window.db, getCollectionPath(COLLECTIONS.ENTRIES)), entry);
        e.target.reset();
        document.getElementById('entry-date').valueAsDate = new Date();
    } catch (e) {
        console.error("Erro ao adicionar entrada: ", e);
        showModal('Erro ao salvar entrada. Verifique sua conexão e tente novamente.');
    }
}

/**
 * Envia uma nova despesa variável para o Firestore.
 */
async function handleExpenseSubmit(e) {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target).entries());
    const expense = {
        date: data['expense-date'],
        category: data['expense-category'],
        description: data['expense-description'],
        payment: data['expense-payment'],
        value: parseFloat(data['expense-value']),
        monthKey: data['expense-date'].substring(0, 7)
    };

    try {
        await addDoc(collection(window.db, getCollectionPath(COLLECTIONS.EXPENSES)), expense);
        e.target.reset();
        document.getElementById('expense-date').valueAsDate = new Date();
    } catch (e) {
        console.error("Erro ao adicionar despesa: ", e);
        showModal('Erro ao salvar despesa. Verifique sua conexão e tente novamente.');
    }
}

/**
 * Envia uma nova despesa fixa/dívida para o Firestore.
 */
async function handleFixedExpenseSubmit(e) {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target).entries());
    
    let installments = 1;
    if (data['fixed-expense-recurrence'] === 'Parcelada') {
        installments = parseInt(data['fixed-expense-total-installments']);
        if (installments < 2) {
             showModal("Para despesas 'Parceladas', o total de parcelas deve ser 2 ou mais.");
             return;
        }
    }
    
    // Data de início é o dia 1 do mês/ano atual do painel
    const startDate = new Date(currentYear, currentMonth, 1).toISOString().substring(0, 10);

    const baseFixed = {
        startDate: startDate, // Mês de início
        category: data['fixed-expense-category'],
        description: data['fixed-expense-description'],
        payment: data['fixed-expense-payment'],
        value: parseFloat(data['fixed-expense-value']),
        recurrence: data['fixed-expense-recurrence'],
        installments: installments,
        totalPaid: 0,
        monthKey: getCurrentMonthKey() // Mês de registro
    };
    
    try {
        await addDoc(collection(window.db, getCollectionPath(COLLECTIONS.FIXED)), baseFixed);
        e.target.reset();
        toggleRecurrenceForm('Unica');
    } catch (e) {
        console.error("Erro ao adicionar despesa fixa: ", e);
        showModal('Erro ao salvar despesa fixa. Verifique sua conexão e tente novamente.');
    }
}

/**
 * Remove um item do log (Entrada, Despesa Variável ou Fixa).
 */
async function removeLogItem(type, id) {
    if (!confirm(`Tem certeza que deseja remover este registro (${type})?`)) return;
    try {
        await deleteDoc(doc(window.db, getCollectionPath(COLLECTIONS[type]), id));
    } catch (e) {
        console.error(`Erro ao remover ${type}: `, e);
        showModal('Erro ao remover registro. Tente novamente.');
    }
}

/**
 * Permite editar o valor de uma parcela/despesa fixa já registrada.
 */
async function editFixedExpenseValue(id, currentDesc, currentValue) {
    const newValueStr = prompt(`Editando: ${currentDesc}\nValor Atual: ${formatCurrency(currentValue)}\nDigite o novo valor:`, currentValue.toFixed(2));
    if (newValueStr === null) return; // Cancelado
    
    const newValue = parseFloat(newValueStr.replace(',', '.'));
    if (isNaN(newValue) || newValue <= 0) {
        showModal("Valor inválido.");
        return;
    }

    try {
        const fixedRef = doc(window.db, getCollectionPath(COLLECTIONS.FIXED), id);
        await updateDoc(fixedRef, { value: newValue });
    } catch (e) {
        console.error("Erro ao editar despesa fixa:", e);
        showModal('Erro ao editar despesa fixa. Tente novamente.');
    }
}

// -------------------- Funções de Renderização --------------------

/**
 * Preenche os campos <select> com as opções da lista.
 */
function loadOptions() {
    const selectors = {
        'entry-platform': LISTAS.plataformas,
        'expense-category': LISTAS.categorias,
        'fixed-expense-category': LISTAS.categorias,
        'expense-payment': LISTAS.pagamentos,
        'fixed-expense-payment': LISTAS.pagamentos
    };

    for (const id in selectors) {
        const select = document.getElementById(id);
        if (select) {
            // Limpa as opções existentes
            select.innerHTML = ''; 
            // Adiciona a opção "Selecione..." para garantir validação
            const defaultOption = document.createElement('option');
            defaultOption.value = "";
            defaultOption.textContent = "Selecione...";
            defaultOption.disabled = true;
            defaultOption.selected = true;
            select.appendChild(defaultOption);
            
            // Adiciona as opções da lista
            selectors[id].forEach(opt => {
                 const option = document.createElement('option');
                 option.value = opt.value;
                 option.textContent = opt.label;
                 select.appendChild(option);
            });
        }
    }
    
    // Set default date to today
    const today = new Date().toISOString().split('T')[0];
    if (document.getElementById('entry-date')) document.getElementById('entry-date').value = today;
    if (document.getElementById('expense-date')) document.getElementById('expense-date').value = today;
}

/**
 * Renderiza a lista de Entradas do mês atual.
 */
function renderEntries() {
    const tbody = document.getElementById('entries-log-body');
    if (!tbody) return;

    const monthKey = getCurrentMonthKey();
    const filtered = allEntries
        .filter(e => e.monthKey === monthKey)
        .sort((a, b) => new Date(b.date) - new Date(a.date));

    tbody.innerHTML = filtered.map(e => `
        <tr>
            <td>${e.date}</td>
            <td>${e.platform}</td>
            <td>${formatCurrency(e.value)}</td>
            <td>${e.km}</td>
            <td><button class="delete-btn" onclick="removeLogItem('ENTRIES', '${e.id}')">Excluir</button></td>
        </tr>
    `).join('');
}

/**
 * Renderiza a lista de Despesas Variáveis do mês atual.
 */
function renderExpenses() {
    const tbody = document.getElementById('expenses-log-body');
    if (!tbody) return;

    const monthKey = getCurrentMonthKey();
    const filtered = allExpenses
        .filter(e => e.monthKey === monthKey)
        .sort((a, b) => new Date(b.date) - new Date(a.date));

    tbody.innerHTML = filtered.map(e => `
        <tr>
            <td>${e.date}</td>
            <td>${e.category}</td>
            <td>${formatCurrency(e.value)}</td>
            <td>${e.payment}</td>
            <td><button class="delete-btn" onclick="removeLogItem('EXPENSES', '${e.id}')">Excluir</button></td>
        </tr>
    `).join('');
}

/**
 * Renderiza a lista de Despesas Fixas do mês atual (projetando parcelas futuras).
 */
function renderFixedExpenses() {
    const tbody = document.getElementById('fixed-expenses-log-body');
    if (!tbody) return;

    // Obtém as despesas fixas relevantes para o mês atual
    const monthFixedExpenses = getFixedExpensesForMonth(currentYear, currentMonth, allFixed);

    // Renderização
    tbody.innerHTML = monthFixedExpenses.map(item => {
        const desc = item.installments > 1 
            ? `${item.description} (${item.currentInstallment}/${item.installments})` 
            : item.description;
        
        // Escapa aspas simples na descrição para evitar quebrar o onclick
        const escapedDesc = item.description.replace(/'/g, "\\'");

        const actionButton = item.payment.startsWith('💳') ? '' : // Não edita cartões, pois eles são detalhados
            `<button class="edit-btn" onclick="editFixedExpenseValue('${item.id}', '${escapedDesc}', ${item.value})">Editar</button>`;

        return `
            <tr>
                <td>${desc}</td>
                <td>${formatCurrency(item.value)}</td>
                <td>${item.payment}</td>
                <td>${actionButton}<button class="delete-btn" onclick="removeLogItem('FIXED', '${item.id}')">Excluir Base</button></td>
            </tr>
        `;
    }).join('');
}

/**
 * Renderiza a interface de controle de Saldo Inicial de Cartões.
 */
function renderCardControl() {
    const cardList = document.getElementById('card-list');
    if (!cardList) return;

    cardList.innerHTML = CARTAO_IDS.map(cardId => `
        <div class="card-item">
            <span>${cardId}</span>
            <input 
                type="number" 
                id="initial-balance-${cardId.replace(/[^a-zA-Z0-9]/g, '')}" 
                value="${(cardBalances[cardId] || 0).toFixed(2)}"
                step="0.01" 
                style="width: 120px; text-align: right;"
            >
        </div>
    `).join('');
}


// -------------------- Funções de Cálculo --------------------

/**
 * Retorna as despesas fixas que se aplicam ao mês/ano fornecido,
 * projetando parcelas e recorrências.
 */
function getFixedExpensesForMonth(year, monthIndex, fixedData) {
    const targetDate = new Date(year, monthIndex, 1);
    
    return fixedData.reduce((acc, fixed) => {
        // Mês/Ano que a despesa foi registrada
        const startDateParts = fixed.startDate.split('-');
        const startYear = parseInt(startDateParts[0]);
        const startMonth = parseInt(startDateParts[1]) - 1; 

        // Diferença de meses entre o mês de registro e o mês alvo
        const monthDiff = (year - startYear) * 12 + (monthIndex - startMonth);

        // 1. Despesas Únicas: Só aplicam no mês de registro (monthDiff = 0)
        if (fixed.recurrence === 'Unica') {
            if (monthDiff === 0) {
                acc.push({ ...fixed, currentInstallment: 1 });
            }
        }
        // 2. Despesas Mensais: Aplicam para o mês de registro e todos os meses futuros
        else if (fixed.recurrence === 'Mensal') {
            if (monthDiff >= 0) {
                acc.push({ ...fixed, currentInstallment: 1 });
            }
        }
        // 3. Despesas Parceladas: Aplicam para o número de parcelas
        else if (fixed.recurrence === 'Parcelada') {
            const currentInstallment = monthDiff + 1; // 0 diff = parcela 1

            if (currentInstallment >= 1 && currentInstallment <= fixed.installments) {
                acc.push({ ...fixed, currentInstallment: currentInstallment });
            }
        }
        return acc;
    }, []);
}

/**
 * Calcula e atualiza todos os dados do painel e gráficos.
 */
function calculateSummary() {
    if (!window.db || !window.userId) return; // Garante que o Firebase está pronto

    const monthKey = getCurrentMonthKey();

    // 1. Filtrar dados do Mês Atual
    const currentEntries = allEntries.filter(e => e.monthKey === monthKey);
    const currentExpenses = allExpenses.filter(e => e.monthKey === monthKey);
    const currentFixed = getFixedExpensesForMonth(currentYear, currentMonth, allFixed);

    // 2. CÁLCULO DE TOTAIS

    // Entradas
    const totalEntries = currentEntries.reduce((sum, e) => sum + e.value, 0);
    const totalKm = currentEntries.reduce((sum, e) => sum + e.km, 0);
    const totalHours = currentEntries.reduce((sum, e) => sum + e.hours, 0);
    const totalGas = currentEntries.reduce((sum, e) => sum + e.gas, 0);
    const totalOtherCosts = currentEntries.reduce((sum, e) => sum + e.otherCosts, 0);

    // Despesas Variáveis
    const totalVarExpenses = currentExpenses.reduce((sum, e) => sum + e.value, 0);

    // Despesas Fixas (Parcelas/Recorrentes)
    const totalFixedExpenses = currentFixed.reduce((sum, e) => sum + e.value, 0);

    // Total em Cartões (Inicial + Variável + Fixa via Cartão)
    const totalCardPayments = currentExpenses.filter(e => e.payment.startsWith('💳'))
        .reduce((sum, e) => sum + e.value, 0);
    const totalCardFixed = currentFixed.filter(e => e.payment.startsWith('💳'))
        .reduce((sum, e) => sum + e.value, 0);

    // Total de Custos em Dinheiro/PIX (para Saldo em Caixa)
    const totalMoneyPixExpenses = totalGas + totalOtherCosts + 
        currentExpenses.filter(e => DINHEIRO_PIX_IDS.includes(e.payment))
        .reduce((sum, e) => sum + e.value, 0);
    const totalMoneyPixFixed = currentFixed.filter(e => DINHEIRO_PIX_IDS.includes(e.payment))
        .reduce((sum, e) => sum + e.value, 0);
    const totalMoneyPixCosts = totalMoneyPixExpenses + totalMoneyPixFixed;

    // Saldo Inicial dos Cartões
    let totalCardInitialBalance = 0;
    for (const id in cardBalances) {
        if (CARTAO_IDS.includes(id)) {
            totalCardInitialBalance += cardBalances[id] || 0;
        }
    }
    
    // Total Faturas Mês
    const totalFaturasMes = totalCardInitialBalance + totalCardPayments + totalCardFixed;


    // 3. CÁLCULOS FINAIS

    const totalAllExpenses = totalVarExpenses + totalFixedExpenses + totalGas + totalOtherCosts;
    const lucroLiquido = totalEntries - totalAllExpenses;
    
    // Saldo em Caixa = Entradas - Custos em Dinheiro/PIX (Gasolina, Outros Custos, Despesas Dinheiro/PIX)
    const totalMoneyPixRevenue = currentEntries.reduce((sum, e) => sum + e.value, 0); 
    const saldoCaixa = totalMoneyPixRevenue - totalMoneyPixCosts;


    // 4. ATUALIZAR DOM (Painel)
    if (document.getElementById('total-entradas')) {
        document.getElementById('total-entradas').querySelector('.value').textContent = formatCurrency(totalEntries);
        document.getElementById('total-despesas').querySelector('.value').textContent = formatCurrency(totalAllExpenses);
        document.getElementById('lucro-liquido').querySelector('.value').textContent = formatCurrency(lucroLiquido);
        document.getElementById('total-km').textContent = `${totalKm.toFixed(1)} km`;
        document.getElementById('total-hours').textContent = `${totalHours.toFixed(1)} h`;
        
        // Saldo em Caixa
        document.getElementById('saldo-caixa').querySelector('.value').textContent = formatCurrency(saldoCaixa);
        document.getElementById('saldo-caixa').querySelector('.small').textContent = 
            `Total de Entradas: ${formatCurrency(totalEntries)}. Custos em Dinheiro/PIX: ${formatCurrency(totalMoneyPixCosts)}`;

        document.getElementById('var-exp-value').textContent = formatCurrency(totalVarExpenses);
        document.getElementById('fix-exp-value').textContent = formatCurrency(totalFixedExpenses + totalGas + totalOtherCosts);
    }
    
    // Atualiza Cartões (se na página de cartões)
    if (document.getElementById('total-faturas-display')) {
        document.getElementById('total-faturas-display').textContent = formatCurrency(totalFaturasMes);
    }


    // 5. ATUALIZAR GRÁFICOS
    updateCharts(currentExpenses, currentFixed, totalEntries, totalAllExpenses);
}

// -------------------- Funções de Gráficos (Chart.js) --------------------

let chartDonut, chartBar;

function updateCharts(expensesVar, expensesFixed, totalEntries, totalExpenses) {
    const ctxDonut = document.getElementById('chart-donut');
    if (ctxDonut) {
        const dataDonut = {
            labels: ['Entradas (Receitas)', 'Despesas Totais'],
            datasets: [{
                data: [totalEntries, totalExpenses],
                backgroundColor: [
                    'var(--cor-sucesso)',
                    'var(--cor-erro)'
                ],
                hoverOffset: 4
            }]
        };

        if (chartDonut) chartDonut.destroy();
        chartDonut = new Chart(ctxDonut, {
            type: 'doughnut',
            data: dataDonut,
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'top', labels: { color: 'var(--cor-texto)' } },
                    title: { display: false }
                }
            }
        });
    }

    const ctxBar = document.getElementById('chart-bar');
    if (ctxBar) {
        const allExpenses = [...expensesVar, ...expensesFixed];
        const categoryTotals = allExpenses.reduce((acc, exp) => {
            const cat = exp.category;
            acc[cat] = (acc[cat] || 0) + exp.value;
            return acc;
        }, {});

        const labels = Object.keys(categoryTotals);
        const data = Object.values(categoryTotals);

        const dataBar = {
            labels: labels,
            datasets: [{
                label: 'Total Gasto',
                data: data,
                backgroundColor: 'var(--cor-primaria)',
                borderColor: 'var(--cor-primaria)',
                borderWidth: 1
            }]
        };

        if (chartBar) chartBar.destroy();
        chartBar = new Chart(ctxBar, {
            type: 'bar',
            data: dataBar,
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: { color: 'var(--cor-texto)' },
                        grid: { color: '#333' }
                    },
                    x: {
                        ticks: { color: 'var(--cor-texto)' },
                        grid: { display: false }
                    }
                },
                plugins: {
                    legend: { display: false },
                    title: { display: false }
                }
            }
        });
    }
}


// -------------------- Funções de Navegação e Exportação --------------------

/**
 * Altera o mês atual e recalcula o resumo.
 */
function changeMonth(delta) {
    const newDate = new Date(currentYear, currentMonth + delta, 1);
    currentMonth = newDate.getMonth();
    currentYear = newDate.getFullYear();
    
    if (document.getElementById('current-month-display')) {
        document.getElementById('current-month-display').textContent = getCurrentMonthDisplay();
    }
    if (document.getElementById('current-month-log-display')) {
        document.getElementById('current-month-log-display').textContent = getCurrentMonthDisplay();
    }

    // O recalculo é acionado pelos listeners do Firestore, mas chamamos para garantir
    calculateSummary();
    if (document.getElementById('fixed-expenses-log-body')) renderFixedExpenses();
}

/**
 * Alterna os campos do formulário de despesa fixa.
 */
function toggleRecurrenceForm(value) {
    const parcelasGroup = document.getElementById('parcelas-group');
    const totalInstallmentsInput = document.getElementById('fixed-expense-total-installments');
    if (parcelasGroup && totalInstallmentsInput) {
        parcelasGroup.style.display = value === 'Parcelada' ? 'block' : 'none';
        totalInstallmentsInput.required = (value === 'Parcelada');
    }
}

/**
 * Salva os saldos iniciais dos cartões.
 */
async function saveCardInitialBalances() {
    const newBalances = {};
    let hasChanges = false;
    
    CARTAO_IDS.forEach(cardId => {
        const inputId = `initial-balance-${cardId.replace(/[^a-zA-Z0-9]/g, '')}`;
        const input = document.getElementById(inputId);
        if (input) {
            const value = parseFloat(input.value) || 0;
            newBalances[cardId] = value;
            if (cardBalances[cardId] !== value) hasChanges = true;
        }
    });

    if (!hasChanges) {
        showModal("Nenhuma alteração detectada para salvar.");
        return;
    }

    try {
        const cardDocRef = doc(window.db, getCollectionPath(COLLECTIONS.CARDS), 'balances');
        await setDoc(cardDocRef, newBalances);
        showModal("Saldos iniciais dos cartões salvos com sucesso!");
    } catch (e) {
        console.error("Erro ao salvar saldos iniciais:", e);
        showModal("Erro ao salvar saldos. Tente novamente.");
    }
}

/**
 * Exporta os dados do mês atual para CSV.
 */
function exportMonthCSV() {
    const monthKey = getCurrentMonthKey();
    const data = [
        ...allEntries.filter(e => e.monthKey === monthKey).map(e => ({ Tipo: 'Entrada', Data: e.date, Descrição: e.platform, Valor: e.value, KM: e.km, Horas: e.hours, Gasolina: e.gas, Outros_Custos: e.otherCosts })),
        ...allExpenses.filter(e => e.monthKey === monthKey).map(e => ({ Tipo: 'Despesa Variável', Data: e.date, Categoria: e.category, Descrição: e.description, Pagamento: e.payment, Valor: -e.value })),
        ...getFixedExpensesForMonth(currentYear, currentMonth, allFixed).map(e => ({ Tipo: 'Despesa Fixa', Data: e.startDate, Categoria: e.category, Descrição: e.description + (e.currentInstallment > 1 ? ` (${e.currentInstallment}/${e.installments})` : ''), Pagamento: e.payment, Valor: -e.value }))
    ];

    if (data.length === 0) {
        showModal("Não há dados para exportar neste mês.");
        return;
    }

    const headers = ["Tipo", "Data", "Descrição", "Valor", "Categoria", "Pagamento", "KM", "Horas", "Gasolina", "Outros_Custos"];
    const csvContent = "data:text/csv;charset=utf-8," + 
        [
            headers.join(";"),
            ...data.map(row => headers.map(header => row[header] !== undefined ? (typeof row[header] === 'number' ? String(row[header]).replace('.', ',') : row[header]) : '').join(";"))
        ].join("\n");

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `ControleFinanceiro_${monthKey}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

/**
 * Exporta os dados do painel para PDF.
 */
function exportMonthPDF() {
    if (!window.jspdf) {
        showModal("Biblioteca jspdf não carregada. Verifique as tags <script>.");
        return;
    }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const monthDisplay = getCurrentMonthDisplay();

    doc.setFontSize(18);
    doc.text(`Relatório Financeiro: ${monthDisplay}`, 14, 22);
    doc.setFontSize(12);

    let y = 30;

    const addStat = (title, value, color) => {
        doc.setFillColor(color[0], color[1], color[2]);
        doc.rect(14, y, 180, 8, 'F');
        doc.setTextColor(255, 255, 255);
        doc.text(title, 16, y + 6);
        doc.text(value, 190, y + 6, null, null, "right");
        y += 10;
    };
    
    // Cores (RGB de cores do CSS)
    const corSucesso = [76, 175, 80];
    const corErro = [244, 67, 54];
    const corDestaque = [255, 152, 0];
    const corPrimaria = [33, 150, 243];

    // Obter valores do DOM
    const totalEntradas = document.getElementById('total-entradas')?.querySelector('.value')?.textContent || 'R$ 0,00';
    const totalDespesas = document.getElementById('total-despesas')?.querySelector('.value')?.textContent || 'R$ 0,00';
    const lucroLiquido = document.getElementById('lucro-liquido')?.querySelector('.value')?.textContent || 'R$ 0,00';
    const saldoCaixa = document.getElementById('saldo-caixa')?.querySelector('.value')?.textContent || 'R$ 0,00';

    addStat('Total Entradas', totalEntradas, corSucesso);
    addStat('Total Despesas', totalDespesas, corErro);
    addStat('Lucro Líquido', lucroLiquido, corDestaque);
    addStat('Saldo em Caixa (Dinheiro/PIX)', saldoCaixa, corPrimaria);
    
    doc.save(`Relatorio_Financeiro_${getCurrentMonthKey()}.pdf`);
}

/**
 * Exibe um modal simples (substituto de alert()).
 */
function showModal(message) {
    const modalId = 'app-modal';
    let modal = document.getElementById(modalId);
    if (!modal) {
        modal = document.createElement('div');
        modal.id = modalId;
        modal.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100%; height: 100%; 
            background: rgba(0, 0, 0, 0.7); display: flex; 
            justify-content: center; align-items: center; z-index: 1000;
        `;
        modal.innerHTML = `
            <div style="background: var(--cor-card); padding: 20px; border-radius: 10px; 
                        max-width: 300px; text-align: center; border: 2px solid var(--cor-destaque);">
                <p id="modal-message" style="margin-bottom: 20px; color:var(--cor-texto);"></p>
                <button onclick="document.getElementById('${modalId}').style.display='none'" 
                        style="padding: 8px 15px; background: var(--cor-destaque); color: black; border: none; border-radius: 5px; cursor: pointer;">
                    OK
                </button>
            </div>
        `;
        document.body.appendChild(modal);
    }

    document.getElementById('modal-message').textContent = message;
    modal.style.display = 'flex';
}