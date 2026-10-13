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
let teamData = [];
let payChartInstance = null;
let receiveChartInstance = null;
let cashFlowLineChartInstance = null;
let authMode = 'login';
let currentCurrency = 'EUR';
let currentPeriodFilter = 'todos';
let currentViewMode = 'table';
let activeReminderItem = null;

const currencySymbols = { EUR: '€', USD: '$', GBP: '£', BRL: 'R$', CHF: 'Fr' };
const exchangeToEur = { 'EUR': 1.0, 'USD': 0.92, 'GBP': 1.18, 'BRL': 0.17, 'CHF': 1.05 };

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
    { type: "pagar", invoiceNo: "FORN-2026-010", clientName: "Logística Global Lda", contact: "faturas@logisticaglobal.pt", category: "Fornecedores", currency: "EUR", amount: 1200.00, penalty: 0.00, issueDate: "2026-09-01", dueDate: "2026-10-15", recurring: "Nenhuma", isHistory: false },
    { type: "receber", invoiceNo: "FAC-2026-001", clientName: "Grossista Norte, Lda", contact: "geral@grossistanorte.pt", category: "Serviços", currency: "USD", amount: 1800.00, issueDate: "2026-08-10", dueDate: "2026-09-10", recurring: "Mensal", isHistory: false }
];

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('currentDateBadge').innerText = new Date().toLocaleDateString('pt-PT', { year: 'numeric', month: 'long', day: 'numeric' });

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

    document.getElementById('btnCancelForm').addEventListener('click', () => {
        document.getElementById('addFormContainer').style.display = 'none';
        document.getElementById('addInvoiceForm').reset();
    });

    document.getElementById('addInvoiceForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const type = document.getElementById('newType').value;
        const amount = parseFloat(document.getElementById('newAmount').value);
        const penalty = type === 'pagar' ? (parseFloat(document.getElementById('newPenalty').value) || 0) : 0;
        const editIndex = parseInt(document.getElementById('editIndex').value);
        const fileInput = document.getElementById('newAttachmentFile');

        const saveInvoiceObject = async (attachmentBase64 = null) => {
            const invoiceObj = {
                userId: currentUser,
                type: type,
                invoiceNo: document.getElementById('newInvoiceNo').value,
                clientName: document.getElementById('newClientName').value,
                contact: document.getElementById('newContact').value,
                category: document.getElementById('newCategory').value,
                currency: document.getElementById('newInvoiceCurrency').value,
                amount: amount,
                penalty: penalty,
                recurring: document.getElementById('newRecurring').value,
                issueDate: document.getElementById('newIssueDate').value,
                dueDate: document.getElementById('newDueDate').value,
                attachment: attachmentBase64 || (editIndex >= 0 && invoicesData[editIndex] ? invoicesData[editIndex].attachment : null),
                isHistory: false
            };

            if (editIndex >= 0 && invoicesData[editIndex].id) {
                await db.collection('invoices').doc(invoicesData[editIndex].id).update(invoiceObj);
                logAuditAction('Atualização', invoiceObj.invoiceNo, invoiceObj.clientName, `Modificou dados da fatura`);
                showToast('Registo atualizado com sucesso!', 'success');
            } else {
                await db.collection('invoices').add(invoiceObj);
                logAuditAction('Criação', invoiceObj.invoiceNo, invoiceObj.clientName, `Criou novo registo`);
                showToast('Fatura registada com sucesso!', 'success');
            }

            fetchUserData();
            document.getElementById('addInvoiceForm').reset();
            document.getElementById('addFormContainer').style.display = 'none';
        };

        if (fileInput.files && fileInput.files[0]) {
            const reader = new FileReader();
            reader.onload = function(evt) { saveInvoiceObject(evt.target.result); };
            reader.readAsDataURL(fileInput.files[0]);
        } else {
            await saveInvoiceObject();
        }
    });

    initCharts();
});

function toggleMobileSidebar() { document.getElementById('appSidebar').classList.toggle('mobile-open'); }

