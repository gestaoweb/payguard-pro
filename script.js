// ==========================================
// CONFIGURAÇÃO DO FIREBASE (Chaves Atuais)
// ==========================================
const firebaseConfig = {
  apiKey: "AIzaSyAl5lKPPJFVMctiZphR-11kzTrQSYm4170",
  authDomain: "payguard-pro-app.firebaseapp.com",
  projectId: "payguard-pro-app",
  storageBucket: "payguard-pro-app.firebasestorage.app",
  messagingSenderId: "928116444935",
  appId: "1:928116444935:web:b055033594ba657e557fa2"
};

if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
}

const auth = firebase.auth();
const db = firebase.firestore();

let currentUser = null;
let currentProfile = null;
let invoicesData = [];
let historyData = [];
let payChartInstance = null;
let receiveChartInstance = null;
let cashFlowLineChartInstance = null;
let authMode = 'login';
let currentCurrency = 'EUR';
let currentPeriodFilter = 'todos';
let currentViewMode = 'table';
let activeReminderItem = null;

const currencySymbols = { 
    EUR: '€', 
    USD: '$', 
    GBP: '£', 
    BRL: 'R$', 
    CHF: 'Fr' 
};

const exchangeToEur = {
    'EUR': 1.0,
    'USD': 0.92, 
    'GBP': 1.18, 
    'BRL': 0.17, 
    'CHF': 1.05  
};

function convertCurrency(amount, fromCurr, toCurr) {
    if (!fromCurr) fromCurr = 'EUR';
    if (!toCurr) toCurr = currentCurrency;
    if (fromCurr === toCurr) return amount;
    
    const rateToEur = exchangeToEur[fromCurr] || 1.0;
    const amountInEur = amount * rateToEur;
    const eurToTargetRate = exchangeToEur[toCurr] ? (1 / exchangeToEur[toCurr]) : 1.0;
    return amountInEur * eurToTargetRate;
}

const sampleData = [
    { type: "pagar", invoiceNo: "FORN-2026-010", clientName: "Logística Global Lda", contact: "faturas@logisticaglobal.pt", category: "Fornecedores / Matéria-prima", currency: "EUR", amount: 1200.00, penalty: 0.00, issueDate: "2026-09-01", dueDate: "2026-10-15", attachment: null, isHistory: false },
    { type: "receber", invoiceNo: "FAC-2026-001", clientName: "Grossista Norte, Lda", contact: "geral@grossistanorte.pt", category: "Serviços Prestados", currency: "USD", amount: 1800.00, issueDate: "2026-08-10", dueDate: "2026-09-10", attachment: null, isHistory: false },
    { type: "receber", invoiceNo: "FAC-2026-002", clientName: "Distribuidora Ibérica SA", contact: "financeiro@distiberica.com", category: "Serviços Prestados", currency: "EUR", amount: 3250.50, issueDate: "2026-07-15", dueDate: "2026-08-15", attachment: null, isHistory: false }
];

document.addEventListener('DOMContentLoaded', () => {
    const options = { year: 'numeric', month: 'long', day: 'numeric' };
    const dateBadge = document.getElementById('currentDateBadge');
    if (dateBadge) {
        dateBadge.innerText = new Date().toLocaleDateString('pt-PT', options);
    }

    auth.onAuthStateChanged(async (user) => {
        if (user) {
            currentUser = user.uid;
            await loadProfileAndApp(user);
        } else {
            currentUser = null;
            currentProfile = null;
            showAuthScreen();
        }
    });

    document.getElementById('searchInput').addEventListener('input', processAndRender);
    document.getElementById('btnExportList').addEventListener('click', exportContactList);
    document.getElementById('btnExportPayments').addEventListener('click', exportPaymentsList);
    document.getElementById('copyMessageBtn').addEventListener('click', copyReminderMessage);
    document.getElementById('sendEmailBtn').addEventListener('click', sendEmailReminder);
    document.getElementById('sendWhatsappBtn').addEventListener('click', sendWhatsappReminder);

    const cancelFormBtn = document.getElementById('btnCancelForm');
    const formContainer = document.getElementById('addFormContainer');
    const addForm = document.getElementById('addInvoiceForm');

    cancelFormBtn.addEventListener('click', () => {
        formContainer.style.display = 'none';
        addForm.reset();
        document.getElementById('editIndex').value = -1;
    });

    addForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const type = document.getElementById('newType').value;
        const amount = parseFloat(document.getElementById('newAmount').value);
        const penalty = type === 'pagar' ? (parseFloat(document.getElementById('newPenalty').value) || 0) : 0;
        const currency = document.getElementById('newInvoiceCurrency').value;
        const category = document.getElementById('newCategory').value;
        const editIndex = parseInt(document.getElementById('editIndex').value);
        const fileInput = document.getElementById('newAttachmentFile');

        const saveInvoiceObject = async (attachmentBase64 = null) => {
            const invoiceObj = {
                userId: currentUser,
                type: type,
                invoiceNo: document.getElementById('newInvoiceNo').value,
                clientName: document.getElementById('newClientName').value,
                contact: document.getElementById('newContact').value,
                category: category,
                currency: currency,
                amount: amount,
                penalty: penalty,
                issueDate: document.getElementById('newIssueDate').value,
                dueDate: document.getElementById('newDueDate').value,
                attachment: attachmentBase64 || (editIndex >= 0 && invoicesData[editIndex] ? invoicesData[editIndex].attachment : null),
                isHistory: false
            };

            if (editIndex >= 0 && invoicesData[editIndex].id) {
                const docId = invoicesData[editIndex].id;
                await db.collection('invoices').doc(docId).update(invoiceObj);
                showToast('Registo atualizado com sucesso!', 'success');
            } else {
                await db.collection('invoices').add(invoiceObj);
                showToast('Fatura registada com sucesso!', 'success');
            }

            fetchUserData();
            processAndRender();
            addForm.reset();
            document.getElementById('editIndex').value = -1;
            formContainer.style.display = 'none';
        };

        if (fileInput.files && fileInput.files[0]) {
            const reader = new FileReader();
            reader.onload = function(evt) {
                saveInvoiceObject(evt.target.result);
            };
            reader.readAsDataURL(fileInput.files[0]);
        } else {
            await saveInvoiceObject();
        }
    });

    initCharts();
});

