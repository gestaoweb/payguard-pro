// CONFIGURAÇÃO DO FIREBASE
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

let isLoginMode = true;
let financialChart = null;

document.addEventListener("DOMContentLoaded", () => {
    const authScreen = document.getElementById("authScreen");
    const appDashboard = document.getElementById("appDashboard");
    const tabLogin = document.getElementById("tabLogin");
    const tabRegister = document.getElementById("tabRegister");
    const authForm = document.getElementById("authForm");
    const btnSubmit = document.getElementById("btnSubmit");
    const authSubtitle = document.getElementById("authSubtitle");
    const registerFields = document.getElementById("registerFields");
    const btnLogout = document.getElementById("btnLogout");
    const userEmailDisplay = document.getElementById("userEmailDisplay");
    const sidebarCompanyName = document.getElementById("sidebarCompanyName");

    const invoiceModal = document.getElementById("invoiceModal");
    const btnNewInvoice = document.getElementById("btnNewInvoice");
    const closeModal = document.querySelector(".close-modal");
    const invoiceForm = document.getElementById("invoiceForm");

    // 1. ALTERNAR MODO LOGIN / REGISTO
    tabLogin.addEventListener("click", () => {
        isLoginMode = true;
        tabLogin.classList.add("active");
        tabRegister.classList.remove("active");
        btnSubmit.textContent = "Entrar";
        authSubtitle.textContent = "Aceda à sua conta financeira";
        registerFields.style.display = "none";
        
        // Remover obrigatoriedade dos campos de registo ao fazer login
        document.getElementById("companyName").removeAttribute("required");
        document.getElementById("companyNif").removeAttribute("required");
    });

    tabRegister.addEventListener("click", () => {
        isLoginMode = false;
        tabRegister.classList.add("active");
        tabLogin.classList.remove("active");
        btnSubmit.textContent = "Criar Conta";
        authSubtitle.textContent = "Crie a sua nova conta empresarial";
        registerFields.style.display = "block";
        
        // Adicionar obrigatoriedade ao criar conta
        document.getElementById("companyName").setAttribute("required", "true");
        document.getElementById("companyNif").setAttribute("required", "true");
    });

    // 2. SUBMETER AUTENTICAÇÃO (LOGIN OU REGISTO)
    authForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const email = document.getElementById("authEmail").value;
        const password = document.getElementById("authPassword").value;

        btnSubmit.disabled = true;
        btnSubmit.textContent = "A processar...";

        try {
            if (isLoginMode) {
                await auth.signInWithEmailAndPassword(email, password);
            } else {
                const companyName = document.getElementById("companyName").value;
                const companyNif = document.getElementById("companyNif").value;
                const userName = document.getElementById("userName").value;

                // Criar utilizador no Auth
                const userCredential = await auth.createUserWithEmailAndPassword(email, password);
                const user = userCredential.user;

                // Guardar dados adicionais na coleção 'users'
                await db.collection("users").doc(user.uid).set({
                    companyName: companyName,
                    nif: companyNif,
                    name: userName,
                    email: email,
                    createdAt: firebase.firestore.FieldValue.serverTimestamp()
                });

                alert("Conta empresarial criada com sucesso!");
            }
        } catch (error) {
            alert("Erro: " + error.message);
        } finally {
            btnSubmit.disabled = false;
            btnSubmit.textContent = isLoginMode ? "Entrar" : "Criar Conta";
        }
    });

    // 3. MONITORIZAR SESSÃO
    auth.onAuthStateChanged(async (user) => {
        if (user) {
            authScreen.style.display = "none";
            appDashboard.style.display = "flex";
            userEmailDisplay.textContent = user.email;

            // Buscar dados da empresa do Firestore para exibir no painel
            try {
                const userDoc = await db.collection("users").doc(user.uid).get();
                if (userDoc.exists) {
                    const userData = userDoc.data();
                    if (userData.companyName) {
                        sidebarCompanyName.textContent = userData.companyName;
                    }
                }
            } catch (err) {
                console.error("Erro ao buscar dados do utilizador:", err);
            }

            loadInvoices(user.uid);
        } else {
            authScreen.style.display = "flex";
            appDashboard.style.display = "none";
        }
    });

    btnLogout.addEventListener("click", () => auth.signOut());

    // 4. MODAL DE FATURAS
    btnNewInvoice.addEventListener("click", () => invoiceModal.style.display = "flex");
    closeModal.addEventListener("click", () => invoiceModal.style.display = "none");

    invoiceForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const user = auth.currentUser;
        if (!user) return;

        const newInvoice = {
            userId: user.uid,
            client: document.getElementById("clientName").value,
            amount: parseFloat(document.getElementById("invoiceAmount").value),
            currency: document.getElementById("invoiceCurrency").value,
            dueDate: document.getElementById("dueDate").value,
            status: document.getElementById("invoiceStatus").value,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        };

        try {
            await db.collection("invoices").add(newInvoice);
            invoiceModal.style.display = "none";
            invoiceForm.reset();
            loadInvoices(user.uid);
        } catch (err) {
            alert("Erro ao guardar fatura: " + err.message);
        }
    });
});