function showToast(message, type = 'success') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<i class="fa-solid ${type === 'success' ? 'fa-circle-check' : 'fa-circle-exclamation'}"></i> ${message}`;
    container.appendChild(toast);
    setTimeout(() => { toast.remove(); }, 3500);
}

function switchAuthMode(mode) {
    authMode = mode;
    document.getElementById('tabLoginBtn').classList.toggle('active', mode === 'login');
    document.getElementById('tabRegisterBtn').classList.toggle('active', mode === 'register');
    document.getElementById('registerFields').style.display = mode === 'register' ? 'block' : 'none';
    document.getElementById('authSubmitBtn').innerText = mode === 'register' ? 'Concluir Registo' : 'Entrar';
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
        } else {
            await auth.signInWithEmailAndPassword(email, password);
        }
    } catch (err) {
        errorEl.innerText = err.message;
    }
}

function logoutUser() { auth.signOut(); }
function showAuthScreen() {
    document.getElementById('authScreen').style.display = 'flex';
    document.getElementById('appContainer').style.display = 'none';
}

async function loadProfileAndApp(user) {
    const userDoc = await db.collection('users').doc(user.uid).get();
    currentProfile = userDoc.exists ? userDoc.data() : { companyName: user.email };
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
    teamData = [];

    snapshot.forEach(doc => {
        const data = { id: doc.id, ...doc.data() };
        if (data.isHistory) historyData.push(data);
        else invoicesData.push(data);
    });

    const teamSnap = await db.collection('team').where('userId', '==', currentUser).get();
    teamSnap.forEach(doc => teamData.push({ id: doc.id, ...doc.data() }));

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

async function logAuditAction(action, invoiceNo, clientName, details) {
    if (!currentUser) return;
    await db.collection('audit').add({
        userId: currentUser,
        action,
        invoiceNo,
        clientName,
        details,
        date: new Date().toISOString().split('T')[0]
    });
}

// ENVIO DE CONVITE AUTOMÁTICO VIA EMAILJS
async function inviteTeamMember() {
    const name = document.getElementById('newMemberName').value.trim();
    const email = document.getElementById('newMemberEmail').value.trim();
    const role = document.getElementById('newMemberRole').value;

    if (!name || !email) {
        showToast('Insira o nome e o email do colaborador.', 'error');
        return;
    }

    // 1. Guardar na base de dados com estado Pendente
    await db.collection('team').add({
        userId: currentUser,
        name,
        email,
        role,
        status: 'Pendente'
    });

    logAuditAction('Equipa', 'N/A', name, `Convidou ${email} como ${role}`);

    // 2. Parâmetros para o EmailJS
    const templateParams = {
        to_name: name,
        to_email: email,
        role: role,
        company_name: currentProfile ? currentProfile.companyName : 'Empresa',
        app_url: window.location.origin
    };

    // 3. Enviar email automático sem abrir janelas
    emailjs.send('O_TEU_SERVICE_ID', 'O_TEU_TEMPLATE_ID', templateParams)
        .then(function(response) {
            showToast('Convite enviado por email com sucesso!', 'success');
            fetchUserData();
        }, function(error) {
            showToast('Membro guardado, mas falhou o envio do email.', 'error');
            console.error('Erro EmailJS:', error);
        });

    document.getElementById('newMemberName').value = '';
    document.getElementById('newMemberEmail').value = '';
}

async function acceptTeamInvite(id) {
    await db.collection('team').doc(id).update({ status: 'Ativo' });
    showToast('Convite aceite com sucesso!', 'success');
    fetchUserData();
}

async function rejectTeamInvite(id) {
    await db.collection('team').doc(id).update({ status: 'Recusado' });
    showToast('Convite marcado como recusado.', 'error');
    fetchUserData();
}

async function deleteTeamMember(id) {
    if (confirm('Tem a certeza que deseja remover este membro?')) {
        await db.collection('team').doc(id).delete();
        showToast('Membro removido.', 'error');
        fetchUserData();
    }
}

function changeGlobalCurrency(curr) {
    currentCurrency = curr;
    localStorage.setItem(`payguard_currency_${currentUser}`, curr);
    processAndRender();
    showToast(`Moeda base alterada para ${curr}.`, 'success');
}

function formatMoney(amount, curr = currentCurrency) {
    return `${currencySymbols[curr] || '€'} ${amount.toLocaleString('pt-PT', {minimumFractionDigits: 2})}`;
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
    showToast('Definições atualizadas!', 'success');
}

function setPeriodFilter(period, btn) {
    currentPeriodFilter = period;
    document.querySelectorAll('.pill-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    processAndRender();
}

function switchViewMode(mode) {
    currentViewMode = mode;
    document.getElementById('btnViewTable').classList.toggle('active', mode === 'table');
    document.getElementById('btnViewKanban').classList.toggle('active', mode === 'kanban');
    renderTablesOrKanban();
}

function switchTab(tabName) {
    ['Despesas', 'Receber', 'Tesouraria', 'Equipa', 'Integracoes', 'Historico'].forEach(t => {
        const el = document.getElementById(`tab${t}`);
        const nav = document.getElementById(`nav${t}`);
        if (el) el.style.display = t.toLowerCase() === tabName.toLowerCase() ? 'block' : 'none';
        if (nav) nav.classList.toggle('active', t.toLowerCase() === tabName.toLowerCase());
    });
    document.getElementById('addFormContainer').style.display = 'none';
    if (tabName === 'tesouraria') updateCharts();
    if (tabName === 'historico') renderAuditLog();
    if (tabName === 'equipa') renderTeamTable();
    document.getElementById('appSidebar').classList.remove('mobile-open');
}

function openAddForm(type) {
    document.getElementById('addInvoiceForm').reset();
    document.getElementById('editIndex').value = -1;
    document.getElementById('newType').value = type;
    document.getElementById('penaltyGroup').style.display = type === 'pagar' ? 'block' : 'none';
    document.getElementById('formTitle').innerHTML = type === 'pagar' ? 'Registar Nova Despesa (A Pagar)' : 'Registar Nova Fatura a Receber';
    document.getElementById('addFormContainer').style.display = 'block';
    document.getElementById('addFormContainer').scrollIntoView({ behavior: 'smooth' });
}

function editInvoice(index) {
    const inv = invoicesData[index];
    if (!inv) return;
    document.getElementById('editIndex').value = index;
    document.getElementById('newType').value = inv.type;
    document.getElementById('newInvoiceNo').value = inv.invoiceNo;
    document.getElementById('newClientName').value = inv.clientName;
    document.getElementById('newContact').value = inv.contact;
    document.getElementById('newCategory').value = inv.category || 'Outros';
    document.getElementById('newAmount').value = inv.amount;
    document.getElementById('newIssueDate').value = inv.issueDate;
    document.getElementById('newDueDate').value = inv.dueDate;
    document.getElementById('newRecurring').value = inv.recurring || 'Nenhuma';
    document.getElementById('penaltyGroup').style.display = inv.type === 'pagar' ? 'block' : 'none';
    if (inv.type === 'pagar') document.getElementById('newPenalty').value = inv.penalty || 0;
    document.getElementById('addFormContainer').style.display = 'block';
    document.getElementById('addFormContainer').scrollIntoView({ behavior: 'smooth' });
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
    let totalReceive = 0, totalPay = 0, overdueReceiveCount = 0;
    let totalInvoiced = 0, totalCollected = 0;

    invoicesData.forEach(inv => {
        const due = new Date(inv.dueDate);
        const diffDays = Math.ceil((today - due) / (1000 * 60 * 60 * 24));
        let matchesPeriod = true;
        if (currentPeriodFilter === 'mes' && (due.getFullYear() !== today.getFullYear() || due.getMonth() !== today.getMonth())) matchesPeriod = false;
        if (currentPeriodFilter === '7dias' && (diffDays < -7 || diffDays > 0)) matchesPeriod = false;
        if (currentPeriodFilter === 'vencidos' && diffDays <= 0) matchesPeriod = false;
        inv.matchesPeriod = matchesPeriod;
        inv.matchesSearch = Object.values(inv).some(val => String(val).toLowerCase().includes(searchQuery));

        const baseConverted = convertCurrency(inv.amount, inv.currency || 'EUR', currentCurrency);
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
            if (matchesPeriod && inv.matchesSearch) totalReceive += convertCurrency(inv.totalWithInterest, inv.currency || 'EUR', currentCurrency);
        } else if (!inv.isHistory && inv.type === 'pagar') {
            inv.isPayDue = diffDays > 0;
            inv.payDueDays = diffDays > 0 ? diffDays : 0;
            inv.totalPayAmount = inv.amount + (inv.penalty || 0);
            if (matchesPeriod && inv.matchesSearch) totalPay += convertCurrency(inv.totalPayAmount, inv.currency || 'EUR', currentCurrency);
        }
    });

    historyData.forEach(h => {
        if (h.type === 'receber') totalCollected += convertCurrency(h.amount, h.currency || 'EUR', currentCurrency);
    });

    const collectionRate = totalInvoiced > 0 ? Math.round((totalCollected / (totalInvoiced + totalCollected)) * 100) : 0;
    document.getElementById('collectionRate').innerText = `${collectionRate}%`;
    document.getElementById('cashFlowProj').innerText = formatMoney(totalReceive - totalPay);
    document.getElementById('totalReceiveAmount').innerText = formatMoney(totalReceive);
    document.getElementById('overdueCount').innerText = `${overdueReceiveCount} faturas em atraso`;
    document.getElementById('totalPayAmount').innerText = formatMoney(totalPay);

    renderTablesOrKanban();
    updateCharts();
}

function renderTablesOrKanban() {
    const payContainer = document.getElementById('payContainerContent');
    const receiveContainer = document.getElementById('receiveContainerContent');
    const payItems = invoicesData.map((inv, idx) => ({ ...inv, originalIndex: idx })).filter(i => !i.isHistory && i.type === 'pagar' && i.matchesPeriod && i.matchesSearch);
    const receiveItems = invoicesData.map((inv, idx) => ({ ...inv, originalIndex: idx })).filter(i => !i.isHistory && i.type === 'receber' && i.matchesPeriod && i.matchesSearch);

    if (currentViewMode === 'table') {
        payContainer.innerHTML = `<div class="table-container"><table><thead><tr><th>Estado</th><th>Emissão</th><th>Ref</th><th>Fornecedor</th><th>Categoria</th><th>Valor</th><th>Limite</th><th>Ações</th></tr></thead><tbody id="payTableBody"></tbody></table></div>`;
        receiveContainer.innerHTML = `<div class="table-container"><table><thead><tr><th>Estado</th><th>Emissão</th><th>Fatura</th><th>Cliente</th><th>Categoria</th><th>Valor</th><th>Vencimento</th><th>Ações</th></tr></thead><tbody id="receiveTableBody"></tbody></table></div>`;

        const payTbody = document.getElementById('payTableBody');
        payItems.forEach(inv => {
            const tr = document.createElement('tr');
            tr.onclick = (e) => { if(!e.target.closest('button')) openDetailsModal(inv); };
            tr.innerHTML = `<td><span class="status-badge ${inv.isPayDue ? 'status-overdue' : 'status-ok'}">${inv.isPayDue ? 'Vencida' : 'Em Prazo'}</span></td><td>${inv.issueDate}</td><td><strong>${inv.invoiceNo}</strong></td><td>${inv.clientName}</td><td>${inv.category}</td><td><strong>${formatMoney(inv.totalPayAmount, inv.currency)}</strong></td><td>${inv.dueDate}</td><td><div class="action-buttons"><button type="button" class="btn-action" onclick="editInvoice(${inv.originalIndex})"><i class="fa-solid fa-pen"></i></button><button type="button" class="btn-action btn-pay" onclick="markAsLiquidated(${inv.originalIndex})"><i class="fa-solid fa-check"></i></button><button type="button" class="btn-action btn-delete" onclick="deleteInvoice(${inv.originalIndex})"><i class="fa-solid fa-trash"></i></button></div></td>`;
            payTbody.appendChild(tr);
        });

        const receiveTbody = document.getElementById('receiveTableBody');
        receiveItems.forEach(inv => {
            const tr = document.createElement('tr');
            tr.onclick = (e) => { if(!e.target.closest('button')) openDetailsModal(inv); };
            tr.innerHTML = `<td><span class="status-badge ${inv.isOverdue ? 'status-overdue' : 'status-ok'}">${inv.isOverdue ? 'Atraso' : 'Em Dia'}</span></td><td>${inv.issueDate}</td><td><strong>${inv.invoiceNo}</strong></td><td>${inv.clientName}</td><td>${inv.category}</td><td><strong>${formatMoney(inv.totalWithInterest || inv.amount, inv.currency)}</strong></td><td>${inv.dueDate}</td><td><div class="action-buttons"><button type="button" class="btn-action" onclick="editInvoice(${inv.originalIndex})"><i class="fa-solid fa-pen"></i></button><button type="button" class="btn-action btn-pay" onclick="markAsLiquidated(${inv.originalIndex})"><i class="fa-solid fa-check"></i></button>${inv.isOverdue ? `<button type="button" class="btn-action" onclick='openReceiveReminderModal(${JSON.stringify(inv)})'><i class="fa-solid fa-paper-plane"></i></button>` : ''}<button type="button" class="btn-action btn-delete" onclick="deleteInvoice(${inv.originalIndex})"><i class="fa-solid fa-trash"></i></button></div></td>`;
            receiveTbody.appendChild(tr);
        });
    } else {
        const renderKanban = (items, type) => `
            <div class="kanban-board">
                <div class="kanban-column"><h4>Em Prazo</h4><div class="kanban-cards">${items.filter(i => type==='pagar'? !i.isPayDue : !i.isOverdue).map(inv => `<div class="kanban-card" onclick='openDetailsModal(${JSON.stringify(inv)})'><div class="kanban-card-header"><span>${inv.invoiceNo}</span><span>${formatMoney(inv.amount, inv.currency)}</span></div><div class="kanban-card-body"><span><strong>${inv.clientName}</strong></span></div></div>`).join('') || '<p style="color:var(--text-muted)">Sem registos.</p>'}</div></div>
                <div class="kanban-column"><h4>Vencidas / Atraso</h4><div class="kanban-cards">${items.filter(i => type==='pagar'? i.isPayDue : i.isOverdue).map(inv => `<div class="kanban-card" onclick='openDetailsModal(${JSON.stringify(inv)})' style="border-left:4px solid var(--danger)"><div class="kanban-card-header"><span>${inv.invoiceNo}</span><span style="color:var(--danger)">${formatMoney(inv.amount, inv.currency)}</span></div><div class="kanban-card-body"><span><strong>${inv.clientName}</strong></span></div></div>`).join('') || '<p style="color:var(--text-muted)">Sem registos.</p>'}</div></div>
                <div class="kanban-column"><h4>Liquidadas</h4><div class="kanban-cards">${historyData.filter(h => h.type === type).map(inv => `<div class="kanban-card" style="opacity:0.7"><div class="kanban-card-header"><span>${inv.invoiceNo}</span><span>${formatMoney(inv.amount, inv.currency)}</span></div><div class="kanban-card-body"><span><strong>${inv.clientName}</strong></span></div></div>`).join('') || '<p style="color:var(--text-muted)">Sem histórico.</p>'}</div></div>
            </div>`;
        payContainer.innerHTML = renderKanban(payItems, 'pagar');
        receiveContainer.innerHTML = renderKanban(receiveItems, 'receber');
    }
}

async function renderTeamTable() {
    const tbody = document.getElementById('teamTableBody');
    tbody.innerHTML = '';
    teamData.forEach(m => {
        let badgeClass = 'status-overdue';
        if (m.status === 'Ativo') badgeClass = 'status-ok';
        else if (m.status === 'Recusado') badgeClass = 'status-overdue';

        tbody.innerHTML += `
            <tr>
                <td>${m.name}</td>
                <td>${m.email}</td>
                <td><strong>${m.role}</strong></td>
                <td><span class="status-badge ${badgeClass}">${m.status}</span></td>
                <td>
                    <div class="action-buttons">
                        ${m.status !== 'Ativo' ? `<button type="button" class="btn-action btn-pay" onclick="acceptTeamInvite('${m.id}')" title="Aceitar"><i class="fa-solid fa-check"></i></button>` : ''}
                        ${m.status !== 'Recusado' ? `<button type="button" class="btn-action btn-delete" onclick="rejectTeamInvite('${m.id}')" title="Recusar" style="background:#fee2e2; color:#dc2626;"><i class="fa-solid fa-xmark"></i></button>` : ''}
                        <button type="button" class="btn-action btn-delete" onclick="deleteTeamMember('${m.id}')" title="Remover"><i class="fa-solid fa-trash"></i></button>
                    </div>
                </td>
            </tr>`;
    });
}

async function renderAuditLog() {
    const tbody = document.getElementById('historyTableBody');
    tbody.innerHTML = '';
    const snap = await db.collection('audit').where('userId', '==', currentUser).get();
    snap.forEach(doc => {
        const d = doc.data();
        tbody.innerHTML += `<tr><td><strong>${d.action}</strong></td><td>${d.date}</td><td>${d.invoiceNo}</td><td>${d.clientName}</td><td>${d.details}</td><td>-</td></tr>`;
    });
}

function openDetailsModal(inv) {
    const modal = document.getElementById('detailsModal');
    const body = document.getElementById('detailsModalBody');
    const footer = document.getElementById('detailsModalFooter');
    const realIndex = invoicesData.findIndex(i => i.invoiceNo === inv.invoiceNo && i.clientName === inv.clientName);

    body.innerHTML = `
        <p><strong>Tipo:</strong> ${inv.type === 'pagar' ? 'Despesa' : 'A Receber'}</p>
        <p><strong>Ref:</strong> ${inv.invoiceNo}</p>
        <p><strong>Entidade:</strong> ${inv.clientName}</p>
        <p><strong>Contacto:</strong> ${inv.contact}</p>
        <p><strong>Categoria:</strong> ${inv.category}</p>
        <p><strong>Valor:</strong> ${formatMoney(inv.amount, inv.currency)}</p>
        <p><strong>Vencimento:</strong> ${inv.dueDate}</p>
        <p><strong>Recorrência:</strong> ${inv.recurring || 'Nenhuma'}</p>
        ${inv.attachment ? `<p style="margin-top:10px;"><a href="${inv.attachment}" target="_blank" class="btn-secondary"><i class="fa-solid fa-paperclip"></i> Ver Fatura Anexada</a></p>` : ''}
    `;
    footer.innerHTML = `<button type="button" class="btn-primary" onclick="editInvoice(${realIndex})"><i class="fa-solid fa-pen"></i> Editar</button><button type="button" class="btn-secondary" onclick="closeDetailsModal()">Fechar</button>`;
    modal.style.display = 'flex';
}
function closeDetailsModal() { document.getElementById('detailsModal').style.display = 'none'; }

function initCharts() {
    payChartInstance = new Chart(document.getElementById('payChart').getContext('2d'), { type: 'doughnut', data: { labels: ['Em Prazo', 'Vencidas'], datasets: [{ data: [0, 0], backgroundColor: ['#16a34a', '#dc2626'] }] }, options: { responsive: true, maintainAspectRatio: false } });
    receiveChartInstance = new Chart(document.getElementById('receiveChart').getContext('2d'), { type: 'doughnut', data: { labels: ['Em Dia', 'Em Atraso'], datasets: [{ data: [0, 0], backgroundColor: ['#16a34a', '#dc2626'] }] }, options: { responsive: true, maintainAspectRatio: false } });
    cashFlowLineChartInstance = new Chart(document.getElementById('cashFlowLineChart').getContext('2d'), { type: 'line', data: { labels: ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'], datasets: [{ label: 'Entradas', data: [0,0,0,0,0,0,0,0,3250,1800,0,0], borderColor: '#16a34a' }, { label: 'Saídas', data: [0,0,0,0,0,0,0,0,0,1200,0,0], borderColor: '#dc2626' }] }, options: { responsive: true, maintainAspectRatio: false } });
}

function updateCharts() {
    if (!payChartInstance || !receiveChartInstance) return;
    let payPrazo = 0, payVenc = 0, recDia = 0, recAtraso = 0;
    invoicesData.forEach(inv => {
        if (inv.isHistory || !inv.matchesPeriod) return;
        const converted = convertCurrency(inv.amount, inv.currency || 'EUR', currentCurrency);
        if (inv.type === 'pagar') { if (inv.isPayDue) payVenc += converted; else payPrazo += converted; }
        else { if (inv.isOverdue) recAtraso += converted; else recDia += converted; }
    });
    payChartInstance.data.datasets[0].data = [payPrazo, payVenc];
    payChartInstance.update();
    receiveChartInstance.data.datasets[0].data = [recDia, recAtraso];
    receiveChartInstance.update();
}

async function markAsLiquidated(index) {
    if (confirm('Marcar como liquidada?')) {
        const item = invoicesData.splice(index, 1)[0];
        item.isHistory = true;
        item.liquidationDate = new Date().toISOString().split('T')[0];
        if (item.id) await db.collection('invoices').doc(item.id).update({ isHistory: true, liquidationDate: item.liquidationDate });
        historyData.push(item);
        logAuditAction('Liquidação', item.invoiceNo, item.clientName, 'Liquidou fatura');
        processAndRender();
        showToast('Fatura liquidada com sucesso!', 'success');
    }
}

async function deleteInvoice(index) {
    if (confirm('Eliminar registo?')) {
        const item = invoicesData.splice(index, 1)[0];
        if (item.id) await db.collection('invoices').doc(item.id).delete();
        logAuditAction('Eliminação', item.invoiceNo, item.clientName, 'Eliminou registo');
        processAndRender();
        showToast('Registo eliminado.', 'error');
    }
}

function openReceiveReminderModal(inv) {
    activeReminderItem = inv;
    document.getElementById('modalClientName').innerText = inv.clientName;
    document.getElementById('modalClientContact').innerText = inv.contact;
    document.getElementById('reminderText').value = `Exmo(a). Sr(a). Gestor(a) da ${inv.clientName},\n\nA fatura nº ${inv.invoiceNo}, no valor de ${formatMoney(inv.amount, inv.currency)}, encontra-se em atraso. Agradecemos regularização.`;
    document.getElementById('reminderModal').style.display = 'flex';
}
function closeModal() { document.getElementById('reminderModal').style.display = 'none'; }
function copyReminderMessage() {
    navigator.clipboard.writeText(document.getElementById('reminderText').value);
    showToast('Mensagem copiada!', 'success');
}
function sendEmailReminder() {
    window.location.href = `mailto:${activeReminderItem.contact}?subject=Lembrete Fatura&body=${encodeURIComponent(document.getElementById('reminderText').value)}`;
}
function sendWhatsappReminder() {
    window.open(`https://wa.me/${activeReminderItem.contact.replace(/[^0-9+]/g, '')}?text=${encodeURIComponent(document.getElementById('reminderText').value)}`, '_blank');
}