function toggleMobileSidebar() {
    const sidebar = document.getElementById('appSidebar');
    sidebar.classList.toggle('mobile-open');
}

function showToast(message, type = 'success') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<i class="fa-solid ${type === 'success' ? 'fa-circle-check' : 'fa-circle-exclamation'}" style="color:var(--${type === 'success' ? 'success' : 'danger'})"></i> ${message}`;
    container.appendChild(toast);
    setTimeout(() => { toast.remove(); }, 3500);
}

function switchAuthMode(mode) {
    authMode = mode;
    document.getElementById('tabLoginBtn').classList.toggle('active', mode === 'login');
    document.getElementById('tabRegisterBtn').classList.toggle('active', mode === 'register');
    
    const registerFields = document.getElementById('registerFields');
    const authSubmitBtn = document.getElementById('authSubmitBtn');
    const authSubtitle = document.getElementById('authSubtitle');

    if (mode === 'register') {
        registerFields.style.display = 'block';
        authSubmitBtn.innerText = 'Concluir Registo';
        authSubtitle.innerText = 'Registe a sua empresa no PayGuard Pro';
    } else {
        registerFields.style.display = 'none';
        authSubmitBtn.innerText = 'Entrar';
        authSubtitle.innerText = 'Aceda à sua conta financeira';
    }
}

async function handleAuth(event) {
    event.preventDefault();
    const email = document.getElementById('authEmail').value.trim();
    const password = document.getElementById('authPassword').value;
    const errorEl = document.getElementById('authError');
    errorEl.innerText = '';

    try {
        if (authMode === 'register') {
            const companyName = document.getElementById('regCompanyName').value.trim() || email;
            const nif = document.getElementById('regNif').value.trim() || 'N/D';
            const phone = document.getElementById('regPhone').value.trim() || 'N/D';

            const userCredential = await auth.createUserWithEmailAndPassword(email, password);
            const uid = userCredential.user.uid;

            await db.collection('users').doc(uid).set({ companyName, nif, phone, email });

            for (const item of sampleData) {
                await db.collection('invoices').add({ ...item, userId: uid });
            }

            showToast('Conta criada com sucesso!', 'success');
            switchAuthMode('login');
            document.getElementById('authForm').reset();
        } else {
            await auth.signInWithEmailAndPassword(email, password);
            document.getElementById('authForm').reset();
        }
    } catch (err) {
        errorEl.innerText = err.message;
    }
}

function logoutUser() {
    auth.signOut();
}

function showAuthScreen() {
    document.getElementById('authScreen').style.display = 'flex';
    document.getElementById('appContainer').style.display = 'none';
}

async function loadProfileAndApp(user) {
    const userDoc = await db.collection('users').doc(user.uid).get();
    if (userDoc.exists) {
        currentProfile = userDoc.data();
    } else {
        currentProfile = { companyName: user.email };
    }

    document.getElementById('authScreen').style.display = 'none';
    document.getElementById('appContainer').style.display = 'flex';
    document.getElementById('sidebarCompanyName').innerText = currentProfile.companyName;
    document.getElementById('sidebarAvatar').innerText = currentProfile.companyName.substring(0, 2).toUpperCase();
    document.getElementById('topAvatar').innerText = currentProfile.companyName.substring(0, 1).toUpperCase();

    fetchUserData();
}

async function fetchUserData() {
    if (!currentUser) return;
    const snapshot = await db.collection('invoices').where('userId', '==', currentUser).get();
    
    invoicesData = [];
    historyData = [];

    snapshot.forEach(doc => {
        const data = { id: doc.id, ...doc.data() };
        if (data.isHistory) {
            historyData.push(data);
        } else {
            invoicesData.push(data);
        }
    });

    const savedCurr = localStorage.getItem(`payguard_currency_${currentUser}`);
    if (savedCurr) {
        currentCurrency = savedCurr;
        document.getElementById('currencySelect').value = currentCurrency;
    }

    if (localStorage.getItem(`payguard_dark_${currentUser}`) === 'true') {
        document.body.classList.add('dark-mode');
        document.getElementById('themeToggleBtn').innerHTML = '<i class="fa-solid fa-sun"></i> Tema Claro';
    }

    processAndRender();
}

function changeGlobalCurrency(curr) {
    currentCurrency = curr;
    localStorage.setItem(`payguard_currency_${currentUser}`, curr);
    processAndRender();
    showToast(`Moeda base alterada para ${curr}.`, 'success');
}

function formatMoney(amount, curr = currentCurrency) {
    const sym = currencySymbols[curr] || '€';
    return `${sym} ${amount.toLocaleString('pt-PT', {minimumFractionDigits: 2})}`;
}

function openSettingsModal() {
    document.getElementById('settingsCompanyName').value = currentProfile.companyName || '';
    document.getElementById('settingsNif').value = currentProfile.nif || '';
    document.getElementById('settingsPhone').value = currentProfile.phone || '';
    document.getElementById('settingsModal').style.display = 'flex';
}
function closeSettingsModal() { document.getElementById('settingsModal').style.display = 'none'; }

async function saveSettings() {
    currentProfile.companyName = document.getElementById('settingsCompanyName').value;
    currentProfile.nif = document.getElementById('settingsNif').value;
    currentProfile.phone = document.getElementById('settingsPhone').value;

    await db.collection('users').doc(currentUser).set(currentProfile, { merge: true });

    document.getElementById('sidebarCompanyName').innerText = currentProfile.companyName;
    closeSettingsModal();
    showToast('Definições atualizadas com sucesso!', 'success');
}

function setPeriodFilter(period, btnElement) {
    currentPeriodFilter = period;
    document.querySelectorAll('.pill-btn').forEach(b => b.classList.remove('active'));
    btnElement.classList.add('active');
    processAndRender();
}

function switchViewMode(mode) {
    currentViewMode = mode;
    document.getElementById('btnViewTable').classList.toggle('active', mode === 'table');
    document.getElementById('btnViewKanban').classList.toggle('active', mode === 'kanban');
    renderTablesOrKanban();
}

function switchTab(tabName) {
    document.getElementById('tabDespesas').style.display = tabName === 'despesas' ? 'block' : 'none';
    document.getElementById('tabReceber').style.display = tabName === 'receber' ? 'block' : 'none';
    document.getElementById('tabHistorico').style.display = tabName === 'historico' ? 'block' : 'none';

    document.getElementById('navDespesas').classList.toggle('active', tabName === 'despesas');
    document.getElementById('navReceber').classList.toggle('active', tabName === 'receber');
    document.getElementById('navHistorico').classList.toggle('active', tabName === 'historico');

    document.getElementById('addFormContainer').style.display = 'none';
    if (tabName !== 'historico') {
        setTimeout(updateCharts, 50);
    }

    // Fechar menu mobile ao trocar de separador em telemóveis
    const sidebar = document.getElementById('appSidebar');
    sidebar.classList.remove('mobile-open');
}

function openAddForm(type) {
    const formContainer = document.getElementById('addFormContainer');
    const formTitle = document.getElementById('formTitle');
    const penaltyGroup = document.getElementById('penaltyGroup');
    const formSubmitBtn = document.getElementById('formSubmitBtn');

    document.getElementById('addInvoiceForm').reset();
    document.getElementById('editIndex').value = -1;
    document.getElementById('newType').value = type;
    
    const currSelect = document.getElementById('newInvoiceCurrency');
    if (currSelect) currSelect.value = currentCurrency;

    formSubmitBtn.innerHTML = '<i class="fa-solid fa-check"></i> Guardar';

    if (type === 'pagar') {
        formTitle.innerHTML = '<i class="fa-solid fa-pen-to-square"></i> Registar Nova Despesa (A Pagar)';
        penaltyGroup.style.display = 'block';
    } else {
        formTitle.innerHTML = '<i class="fa-solid fa-pen-to-square"></i> Registar Nova Fatura a Receber';
        penaltyGroup.style.display = 'none';
    }

    formContainer.style.display = 'block';
    formContainer.scrollIntoView({ behavior: 'smooth' });
}

function editInvoice(index) {
    const inv = invoicesData[index];
    if (!inv) return;

    const formContainer = document.getElementById('addFormContainer');
    const formTitle = document.getElementById('formTitle');
    const penaltyGroup = document.getElementById('penaltyGroup');
    const formSubmitBtn = document.getElementById('formSubmitBtn');

    document.getElementById('editIndex').value = index;
    document.getElementById('newType').value = inv.type;
    document.getElementById('newInvoiceNo').value = inv.invoiceNo;
    document.getElementById('newClientName').value = inv.clientName;
    document.getElementById('newContact').value = inv.contact;
    document.getElementById('newCategory').value = inv.category || 'Outros';
    document.getElementById('newAmount').value = inv.amount;
    document.getElementById('newIssueDate').value = inv.issueDate;
    document.getElementById('newDueDate').value = inv.dueDate;

    const currSelect = document.getElementById('newInvoiceCurrency');
    if (currSelect) currSelect.value = inv.currency || 'EUR';

    if (inv.type === 'pagar') {
        formTitle.innerHTML = '<i class="fa-solid fa-pen-to-square"></i> Editar Despesa';
        penaltyGroup.style.display = 'block';
        document.getElementById('newPenalty').value = inv.penalty || 0;
    } else {
        formTitle.innerHTML = '<i class="fa-solid fa-pen-to-square"></i> Editar Fatura a Receber';
        penaltyGroup.style.display = 'none';
    }

    formSubmitBtn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Atualizar Registo';
    closeDetailsModal();
    formContainer.style.display = 'block';
    formContainer.scrollIntoView({ behavior: 'smooth' });
}

function toggleTheme() {
    document.body.classList.toggle('dark-mode');
    const isDark = document.body.classList.contains('dark-mode');
    localStorage.setItem(`payguard_dark_${currentUser}`, isDark);
    document.getElementById('themeToggleBtn').innerHTML = isDark ? '<i class="fa-solid fa-sun"></i> Tema Claro' : '<i class="fa-solid fa-moon"></i> Tema Escuro';
    updateCharts();
}

function processAndRender() {
    const today = new Date();
    const searchQuery = document.getElementById('searchInput').value.toLowerCase();
    
    let totalReceive = 0, totalPay = 0;
    let overdueReceiveCount = 0;
    let totalInvoiced = 0, totalCollected = 0;

    invoicesData.forEach(inv => {
        const due = new Date(inv.dueDate);
        const diffDays = Math.ceil((today - due) / (1000 * 60 * 60 * 24));

        let matchesPeriod = true;
        const dueYear = due.getFullYear();
        const dueMonth = due.getMonth();
        const nowYear = today.getFullYear();
        const nowMonth = today.getMonth();

        if (currentPeriodFilter === 'mes' && (dueYear !== nowYear || dueMonth !== nowMonth)) matchesPeriod = false;
        if (currentPeriodFilter === '7dias' && (diffDays < -7 || diffDays > 0)) matchesPeriod = false;
        if (currentPeriodFilter === 'vencidos' && diffDays <= 0) matchesPeriod = false;

        inv.matchesPeriod = matchesPeriod;

        const matchesSearch = Object.values(inv).some(val => String(val).toLowerCase().includes(searchQuery));
        inv.matchesSearch = matchesSearch;

        const invCurr = inv.currency || 'EUR';
        const baseConverted = convertCurrency(inv.amount, invCurr, currentCurrency);

        if (!inv.isHistory && inv.type === 'receber') {
            totalInvoiced += baseConverted;
            if (diffDays > 0) {
                inv.isOverdue = true;
                inv.overdueDays = diffDays;
                if (matchesPeriod) overdueReceiveCount++;
                inv.interest = inv.amount * (0.001 * diffDays);
                inv.totalWithInterest = inv.amount + inv.interest;
            } else {
                inv.isOverdue = false;
                inv.overdueDays = 0;
                inv.interest = 0;
                inv.totalWithInterest = inv.amount;
            }

            const totalWithInterestConverted = convertCurrency(inv.totalWithInterest, invCurr, currentCurrency);
            if (matchesPeriod && matchesSearch) totalReceive += totalWithInterestConverted;
        } else if (!inv.isHistory && inv.type === 'pagar') {
            inv.isPayDue = diffDays > 0;
            inv.payDueDays = diffDays > 0 ? diffDays : 0;
            inv.totalPayAmount = inv.amount + (inv.penalty || 0);

            const totalPayConverted = convertCurrency(inv.totalPayAmount, invCurr, currentCurrency);
            if (matchesPeriod && matchesSearch) totalPay += totalPayConverted;
        }
    });

    historyData.forEach(h => {
        if (h.type === 'receber') {
            totalCollected += convertCurrency(h.amount, h.currency || 'EUR', currentCurrency);
        }
    });

    const collectionRate = totalInvoiced > 0 ? Math.round((totalCollected / (totalInvoiced + totalCollected)) * 100) : 0;
    document.getElementById('collectionRate').innerText = `${collectionRate}%`;

    const cashFlow30d = totalReceive - totalPay;
    document.getElementById('cashFlowProj').innerText = formatMoney(cashFlow30d, currentCurrency);

    document.getElementById('totalReceiveAmount').innerText = formatMoney(totalReceive, currentCurrency);
    document.getElementById('overdueCount').innerText = `${overdueReceiveCount} faturas em atraso`;
    document.getElementById('totalPayAmount').innerText = formatMoney(totalPay, currentCurrency);

    renderTablesOrKanban();
    updateCharts();
}

function renderTablesOrKanban() {
    const payContainer = document.getElementById('payContainerContent');
    const receiveContainer = document.getElementById('receiveContainerContent');
    const historyTbody = document.getElementById('historyTableBody');

    const payItems = invoicesData.map((inv, idx) => ({ ...inv, originalIndex: idx }))
        .filter(i => !i.isHistory && i.type === 'pagar' && i.matchesPeriod && i.matchesSearch);

    const receiveItems = invoicesData.map((inv, idx) => ({ ...inv, originalIndex: idx }))
        .filter(i => !i.isHistory && i.type === 'receber' && i.matchesPeriod && i.matchesSearch);

    if (currentViewMode === 'table') {
        payContainer.innerHTML = `
            <div class="table-container">
                <table>
                    <thead><tr><th>Estado</th><th>Emissão</th><th>Ref</th><th>Fornecedor</th><th>Categoria</th><th>Valor</th><th>Limite</th><th>Ações</th></tr></thead>
                    <tbody id="payTableBody"></tbody>
                </table>
            </div>`;
        receiveContainer.innerHTML = `
            <div class="table-container">
                <table>
                    <thead><tr><th>Estado</th><th>Emissão</th><th>Fatura</th><th>Cliente</th><th>Categoria</th><th>Valor</th><th>Vencimento</th><th>Ações</th></tr></thead>
                    <tbody id="receiveTableBody"></tbody>
                </table>
            </div>`;

        const payTbody = document.getElementById('payTableBody');
        const receiveTbody = document.getElementById('receiveTableBody');

        if (payItems.length === 0) {
            payTbody.innerHTML = `<tr><td colspan="8"><div class="empty-state"><i class="fa-solid fa-folder-open"></i><p>Sem despesas registadas.</p></div></td></tr>`;
        } else {
            payItems.forEach(inv => {
                const tr = document.createElement('tr');
                tr.onclick = (e) => { if(!e.target.closest('button')) openDetailsModal(inv); };
                let statusText = inv.isPayDue ? `Vencida há ${inv.payDueDays}d` : 'Em Prazo';
                let statusClass = inv.isPayDue ? 'status-overdue' : 'status-ok';
                const invCurr = inv.currency || 'EUR';

                tr.innerHTML = `
                    <td><span class="status-badge ${statusClass}">${statusText}</span></td>
                    <td>${inv.issueDate}</td>
                    <td><strong>${inv.invoiceNo}</strong></td>
                    <td>${inv.clientName}</td>
                    <td><span style="font-size:0.8rem; background:var(--bg-main); padding:3px 8px; border-radius:6px; border:1px solid var(--border);">${inv.category || 'Outros'}</span></td>
                    <td><strong>${formatMoney(inv.totalPayAmount, invCurr)}</strong></td>
                    <td>${inv.dueDate}</td>
                    <td>
                        <div class="action-buttons">
                            <button type="button" class="btn-action" onclick="editInvoice(${inv.originalIndex})" title="Editar"><i class="fa-solid fa-pen"></i></button>
                            <button type="button" class="btn-action btn-pay" onclick="markAsLiquidated(${inv.originalIndex})" title="Marcar Pago"><i class="fa-solid fa-check"></i></button>
                            <button type="button" class="btn-action" onclick='openPayReminderModal(${JSON.stringify(inv)})' title="Lembrete"><i class="fa-solid fa-bell"></i></button>
                            <button type="button" class="btn-action btn-delete" onclick="deleteInvoice(${inv.originalIndex})" title="Apagar"><i class="fa-solid fa-trash"></i></button>
                        </div>
                    </td>
                `;
                payTbody.appendChild(tr);
            });
        }

        if (receiveItems.length === 0) {
            receiveTbody.innerHTML = `<tr><td colspan="8"><div class="empty-state"><i class="fa-solid fa-folder-open"></i><p>Sem faturas a receber.</p></div></td></tr>`;
        } else {
            receiveItems.forEach(inv => {
                const tr = document.createElement('tr');
                tr.onclick = (e) => { if(!e.target.closest('button')) openDetailsModal(inv); };
                let statusText = inv.isOverdue ? `Atraso (${inv.overdueDays}d)` : 'Em Dia';
                let statusClass = inv.isOverdue ? 'status-overdue' : 'status-ok';
                const invCurr = inv.currency || 'EUR';

                tr.innerHTML = `
                    <td><span class="status-badge ${statusClass}">${statusText}</span></td>
                    <td>${inv.issueDate}</td>
                    <td><strong>${inv.invoiceNo}</strong></td>
                    <td>${inv.clientName}</td>
                    <td><span style="font-size:0.8rem; background:var(--bg-main); padding:3px 8px; border-radius:6px; border:1px solid var(--border);">${inv.category || 'Outros'}</span></td>
                    <td><strong>${formatMoney(inv.totalWithInterest || inv.amount, invCurr)}</strong></td>
                    <td>${inv.dueDate}</td>
                    <td>
                        <div class="action-buttons">
                            <button type="button" class="btn-action" onclick="editInvoice(${inv.originalIndex})" title="Editar"><i class="fa-solid fa-pen"></i></button>
                            <button type="button" class="btn-action btn-pay" onclick="markAsLiquidated(${inv.originalIndex})" title="Marcar Recebido"><i class="fa-solid fa-check"></i></button>
                            ${inv.isOverdue ? `<button type="button" class="btn-action" onclick='openReceiveReminderModal(${JSON.stringify(inv)})' title="Aviso"><i class="fa-solid fa-paper-plane"></i></button>` : ''}
                            <button type="button" class="btn-action btn-delete" onclick="deleteInvoice(${inv.originalIndex})" title="Apagar"><i class="fa-solid fa-trash"></i></button>
                        </div>
                    </td>
                `;
                receiveTbody.appendChild(tr);
            });
        }
    } else {
        const renderKanbanCards = (items, type) => {
            return `
                <div class="kanban-board">
                    <div class="kanban-column">
                        <h4>Em Prazo / Em Dia <span class="status-badge status-ok">${items.filter(i => type==='pagar'? !i.isPayDue : !i.isOverdue).length}</span></h4>
                        <div class="kanban-cards">
                            ${items.filter(i => type==='pagar'? !i.isPayDue : !i.isOverdue).map(inv => `
                                <div class="kanban-card" onclick='openDetailsModal(${JSON.stringify(inv)})'>
                                    <div class="kanban-card-header"><span>${inv.invoiceNo}</span><span>${formatMoney(type==='pagar'? inv.totalPayAmount : inv.amount, inv.currency || 'EUR')}</span></div>
                                    <div class="kanban-card-body"><span><strong>${inv.clientName}</strong></span><span>Vence:${inv.dueDate}</span></div>
                                </div>
                            `).join('') || '<p style="font-size:0.8rem; color:var(--text-muted)">Sem registos.</p>'}
                        </div>
                    </div>
                    <div class="kanban-column">
                        <h4>Vencidas / Atraso <span class="status-badge status-overdue">${items.filter(i => type==='pagar'? i.isPayDue : i.isOverdue).length}</span></h4>
                        <div class="kanban-cards">
                            ${items.filter(i => type==='pagar'? i.isPayDue : i.isOverdue).map(inv => `
                                <div class="kanban-card" onclick='openDetailsModal(${JSON.stringify(inv)})' style="border-left: 4px solid var(--danger)">
                                    <div class="kanban-card-header"><span>${inv.invoiceNo}</span><span style="color:var(--danger)">${formatMoney(type==='pagar'? inv.totalPayAmount : inv.totalWithInterest, inv.currency || 'EUR')}</span></div>
                                    <div class="kanban-card-body"><span><strong>${inv.clientName}</strong></span><span>Atraso:${inv.overdueDays || inv.payDueDays} dias</span></div>
                                </div>
                            `).join('') || '<p style="font-size:0.8rem; color:var(--text-muted)">Sem registos.</p>'}
                        </div>
                    </div>
                    <div class="kanban-column">
                        <h4>Liquidadas <span class="status-badge status-ok">${historyData.filter(h => h.type === type).length}</span></h4>
                        <div class="kanban-cards">
                            ${historyData.filter(h => h.type === type).map(inv => `
                                <div class="kanban-card" style="opacity: 0.7">
                                    <div class="kanban-card-header"><span>${inv.invoiceNo}</span><span>${formatMoney(inv.amount, inv.currency || 'EUR')}</span></div>
                                    <div class="kanban-card-body"><span><strong>${inv.clientName}</strong></span><span>Pago a:${inv.liquidationDate}</span></div>
                                </div>
                            `).join('') || '<p style="font-size:0.8rem; color:var(--text-muted)">Sem histórico.</p>'}
                        </div>
                    </div>
                </div>`;
        };

        payContainer.innerHTML = renderKanbanCards(payItems, 'pagar');
        receiveContainer.innerHTML = renderKanbanCards(receiveItems, 'receber');
    }

    historyTbody.innerHTML = '';
    if (historyData.length === 0) {
        historyTbody.innerHTML = `<tr><td colspan="7"><div class="empty-state"><i class="fa-solid fa-folder-open"></i><p>Sem histórico.</p></div></td></tr>`;
    } else {
        historyData.forEach((inv, hIdx) => {
            const tr = document.createElement('tr');
            const invCurr = inv.currency || 'EUR';
            tr.innerHTML = `
                <td><span class="status-badge status-ok">${inv.type === 'pagar' ? 'Pago' : 'Recebido'}</span></td>
                <td>${inv.liquidationDate || '-'}</td>
                <td><strong>${inv.invoiceNo}</strong></td>
                <td>${inv.clientName}</td>
                <td><span style="font-size:0.8rem; background:var(--bg-main); padding:3px 8px; border-radius:6px; border:1px solid var(--border);">${inv.category || 'Outros'}</span></td>
                <td>${formatMoney(inv.amount, invCurr)}</td>
                <td><button type="button" class="btn-action btn-delete" onclick="deleteHistoryItem(${hIdx})"><i class="fa-solid fa-trash"></i></button></td>
            `;
            historyTbody.appendChild(tr);
        });
    }
}

function openDetailsModal(inv) {
    const modal = document.getElementById('detailsModal');
    const body = document.getElementById('detailsModalBody');
    const footer = document.getElementById('detailsModalFooter');

    const realIndex = invoicesData.findIndex(i => i.invoiceNo === inv.invoiceNo && i.clientName === inv.clientName);
    const invCurr = inv.currency || 'EUR';

    body.innerHTML = `
        <p><strong>Tipo:</strong> ${inv.type === 'pagar' ? 'Despesa (A Pagar)' : 'Fatura a Receber'}</p>
        <p><strong>Nº Fatura:</strong> ${inv.invoiceNo}</p>
        <p><strong>Entidade:</strong> ${inv.clientName}</p>
        <p><strong>Contacto:</strong> ${inv.contact}</p>
        <p><strong>Categoria:</strong> ${inv.category || 'Outros'}</p>
        <p><strong>Moeda:</strong> ${invCurr}</p>
        <p><strong>Valor Base:</strong> ${formatMoney(inv.amount, invCurr)}</p>
        ${inv.penalty > 0 ? `<p style="color:var(--danger)"><strong>Multa/Taxa:</strong> + ${formatMoney(inv.penalty, invCurr)}</p>` : ''}
        ${inv.interest > 0 ? `<p style="color:var(--danger)"><strong>Juros de Mora:</strong> + ${formatMoney(inv.interest, invCurr)}</p>` : ''}
        <p><strong>Data de Emissão:</strong> ${inv.issueDate}</p>
        <p><strong>Data Limite:</strong> ${inv.dueDate}</p>
        ${inv.attachment ? `<p style="margin-top:10px;"><a href="${inv.attachment}" target="_blank" class="btn-secondary" style="display:inline-flex; align-items:center; gap:6px; text-decoration:none;"><i class="fa-solid fa-paperclip"></i> Ver Fatura Anexada</a></p>` : '<p style="color:var(--text-muted); font-size:0.85srem;">Sem ficheiro anexado.</p>'}
    `;

    footer.innerHTML = `
        <button type="button" class="btn-primary" onclick="editInvoice(${realIndex})"><i class="fa-solid fa-pen"></i> Editar</button>
        <button type="button" class="btn-secondary" onclick="closeDetailsModal()">Fechar</button>
    `;

    modal.style.display = 'flex';
}
function closeDetailsModal() { document.getElementById('detailsModal').style.display = 'none'; }

function initCharts() {
    const ctxPay = document.getElementById('payChart').getContext('2d');
    payChartInstance = new Chart(ctxPay, {
        type: 'doughnut',
        data: { labels: ['Em Prazo', 'Vencidas'], datasets: [{ data: [0, 0], backgroundColor: ['#16a34a', '#dc2626'] }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { boxWidth: 12, font: { size: 11 } } } } }
    });

    const ctxRec = document.getElementById('receiveChart').getContext('2d');
    receiveChartInstance = new Chart(ctxRec, {
        type: 'doughnut',
        data: { labels: ['Em Dia', 'Em Atraso'], datasets: [{ data: [0, 0], backgroundColor: ['#16a34a', '#dc2626'] }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { boxWidth: 12, font: { size: 11 } } } } }
    });

    const ctxLine = document.getElementById('cashFlowLineChart').getContext('2d');
    cashFlowLineChartInstance = new Chart(ctxLine, {
        type: 'line',
        data: {
            labels: ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'],
            datasets: [
                { label: 'Entradas', data: [0,0,0,0,0,0,0,0,3250,1800,0,0], borderColor: '#16a34a', backgroundColor: '#16a34a', tension: 0.3 },
                { label: 'Saídas', data: [0,0,0,0,0,0,0,0,0,1200,0,0], borderColor: '#dc2626', backgroundColor: '#dc2626', tension: 0.3 }
            ]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'top', labels: { boxWidth: 12, font: { size: 11 } } } } }
    });
}

function updateCharts() {
    if (!payChartInstance || !receiveChartInstance || !cashFlowLineChartInstance) return;

    let payPrazo = 0, payVenc = 0;
    let recDia = 0, recAtraso = 0;

    invoicesData.forEach(inv => {
        if (inv.isHistory || !inv.matchesPeriod) return;
        const invCurr = inv.currency || 'EUR';
        if (inv.type === 'pagar') {
            const converted = convertCurrency(inv.totalPayAmount, invCurr, currentCurrency);
            if (inv.isPayDue) payVenc += converted; else payPrazo += converted;
        } else {
            if (inv.isOverdue) {
                recAtraso += convertCurrency(inv.totalWithInterest, invCurr, currentCurrency);
            } else {
                recDia += convertCurrency(inv.amount, invCurr, currentCurrency);
            }
        }
    });

    payChartInstance.data.datasets[0].data = [payPrazo, payVenc];
    payChartInstance.update();

    receiveChartInstance.data.datasets[0].data = [recDia, recAtraso];
    receiveChartInstance.update();
}

async function markAsLiquidated(index) {
    if (confirm('Marcar esta fatura como liquidada e mover para o Histórico?')) {
        const item = invoicesData.splice(index, 1)[0];
        item.isHistory = true;
        item.liquidationDate = new Date().toISOString().split('T')[0];

        if (item.id) {
            await db.collection('invoices').doc(item.id).update({ isHistory: true, liquidationDate: item.liquidationDate });
        }

        historyData.push(item);
        processAndRender();
        showToast('Fatura liquidada com sucesso!', 'success');
    }
}

async function deleteInvoice(index) {
    if (confirm('Tem a certeza que deseja retirar este registo?')) {
        const item = invoicesData.splice(index, 1)[0];
        if (item.id) {
            await db.collection('invoices').doc(item.id).delete();
        }
        processAndRender();
        showToast('Registo eliminado.', 'error');
    }
}

async function deleteHistoryItem(index) {
    if (confirm('Eliminar do histórico?')) {
        const item = historyData.splice(index, 1)[0];
        if (item.id) {
            await db.collection('invoices').doc(item.id).delete();
        }
        processAndRender();
    }
}

function openReceiveReminderModal(inv) {
    activeReminderItem = inv;
    const invCurr = inv.currency || 'EUR';
    document.getElementById('modalTitle').innerHTML = '<i class="fa-solid fa-paper-plane"></i> Lembrete de Cobrança';
    document.getElementById('modalClientName').innerText = inv.clientName;
    document.getElementById('modalClientContact').innerText = inv.contact;
    document.getElementById('modalInvoiceNo').innerText = inv.invoiceNo;
    document.getElementById('modalAmount').innerText = formatMoney(inv.totalWithInterest || inv.amount, invCurr);
    document.getElementById('reminderText').value = `Exmo(a). Sr(a). Gestor(a) da ${inv.clientName},\n\nA fatura nº ${inv.invoiceNo}, no valor de ${formatMoney(inv.totalWithInterest || inv.amount, invCurr)}, encontra-se em atraso desde ${inv.dueDate}. Agradecemos regularização.`;
    document.getElementById('reminderModal').style.display = 'flex';
}

function openPayReminderModal(inv) {
    activeReminderItem = inv;
    const invCurr = inv.currency || 'EUR';
    document.getElementById('modalTitle').innerHTML = '<i class="fa-solid fa-bell"></i> Lembrete Interno';
    document.getElementById('modalClientName').innerText = inv.clientName;
    document.getElementById('modalClientContact').innerText = inv.contact;
    document.getElementById('modalInvoiceNo').innerText = inv.invoiceNo;
    document.getElementById('modalAmount').innerText = formatMoney(inv.totalPayAmount || inv.amount, invCurr);
    document.getElementById('reminderText').value = `Aviso interno: Efetuar pagamento a ${inv.clientName} referente à fatura ${inv.invoiceNo} até ${inv.dueDate}.`;
    document.getElementById('reminderModal').style.display = 'flex';
}

function closeModal() { document.getElementById('reminderModal').style.display = 'none'; }

function copyReminderMessage() {
    const text = document.getElementById('reminderText');
    text.select();
    navigator.clipboard.writeText(text.value);
    showToast('Mensagem copiada para a área de transferência!', 'success');
}

function sendEmailReminder() {
    if (!activeReminderItem) return;
    const email = activeReminderItem.contact;
    const subject = encodeURIComponent(`Lembrete Fatura nº ${activeReminderItem.invoiceNo}`);
    const body = encodeURIComponent(document.getElementById('reminderText').value);
    window.location.href = `mailto:${email}?subject=${subject}&body=${body}`;
}

function sendWhatsappReminder() {
    if (!activeReminderItem) return;
    let phone = activeReminderItem.contact.replace(/[^0-9+]/g, '');
    const text = encodeURIComponent(document.getElementById('reminderText').value);
    window.open(`https://wa.me/${phone}?text=${text}`, '_blank');
}