// 5. CARREGAR FATURAS E ESTATÍSTICAS
async function loadInvoices(userId) {
    const tableBody = document.getElementById("invoiceTableBody");
    tableBody.innerHTML = "<tr><td colspan='6'>A carregar dados...</td></tr>";

    try {
        const snapshot = await db.collection("invoices")
            .where("userId", "==", userId)
            .get();

        let overdue = 0, pending = 0, paid = 0;
        tableBody.innerHTML = "";

        if (snapshot.empty) {
            tableBody.innerHTML = "<tr><td colspan='6'>Nenhuma fatura registada.</td></tr>";
            updateKPIs(0, 0, 0);
            renderChart(0, 0, 0);
            return;
        }

        snapshot.forEach(doc => {
            const data = doc.data();
            const val = data.amount || 0;

            if (data.status === "Em Atraso") overdue += val;
            else if (data.status === "Pendente") pending += val;
            else if (data.status === "Pago") paid += val;

            const row = document.createElement("tr");
            const tagClass = data.status === "Em Atraso" ? "atraso" : data.status === "Pendente" ? "pendente" : "pago";

            row.innerHTML = `
                <td><strong>${data.client}</strong></td>
                <td>${val.toFixed(2)}</td>
                <td>${data.currency}</td>
                <td>${data.dueDate}</td>
                <td><span class="status-tag ${tagClass}">${data.status}</span></td>
                <td><button onclick="deleteInvoice('${doc.id}')" style="border:none; background:none; color:#ef4444; cursor:pointer;"><i class="fa-solid fa-trash"></i></button></td>
            `;
            tableBody.appendChild(row);
        });

        updateKPIs(overdue, pending, paid);
        renderChart(overdue, pending, paid);

    } catch (err) {
        console.error("Erro ao carregar faturas:", err);
    }
}

function updateKPIs(overdue, pending, paid) {
    document.getElementById("kpiOverdue").textContent = overdue.toFixed(2) + " €";
    document.getElementById("kpiPending").textContent = pending.toFixed(2) + " €";
    document.getElementById("kpiPaid").textContent = paid.toFixed(2) + " €";
}

function renderChart(overdue, pending, paid) {
    const ctx = document.getElementById("financialChart").getContext("2d");
    if (financialChart) financialChart.destroy();

    financialChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Em Atraso', 'Pendente', 'Pago'],
            datasets: [{
                data: [overdue, pending, paid],
                backgroundColor: ['#ef4444', '#f59e0b', '#10b981']
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false
        }
    });
}

async function deleteInvoice(docId) {
    if (confirm("Tens a certeza que queres eliminar esta fatura?")) {
        await db.collection("invoices").doc(docId).delete();
        const user = auth.currentUser;
        if (user) loadInvoices(user.uid);
    }
}