function exportPdfReport(type) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const items = invoicesData.filter(i => !i.isHistory && i.type === type);
    doc.setFontSize(16);
    doc.text(`Relatório para Contabilista - PayGuard Pro`, 14, 20);
    doc.setFontSize(10);
    doc.text(`Empresa: ${currentProfile.companyName} | Data: ${new Date().toLocaleDateString('pt-PT')}`, 14, 28);
    let startY = 40;
    items.forEach(inv => {
        doc.text(`Ref: ${inv.invoiceNo} | Entidade: ${inv.clientName} | Valor: ${formatMoney(inv.amount, inv.currency)} | Vencimento: ${inv.dueDate}`, 14, startY);
        startY += 8;
    });
    doc.save(`relatorio_contabilidade_${type}.pdf`);
    showToast('Relatório PDF gerado!', 'success');
}

function exportContactList() {
    let csv = "Fatura,Cliente,Contacto,Valor\n";
    invoicesData.filter(i => !i.isHistory && i.type === 'receber' && i.isOverdue).forEach(i => { csv += `${i.invoiceNo},"${i.clientName}","${i.contact}",${i.amount}\n`; });
    const link = document.createElement("a");
    link.href = encodeURI("data:text/csv;charset=utf-8," + csv);
    link.download = "cobrancas_atraso.csv";
    link.click();
}
function exportPaymentsList() {
    let csv = "Ref,Fornecedor,Valor\n";
    invoicesData.filter(i => !i.isHistory && i.type === 'pagar').forEach(i => { csv += `${i.invoiceNo},"${i.clientName}",${i.amount}\n`; });
    const link = document.createElement("a");
    link.href = encodeURI("data:text/csv;charset=utf-8," + csv);
    link.download = "despesas.csv";
    link.click();
}
function exportBackupJson() {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify({ invoices: invoicesData, history: historyData, team: teamData }, null, 2));
    const dl = document.createElement('a');
    dl.setAttribute("href", dataStr);
    dl.setAttribute("download", `payguard_backup.json`);
    dl.click();
}
function importBackupJson(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async function(evt) {
        const parsed = JSON.parse(evt.target.result);
        if (parsed.invoices) {
            for (const inv of parsed.invoices) {
                delete inv.id;
                await db.collection('invoices').add({ ...inv, userId: currentUser });
            }
            fetchUserData();
            showToast('Backup restaurado!', 'success');
        }
    };
    reader.readAsText(file);
}
function handleFileUpload(e, defaultType) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async function(evt) {
        const data = new Uint8Array(evt.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const jsonRows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
        for (const [i, row] of jsonRows.entries()) {
            await db.collection('invoices').add({
                userId: currentUser,
                type: defaultType,
                invoiceNo: String(row.Ref || `IMP-${i+1}`),
                clientName: String(row.Entidade || 'Cliente'),
                contact: String(row.Contacto || 'geral@empresa.pt'),
                category: String(row.Categoria || 'Outros'),
                currency: 'EUR',
                amount: parseFloat(row.Valor || 0),
                dueDate: new Date().toISOString().split('T')[0],
                isHistory: false
            });
        }
        fetchUserData();
        showToast('Ficheiro importado com sucesso!', 'success');
    };
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
let teamData = [];
let payChartInstance = null;
let receiveChartInstance = null;
let cashFlowLineChartInstance = null;
let authMode = 'login';
let currentCurrency = 'EUR';
let currentPeriodFilter = 'todos';
let currentViewMode = 'table';
let activeReminderItem = null;

const currencySymbols = { EUR: '€', USD: '$', GBP: '£', BRL: 'R$', CHF: 'Fr' };
const exchangeToEur = { 'EUR': 1.0, 'USD': 0.92, 'GBP': 1.18, 'BRL': 0.17, 'CHF': 1.05 };

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
    { type: "pagar", invoiceNo: "FORN-2026-010", clientName: "Logística Global Lda", contact: "faturas@logisticaglobal.pt", category: "Fornecedores", currency: "EUR", amount: 1200.00, penalty: 0.00, issueDate: "2026-09-01", dueDate: "2026-10-15", recurring: "Nenhuma", isHistory: false },
    { type: "receber", invoiceNo: "FAC-2026-001", clientName: "Grossista Norte, Lda", contact: "geral@grossistanorte.pt", category: "Serviços", currency: "USD", amount: 1800.00, issueDate: "2026-08-10", dueDate: "2026-09-10", recurring: "Mensal", isHistory: false }
];

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('currentDateBadge').innerText = new Date().toLocaleDateString('pt-PT', { year: 'numeric', month: 'long', day: 'numeric' });

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

    document.getElementById('btnCancelForm').addEventListener('click', () => {
        document.getElementById('addFormContainer').style.display = 'none';
        document.getElementById('addInvoiceForm').reset();
    });

    document.getElementById('addInvoiceForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const type = document.getElementById('newType').value;
        const amount = parseFloat(document.getElementById('newAmount').value);
        const penalty = type === 'pagar' ? (parseFloat(document.getElementById('newPenalty').value) || 0) : 0;
        const editIndex = parseInt(document.getElementById('editIndex').value);
        const fileInput = document.getElementById('newAttachmentFile');

        const saveInvoiceObject = async (attachmentBase64 = null) => {
            const invoiceObj = {
                userId: currentUser,
                type: type,
                invoiceNo: document.getElementById('newInvoiceNo').value,
                clientName: document.getElementById('newClientName').value,
                contact: document.getElementById('newContact').value,
                category: document.getElementById('newCategory').value,
                currency: document.getElementById('newInvoiceCurrency').value,
                amount: amount,
                penalty: penalty,
                recurring: document.getElementById('newRecurring').value,
                issueDate: document.getElementById('newIssueDate').value,
                dueDate: document.getElementById('newDueDate').value,
                attachment: attachmentBase64 || (editIndex >= 0 && invoicesData[editIndex] ? invoicesData[editIndex].attachment : null),
                isHistory: false
            };

            if (editIndex >= 0 && invoicesData[editIndex].id) {
                await db.collection('invoices').doc(invoicesData[editIndex].id).update(invoiceObj);
                logAuditAction('Atualização', invoiceObj.invoiceNo, invoiceObj.clientName, `Modificou dados da fatura`);
                showToast('Registo atualizado com sucesso!', 'success');
            } else {
                await db.collection('invoices').add(invoiceObj);
                logAuditAction('Criação', invoiceObj.invoiceNo, invoiceObj.clientName, `Criou novo registo`);
                showToast('Fatura registada com sucesso!', 'success');
            }

            fetchUserData();
            document.getElementById('addInvoiceForm').reset();
            document.getElementById('addFormContainer').style.display = 'none';
        };

        if (fileInput.files && fileInput.files[0]) {
            const reader = new FileReader();
            reader.onload = function(evt) { saveInvoiceObject(evt.target.result); };
            reader.readAsDataURL(fileInput.files[0]);
        } else {
            await saveInvoiceObject();
        }
    });

    initCharts();
});