function exportPdfReport(type) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const items = invoicesData.filter(i => !i.isHistory && i.type === type);

    doc.setFontSize(18);
    doc.text(`Relatório Oficial - PayGuard Pro`, 14, 20);
    doc.setFontSize(11);
    doc.text(`Empresa: ${currentProfile ? currentProfile.companyName : 'Minha Empresa'}`, 14, 28);
    doc.text(`Data de Emissão: ${new Date().toLocaleDateString('pt-PT')}`, 14, 34);
    doc.text(`Tipo: ${type === 'pagar' ? 'Despesas (A Pagar)' : 'Faturas a Receber'}`, 14, 40);

    let startY = 50;
    doc.setFont(undefined, 'bold');
    doc.text("Ref", 14, startY);
    doc.text("Entidade", 50, startY);
    doc.text("Categoria", 110, startY);
    doc.text("Valor", 160, startY);
    doc.setFont(undefined, 'normal');

    startY += 6;
    items.forEach((inv) => {
        if (startY > 270) { doc.addPage(); startY = 20; }
        const invCurr = inv.currency || 'EUR';
        doc.text(String(inv.invoiceNo), 14, startY);
        doc.text(String(inv.clientName).substring(0, 25), 50, startY);
        doc.text(String(inv.category || 'Outros').substring(0, 20), 110, startY);
        doc.text(formatMoney(inv.amount, invCurr), 160, startY);
        startY += 8;
    });

    doc.save(`relatorio_${type}_payguard.pdf`);
    showToast('Relatório PDF gerado com sucesso!', 'success');
}