function toggleMobileSidebar() { document.getElementById('appSidebar').classList.toggle('mobile-open'); }

function showToast(message, type = 'success') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<i class="fa-solid ${type === 'success' ? 'fa-circle-check' : 'fa-circle-exclamation'}"></i> ${message}`;
    container.appendChild(toast);
    setTimeout(() => { toast.remove(); }, 3500);
}

function switchAuthMode(mode) {
    authMode = mode;
    document.getElementById('tabLoginBtn').classList.toggle('active', mode === 'login');
    document.getElementById('tabRegisterBtn').classList.toggle('active', mode === 'register');
    document.getElementById('registerFields').style.display = mode === 'register' ? 'block' : 'none';
    document.getElementById('authSubmitBtn').innerText = mode === 'register' ? 'Concluir Registo' : 'Entrar';
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
        } else {
            await auth.signInWithEmailAndPassword(email, password);
        }
    } catch (err) {
        errorEl.innerText = err.message;
    }
}

function logoutUser() { auth.signOut(); }
function showAuthScreen() {
    document.getElementById('authScreen').style.display = 'flex';
    document.getElementById('appContainer').style.display = 'none';
}

async function loadProfileAndApp(user) {
    const userDoc = await db.collection('users').doc(user.uid).get();
    currentProfile = userDoc.exists ? userDoc.data() : { companyName: user.email };
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
    teamData = [];

    snapshot.forEach(doc => {
        const data = { id: doc.id, ...doc.data() };
        if (data.isHistory) historyData.push(data);
        else invoicesData.push(data);
    });

    const teamSnap = await db.collection('team').where('userId', '==', currentUser).get();
    teamSnap.forEach(doc => teamData.push({ id: doc.id, ...doc.data() }));

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

async function logAuditAction(action, invoiceNo, clientName, details) {
    if (!currentUser) return;
    await db.collection('audit').add({
        userId: currentUser,
        action,
        invoiceNo,
        clientName,
        details,
        date: new Date().toISOString().split('T')[0]
    });
}

// ADICIONAR MEMBRO E COPIAR CONVITE INSTANTANEAMENTE PARA O CLIPBOARD
async function inviteTeamMember() {
    const name = document.getElementById('newMemberName').value.trim();
    const email = document.getElementById('newMemberEmail').value.trim();
    const role = document.getElementById('newMemberRole').value;

    if (!name || !email) {
        showToast('Insira o nome e o email do colaborador.', 'error');
        return;
    }

    // 1. Guarda na base de dados com estado Pendente
    await db.collection('team').add({
        userId: currentUser,
        name,
        email,
        role,
        status: 'Pendente'
    });

    logAuditAction('Equipa', 'N/A', name, `Convidou ${email} como ${role}`);

    // 2. Prepara a mensagem formatada com link e botões Sim/Não
    const companyName = currentProfile ? currentProfile.companyName : 'nossa empresa';
    const inviteMessage = `Olá ${name}!\n\nFoste convidado(a) como *${role}* para aceder à tesouraria da empresa *${companyName}* no PayGuard Pro.\n\n🔗 Acede aqui à plataforma: ${window.location.origin}\n\nPor favor, responde a esta mensagem:\n✅ *(Sim)* Aceitar Convite\n❌ *(Não)* Recusar Convite`;

    // Copia automaticamente para a área de transferência
    navigator.clipboard.writeText(inviteMessage).then(() => {
        showToast('Membro adicionado! Convite copiado para colar no chat.', 'success');
    }).catch(() => {
        showToast('Membro adicionado com sucesso!', 'success');
    });

    document.getElementById('newMemberName').value = '';
    document.getElementById('newMemberEmail').value = '';
    fetchUserData();
}

async function acceptTeamInvite(id) {
    await db.collection('team').doc(id).update({ status: 'Ativo' });
    showToast('Convite aceite! Utilizador ativo.', 'success');
    fetchUserData();
}

async function rejectTeamInvite(id) {
    await db.collection('team').doc(id).update({ status: 'Recusado' });
    showToast('Convite marcado como recusado.', 'error');
    fetchUserData();
}

async function deleteTeamMember(id) {
    if (confirm('Tem a certeza que deseja remover este membro?')) {
        await db.collection('team').doc(id).delete();
        showToast('Membro removido.', 'error');
        fetchUserData();
    }
}

function changeGlobalCurrency(curr) {
    currentCurrency = curr;
    localStorage.setItem(`payguard_currency_${currentUser}`, curr);
    processAndRender();
    showToast(`Moeda base alterada para ${curr}.`, 'success');
}

function formatMoney(amount, curr = currentCurrency) {
    return `${currencySymbols[curr] || '€'} ${amount.toLocaleString('pt-PT', {minimumFractionDigits: 2})}`;
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
    showToast('Definições atualizadas!', 'success');
}

function setPeriodFilter(period, btn) {
    currentPeriodFilter = period;
    document.querySelectorAll('.pill-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    processAndRender();
}

function switchViewMode(mode) {
    currentViewMode = mode;
    document.getElementById('btnViewTable').classList.toggle('active', mode === 'table');
    document.getElementById('btnViewKanban').classList.toggle('active', mode === 'kanban');
    renderTablesOrKanban();
}

function switchTab(tabName) {
    ['Despesas', 'Receber', 'Tesouraria', 'Equipa', 'Integracoes', 'Historico'].forEach(t => {
        const el = document.getElementById(`tab${t}`);
        const nav = document.getElementById(`nav${t}`);
        if (el) el.style.display = t.toLowerCase() === tabName.toLowerCase() ? 'block' : 'none';
        if (nav) nav.classList.toggle('active', t.toLowerCase() === tabName.toLowerCase());
    });
    document.getElementById('addFormContainer').style.display = 'none';
    if (tabName === 'tesouraria') updateCharts();
    if (tabName === 'historico') renderAuditLog();
    if (tabName === 'equipa') renderTeamTable();
    document.getElementById('appSidebar').classList.remove('mobile-open');
}

function openAddForm(type) {
    document.getElementById('addInvoiceForm').reset();
    document.getElementById('editIndex').value = -1;
    document.getElementById('newType').value = type;
    document.getElementById('penaltyGroup').style.display = type === 'pagar' ? 'block' : 'none';
    document.getElementById('formTitle').innerHTML = type === 'pagar' ? 'Registar Nova Despesa (A Pagar)' : 'Registar Nova Fatura a Receber';
    document.getElementById('addFormContainer').style.display = 'block';
    document.getElementById('addFormContainer').scrollIntoView({ behavior: 'smooth' });
}

function editInvoice(index) {
    const inv = invoicesData[index];
    if (!inv) return;
    document.getElementById('editIndex').value = index;
    document.getElementById('newType').value = inv.type;
    document.getElementById('newInvoiceNo').value = inv.invoiceNo;
    document.getElementById('newClientName').value = inv.clientName;
    document.getElementById('newContact').value = inv.contact;
    document.getElementById('newCategory').value = inv.category || 'Outros';
    document.getElementById('newAmount').value = inv.amount;
    document.getElementById('newIssueDate').value = inv.issueDate;
    document.getElementById('newDueDate').value = inv.dueDate;
    document.getElementById('newRecurring').value = inv.recurring || 'Nenhuma';
    document.getElementById('penaltyGroup').style.display = inv.type === 'pagar' ? 'block' : 'none';
    if (inv.type === 'pagar') document.getElementById('newPenalty').value = inv.penalty || 0;
    document.getElementById('addFormContainer').style.display = 'block';
    document.getElementById('addFormContainer').scrollIntoView({ behavior: 'smooth' });
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
    let totalReceive = 0, totalPay = 0, overdueReceiveCount = 0;
    let totalInvoiced = 0, totalCollected = 0;

    invoicesData.forEach(inv => {
        const due = new Date(inv.dueDate);
        const diffDays = Math.ceil((today - due) / (1000 * 60 * 60 * 24));
        let matchesPeriod = true;
        if (currentPeriodFilter === 'mes' && (due.getFullYear() !== today.getFullYear() || due.getMonth() !== today.getMonth())) matchesPeriod = false;
        if (currentPeriodFilter === '7dias' && (diffDays < -7 || diffDays > 0)) matchesPeriod = false;
        if (currentPeriodFilter === 'vencidos' && diffDays <= 0) matchesPeriod = false;
        inv.matchesPeriod = matchesPeriod;
        inv.matchesSearch = Object.values(inv).some(val => String(val).toLowerCase().includes(searchQuery));

        const baseConverted = convertCurrency(inv.amount, inv.currency || 'EUR', currentCurrency);
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
            if (matchesPeriod && inv.matchesSearch) totalReceive += convertCurrency(inv.totalWithInterest, inv.currency || 'EUR', currentCurrency);
        } else if (!inv.isHistory && inv.type === 'pagar') {
            inv.isPayDue = diffDays > 0;
            inv.payDueDays = diffDays > 0 ? diffDays : 0;
            inv.totalPayAmount = inv.amount + (inv.penalty || 0);
            if (matchesPeriod && inv.matchesSearch) totalPay += convertCurrency(inv.totalPayAmount, inv.currency || 'EUR', currentCurrency);
        }
    });

    historyData.forEach(h => {
        if (h.type === 'receber') totalCollected += convertCurrency(h.amount, h.currency || 'EUR', currentCurrency);
    });

    const collectionRate = totalInvoiced > 0 ? Math.round((totalCollected / (totalInvoiced + totalCollected)) * 100) : 0;
    document.getElementById('collectionRate').innerText = `${collectionRate}%`;
    document.getElementById('cashFlowProj').innerText = formatMoney(totalReceive - totalPay);
    document.getElementById('totalReceiveAmount').innerText = formatMoney(totalReceive);
    document.getElementById('overdueCount').innerText = `${overdueReceiveCount} faturas em atraso`;
    document.getElementById('totalPayAmount').innerText = formatMoney(totalPay);

    renderTablesOrKanban();
    updateCharts();
}

function renderTablesOrKanban() {
    const payContainer = document.getElementById('payContainerContent');
    const receiveContainer = document.getElementById('receiveContainerContent');
    const payItems = invoicesData.map((inv, idx) => ({ ...inv, originalIndex: idx })).filter(i => !i.isHistory && i.type === 'pagar' && i.matchesPeriod && i.matchesSearch);
    const receiveItems = invoicesData.map((inv, idx) => ({ ...inv, originalIndex: idx })).filter(i => !i.isHistory && i.type === 'receber' && i.matchesPeriod && i.matchesSearch);

    if (currentViewMode === 'table') {
        payContainer.innerHTML = `<div class="table-container"><table><thead><tr><th>Estado</th><th>Emissão</th><th>Ref</th><th>Fornecedor</th><th>Categoria</th><th>Valor</th><th>Limite</th><th>Ações</th></tr></thead><tbody id="payTableBody"></tbody></table></div>`;
        receiveContainer.innerHTML = `<div class="table-container"><table><thead><tr><th>Estado</th><th>Emissão</th><th>Fatura</th><th>Cliente</th><th>Categoria</th><th>Valor</th><th>Vencimento</th><th>Ações</th></tr></thead><tbody id="receiveTableBody"></tbody></table></div>`;

        const payTbody = document.getElementById('payTableBody');
        payItems.forEach(inv => {
            const tr = document.createElement('tr');
            tr.onclick = (e) => { if(!e.target.closest('button')) openDetailsModal(inv); };
            tr.innerHTML = `<td><span class="status-badge ${inv.isPayDue ? 'status-overdue' : 'status-ok'}">${inv.isPayDue ? 'Vencida' : 'Em Prazo'}</span></td><td>${inv.issueDate}</td><td><strong>${inv.invoiceNo}</strong></td><td>${inv.clientName}</td><td>${inv.category}</td><td><strong>${formatMoney(inv.totalPayAmount, inv.currency)}</strong></td><td>${inv.dueDate}</td><td><div class="action-buttons"><button type="button" class="btn-action" onclick="editInvoice(${inv.originalIndex})"><i class="fa-solid fa-pen"></i></button><button type="button" class="btn-action btn-pay" onclick="markAsLiquidated(${inv.originalIndex})"><i class="fa-solid fa-check"></i></button><button type="button" class="btn-action btn-delete" onclick="deleteInvoice(${inv.originalIndex})"><i class="fa-solid fa-trash"></i></button></div></td>`;
            payTbody.appendChild(tr);
        });

        const receiveTbody = document.getElementById('receiveTableBody');
        receiveItems.forEach(inv => {
            const tr = document.createElement('tr');
            tr.onclick = (e) => { if(!e.target.closest('button')) openDetailsModal(inv); };
            tr.innerHTML = `<td><span class="status-badge ${inv.isOverdue ? 'status-overdue' : 'status-ok'}">${inv.isOverdue ? 'Atraso' : 'Em Dia'}</span></td><td>${inv.issueDate}</td><td><strong>${inv.invoiceNo}</strong></td><td>${inv.clientName}</td><td>${inv.category}</td><td><strong>${formatMoney(inv.totalWithInterest || inv.amount, inv.currency)}</strong></td><td>${inv.dueDate}</td><td><div class="action-buttons"><button type="button" class="btn-action" onclick="editInvoice(${inv.originalIndex})"><i class="fa-solid fa-pen"></i></button><button type="button" class="btn-action btn-pay" onclick="markAsLiquidated(${inv.originalIndex})"><i class="fa-solid fa-check"></i></button>${inv.isOverdue ? `<button type="button" class="btn-action" onclick='openReceiveReminderModal(${JSON.stringify(inv)})'><i class="fa-solid fa-paper-plane"></i></button>` : ''}<button type="button" class="btn-action btn-delete" onclick="deleteInvoice(${inv.originalIndex})"><i class="fa-solid fa-trash"></i></button></div></td>`;
            receiveTbody.appendChild(tr);
        });
    } else {
        const renderKanban = (items, type) => `
            <div class="kanban-board">
                <div class="kanban-column"><h4>Em Prazo</h4><div class="kanban-cards">${items.filter(i => type==='pagar'? !i.isPayDue : !i.isOverdue).map(inv => `<div class="kanban-card" onclick='openDetailsModal(${JSON.stringify(inv)})'><div class="kanban-card-header"><span>${inv.invoiceNo}</span><span>${formatMoney(inv.amount, inv.currency)}</span></div><div class="kanban-card-body"><span><strong>${inv.clientName}</strong></span></div></div>`).join('') || '<p style="color:var(--text-muted)">Sem registos.</p>'}</div></div>
                <div class="kanban-column"><h4>Vencidas / Atraso</h4><div class="kanban-cards">${items.filter(i => type==='pagar'? i.isPayDue : i.isOverdue).map(inv => `<div class="kanban-card" onclick='openDetailsModal(${JSON.stringify(inv)})' style="border-left:4px solid var(--danger)"><div class="kanban-card-header"><span>${inv.invoiceNo}</span><span style="color:var(--danger)">${formatMoney(inv.amount, inv.currency)}</span></div><div class="kanban-card-body"><span><strong>${inv.clientName}</strong></span></div></div>`).join('') || '<p style="color:var(--text-muted)">Sem registos.</p>'}</div></div>
                <div class="kanban-column"><h4>Liquidadas</h4><div class="kanban-cards">${historyData.filter(h => h.type === type).map(inv => `<div class="kanban-card" style="opacity:0.7"><div class="kanban-card-header"><span>${inv.invoiceNo}</span><span>${formatMoney(inv.amount, inv.currency)}</span></div><div class="kanban-card-body"><span><strong>${inv.clientName}</strong></span></div></div>`).join('') || '<p style="color:var(--text-muted)">Sem histórico.</p>'}</div></div>
            </div>`;
        payContainer.innerHTML = renderKanban(payItems, 'pagar');
        receiveContainer.innerHTML = renderKanban(receiveItems, 'receber');
    }
}

async function renderTeamTable() {
    const tbody = document.getElementById('teamTableBody');
    tbody.innerHTML = '';
    teamData.forEach(m => {
        let badgeClass = 'status-overdue';
        if (m.status === 'Ativo') badgeClass = 'status-ok';
        else if (m.status === 'Recusado') badgeClass = 'status-overdue';

        tbody.innerHTML += `
            <tr>
                <td>${m.name}</td>
                <td>${m.email}</td>
                <td><strong>${m.role}</strong></td>
                <td><span class="status-badge ${badgeClass}">${m.status}</span></td>
                <td>
                    <div class="action-buttons">
                        ${m.status !== 'Ativo' ? `<button type="button" class="btn-action btn-pay" onclick="acceptTeamInvite('${m.id}')" title="Aceitar (Sim)"><i class="fa-solid fa-check"></i></button>` : ''}
                        ${m.status !== 'Recusado' ? `<button type="button" class="btn-action btn-delete" onclick="rejectTeamInvite('${m.id}')" title="Recusar (Não)" style="background:#fee2e2; color:#dc2626;"><i class="fa-solid fa-xmark"></i></button>` : ''}
                        <button type="button" class="btn-action btn-delete" onclick="deleteTeamMember('${m.id}')" title="Remover"><i class="fa-solid fa-trash"></i></button>
                    </div>
                </td>
            </tr>`;
    });
}

async function renderAuditLog() {
    const tbody = document.getElementById('historyTableBody');
    tbody.innerHTML = '';
    const snap = await db.collection('audit').where('userId', '==', currentUser).get();
    snap.forEach(doc => {
        const d = doc.data();
        tbody.innerHTML += `<tr><td><strong>${d.action}</strong></td><td>${d.date}</td><td>${d.invoiceNo}</td><td>${d.clientName}</td><td>${d.details}</td><td>-</td></tr>`;
    });
}

function openDetailsModal(inv) {
    const modal = document.getElementById('detailsModal');
    const body = document.getElementById('detailsModalBody');
    const footer = document.getElementById('detailsModalFooter');
    const realIndex = invoicesData.findIndex(i => i.invoiceNo === inv.invoiceNo && i.clientName === inv.clientName);

    body.innerHTML = `
        <p><strong>Tipo:</strong> ${inv.type === 'pagar' ? 'Despesa' : 'A Receber'}</p>
        <p><strong>Ref:</strong> ${inv.invoiceNo}</p>
        <p><strong>Entidade:</strong> ${inv.clientName}</p>
        <p><strong>Contacto:</strong> ${inv.contact}</p>
        <p><strong>Categoria:</strong> ${inv.category}</p>
        <p><strong>Valor:</strong> ${formatMoney(inv.amount, inv.currency)}</p>
        <p><strong>Vencimento:</strong> ${inv.dueDate}</p>
        <p><strong>Recorrência:</strong> ${inv.recurring || 'Nenhuma'}</p>
        ${inv.attachment ? `<p style="margin-top:10px;"><a href="${inv.attachment}" target="_blank" class="btn-secondary"><i class="fa-solid fa-paperclip"></i> Ver Fatura Anexada</a></p>` : ''}
    `;
    footer.innerHTML = `<button type="button" class="btn-primary" onclick="editInvoice(${realIndex})"><i class="fa-solid fa-pen"></i> Editar</button><button type="button" class="btn-secondary" onclick="closeDetailsModal()">Fechar</button>`;
    modal.style.display = 'flex';
}
function closeDetailsModal() { document.getElementById('detailsModal').style.display = 'none'; }

function initCharts() {
    payChartInstance = new Chart(document.getElementById('payChart').getContext('2d'), { type: 'doughnut', data: { labels: ['Em Prazo', 'Vencidas'], datasets: [{ data: [0, 0], backgroundColor: ['#16a34a', '#dc2626'] }] }, options: { responsive: true, maintainAspectRatio: false } });
    receiveChartInstance = new Chart(document.getElementById('receiveChart').getContext('2d'), { type: 'doughnut', data: { labels: ['Em Dia', 'Em Atraso'], datasets: [{ data: [0, 0], backgroundColor: ['#16a34a', '#dc2626'] }] }, options: { responsive: true, maintainAspectRatio: false } });
    cashFlowLineChartInstance = new Chart(document.getElementById('cashFlowLineChart').getContext('2d'), { type: 'line', data: { labels: ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'], datasets: [{ label: 'Entradas', data: [0,0,0,0,0,0,0,0,3250,1800,0,0], borderColor: '#16a34a' }, { label: 'Saídas', data: [0,0,0,0,0,0,0,0,0,1200,0,0], borderColor: '#dc2626' }] }, options: { responsive: true, maintainAspectRatio: false } });
}

function updateCharts() {
    if (!payChartInstance || !receiveChartInstance) return;
    let payPrazo = 0, payVenc = 0, recDia = 0, recAtraso = 0;
    invoicesData.forEach(inv => {
        if (inv.isHistory || !inv.matchesPeriod) return;
        const converted = convertCurrency(inv.amount, inv.currency || 'EUR', currentCurrency);
        if (inv.type === 'pagar') { if (inv.isPayDue) payVenc += converted; else payPrazo += converted; }
        else { if (inv.isOverdue) recAtraso += converted; else recDia += converted; }
    });
    payChartInstance.data.datasets[0].data = [payPrazo, payVenc];
    payChartInstance.update();
    receiveChartInstance.data.datasets[0].data = [recDia, recAtraso];
    receiveChartInstance.update();
}

async function markAsLiquidated(index) {
    if (confirm('Marcar como liquidada?')) {
        const item = invoicesData.splice(index, 1)[0];
        item.isHistory = true;
        item.liquidationDate = new Date().toISOString().split('T')[0];
        if (item.id) await db.collection('invoices').doc(item.id).update({ isHistory: true, liquidationDate: item.liquidationDate });
        historyData.push(item);
        logAuditAction('Liquidação', item.invoiceNo, item.clientName, 'Liquidou fatura');
        processAndRender();
        showToast('Fatura liquidada com sucesso!', 'success');
    }
}

async function deleteInvoice(index) {
    if (confirm('Eliminar registo?')) {
        const item = invoicesData.splice(index, 1)[0];
        if (item.id) await db.collection('invoices').doc(item.id).delete();
        logAuditAction('Eliminação', item.invoiceNo, item.clientName, 'Eliminou registo');
        processAndRender();
        showToast('Registo eliminado.', 'error');
    }
}

function openReceiveReminderModal(inv) {
    activeReminderItem = inv;
    document.getElementById('modalClientName').innerText = inv.clientName;
    document.getElementById('modalClientContact').innerText = inv.contact;
    document.getElementById('reminderText').value = `Exmo(a). Sr(a). Gestor(a) da ${inv.clientName},\n\nA fatura nº ${inv.invoiceNo}, no valor de ${formatMoney(inv.amount, inv.currency)}, encontra-se em atraso. Agradecemos regularização.`;
    document.getElementById('reminderModal').style.display = 'flex';
}
function closeModal() { document.getElementById('reminderModal').style.display = 'none'; }
function copyReminderMessage() {
    navigator.clipboard.writeText(document.getElementById('reminderText').value);
    showToast('Mensagem copiada!', 'success');
}
function sendEmailReminder() {
    window.location.href = `mailto:${activeReminderItem.contact}?subject=Lembrete Fatura&body=${encodeURIComponent(document.getElementById('reminderText').value)}`;
}
function sendWhatsappReminder() {
    window.open(`https://wa.me/${activeReminderItem.contact.replace(/[^0-9+]/g, '')}?text=${encodeURIComponent(document.getElementById('reminderText').value)}`, '_blank');
}

function exportPdfReport(type) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const items = invoicesData.filter(i => !i.isHistory && i.type === type);
    doc.setFontSize(16);
    doc.text(`Relatório para Contabilista - PayGuard Pro`, 14, 20);
    doc.setFontSize(10);
    doc.text(`Empresa: ${currentProfile.companyName} | Data: ${new Date().toLocaleDateString('pt-PT')}`, 14, 28);
    let startY = 40;
    items.forEach(inv => {
        doc.text(`Ref: ${inv.invoiceNo} | Entidade: ${inv.clientName} | Valor: ${formatMoney(inv.amount, inv.currency)} | Vencimento: ${inv.dueDate}`, 14, startY);
        startY += 8;
    });
    doc.save(`relatorio_contabilidade_${type}.pdf`);
    showToast('Relatório PDF gerado!', 'success');
}

function exportContactList() {
    let csv = "Fatura,Cliente,Contacto,Valor\n";
    invoicesData.filter(i => !i.isHistory && i.type === 'receber' && i.isOverdue).forEach(i => { csv += `${i.invoiceNo},"${i.clientName}","${i.contact}",${i.amount}\n`; });
    const link = document.createElement("a");
    link.href = encodeURI("data:text/csv;charset=utf-8," + csv);
    link.download = "cobrancas_atraso.csv";
    link.click();
}
function exportPaymentsList() {
    let csv = "Ref,Fornecedor,Valor\n";
    invoicesData.filter(i => !i.isHistory && i.type === 'pagar').forEach(i => { csv += `${i.invoiceNo},"${i.clientName}",${i.amount}\n`; });
    const link = document.createElement("a");
    link.href = encodeURI("data:text/csv;charset=utf-8," + csv);
    link.download = "despesas.csv";
    link.click();
}
function exportBackupJson() {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify({ invoices: invoicesData, history: historyData, team: teamData }, null, 2));
    const dl = document.createElement('a');
    dl.setAttribute("href", dataStr);
    dl.setAttribute("download", `payguard_backup.json`);
    dl.click();
}
function importBackupJson(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async function(evt) {
        const parsed = JSON.parse(evt.target.result);
        if (parsed.invoices) {
            for (const inv of parsed.invoices) {
                delete inv.id;
                await db.collection('invoices').add({ ...inv, userId: currentUser });
            }
            fetchUserData();
            showToast('Backup restaurado!', 'success');
        }
    };
    reader.readAsText(file);
}
function handleFileUpload(e, defaultType) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async function(evt) {
        const data = new Uint8Array(evt.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const jsonRows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
        for (const [i, row] of jsonRows.entries()) {
            await db.collection('invoices').add({
                userId: currentUser,
                type: defaultType,
                invoiceNo: String(row.Ref || `IMP-${i+1}`),
                clientName: String(row.Entidade || 'Cliente'),
                contact: String(row.Contacto || 'geral@empresa.pt'),
                category: String(row.Categoria || 'Outros'),
                currency: 'EUR',
                amount: parseFloat(row.Valor || 0),
                dueDate: new Date().toISOString().split('T')[0],
                isHistory: false
            });
        }
        fetchUserData();
        showToast('Ficheiro importado com sucesso!', 'success');
    };
    reader.readAsArrayBuffer(file);
}}