function exportContactList() {
    const overdue = invoicesData.filter(i => !i.isHistory && i.type === 'receber' && i.isOverdue);
    if (overdue.length === 0) { showToast('Sem faturas em atraso.', 'error'); return; }
    let csv = "Fatura,Cliente,Contacto,Categoria,Moeda,ValorBase,Juros,Total,Vencimento\n";
    overdue.forEach(i => { csv += `${i.invoiceNo},"${i.clientName}","${i.contact}","${i.category||'Outros'}",${i.currency||'EUR'},${i.amount},${i.interest.toFixed(2)},${i.totalWithInterest.toFixed(2)},${i.dueDate}\n`; });
    const link = document.createElement("a");
    link.href = encodeURI("data:text/csv;charset=utf-8," + csv);
    link.download = "cobrancas_atraso.csv";
    link.click();
}

function exportPaymentsList() {
    const payItems = invoicesData.filter(i => !i.isHistory && i.type === 'pagar');
    if (payItems.length === 0) { showToast('Sem despesas.', 'error'); return; }
    let csv = "FaturaRef,Fornecedor,Contacto,Categoria,Moeda,ValorBase,Multa,TotalPagar,DataLimite\n";
    payItems.forEach(i => { csv += `${i.invoiceNo},"${i.clientName}","${i.contact}","${i.category||'Outros'}",${i.currency||'EUR'},${i.amount},${i.penalty||0},${i.totalPayAmount.toFixed(2)},${i.dueDate}\n`; });
    const link = document.createElement("a");
    link.href = encodeURI("data:text/csv;charset=utf-8," + csv);
    link.download = "despesas_pagar.csv";
    link.click();
}

function exportBackupJson() {
    const backupObj = { user: currentUser, profile: currentProfile, invoices: invoicesData, history: historyData };
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(backupObj, null, 2));
    const dlAnchor = document.createElement('a');
    dlAnchor.setAttribute("href", dataStr);
    dlAnchor.setAttribute("download", `payguard_backup_${new Date().toISOString().split('T')[0]}.json`);
    document.body.appendChild(dlAnchor);
    dlAnchor.click();
    dlAnchor.remove();
}

function importBackupJson(event) {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async function(e) {
        try {
            const parsed = JSON.parse(e.target.result);
            if (parsed.invoices && Array.isArray(parsed.invoices)) {
                for (const inv of parsed.invoices) {
                    delete inv.id;
                    await db.collection('invoices').add({ ...inv, userId: currentUser });
                }
                fetchUserData();
                showToast('Backup restaurado com sucesso!', 'success');
            } else {
                showToast('Ficheiro de backup inválido.', 'error');
            }
        } catch (err) {
            showToast('Erro ao ler ficheiro.', 'error');
        }
    };
    reader.readAsText(file);
}

function handleFileUpload(e, defaultType) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async function(evt) {
        try {
            const data = new Uint8Array(evt.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            const sheet = workbook.Sheets[workbook.SheetNames[0]];
            const jsonRows = XLSX.utils.sheet_to_json(sheet, { defval: "" });

            let count = 0;
            for (const [i, row] of jsonRows.entries()) {
                const findKey = (keys) => {
                    const fk = Object.keys(row).find(k => keys.some(pk => k.toLowerCase().includes(pk)));
                    return fk ? row[fk] : null;
                };
                const typeVal = String(findKey(['tipo', 'type']) || defaultType).toLowerCase();
                const type = typeVal.includes('pagar') || typeVal.includes('despesa') ? 'pagar' : 'receber';
                const invoiceNo = String(findKey(['fatura', 'invoice', 'ref']) || `IMP-${i+1}`);
                const clientName = String(findKey(['cliente', 'fornecedor', 'nome']) || 'Entidade');
                const contact = String(findKey(['contacto', 'email']) || 'geral@empresa.pt');
                const category = String(findKey(['categoria', 'category']) || 'Outros');
                const currency = String(findKey(['moeda', 'currency']) || 'EUR').toUpperCase();
                const amount = parseFloat(String(findKey(['valor', 'amount', 'total']) || '0').replace(',', '.')) || 0;
                const penalty = parseFloat(String(findKey(['multa', 'penalizacao']) || '0').replace(',', '.')) || 0;
                const issueDate = String(findKey(['emissao']) || new Date().toISOString().split('T')[0]).split('T')[0];
                const dueDate = String(findKey(['vencimento', 'due']) || issueDate).split('T')[0];

                if (amount > 0) {
                    await db.collection('invoices').add({
                        userId: currentUser,
                        type, invoiceNo, clientName, contact, category, currency, amount, penalty, issueDate, dueDate, attachment: null, isHistory: false
                    });
                    count++;
                }
            }
            fetchUserData();
            showToast(`${count} registos importados com sucesso!`, 'success');
        } catch (err) {
            showToast('Erro ao processar Excel/CSV.', 'error');
        }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
}
