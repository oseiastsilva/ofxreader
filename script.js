let transactions = [];
let accountInfo = {
    bankName: null,
    branchNumber: null,
    accountNumber: null,
    accountType: null,
    saldoInicial: null,
    saldoFinal: null,
    startDate: null,
    endDate: null,
    moeda: "BRL"
};
const loadingElement = document.getElementById('loading');

document.getElementById('fileInput').addEventListener('change', handleFileSelect);
document.getElementById('exportExcel').addEventListener('click', exportToExcel);
document.getElementById('exportCSV').addEventListener('click', exportToCSV);
document.getElementById('exportPDF').addEventListener('click', exportToPDF);

function showLoading() {
    loadingElement.classList.add('active');
}

function hideLoading() {
    loadingElement.classList.remove('active');
}

function handleFileSelect(event) {
    const file = event.target.files[0];
    if (!file) return;

    showLoading();
    
    const reader = new FileReader();
    reader.onload = async function(e) {
        try {
            const content = e.target.result;
            await parseOFX(content);
        } catch (error) {
            console.error("Erro ao processar o arquivo:", error);
            alert("Ocorreu um erro ao processar o arquivo OFX. Verifique se o formato é válido.");
        } finally {
            hideLoading();
        }
    };
    
    reader.onerror = function() {
        alert("Erro ao ler o arquivo. Verifique se o arquivo é válido.");
        hideLoading();
    };
    
    // Tentamos com diferentes codificações para encontrar a melhor
    try {
        reader.readAsText(file, 'ISO-8859-1'); // Latin1 para suportar acentos e caracteres especiais
    } catch (error) {
        reader.readAsText(file); // Fallback para UTF-8
    }
}

async function parseOFX(content) {
    // Remove cabeçalho XML se existir
    content = content.replace(/<\?xml.*?\?>/, '');
    
    // Extrai informações da conta
    await extractAccountInfo(content);
    
    // Extrai as transações
    const transactionRegex = /<STMTTRN>([\s\S]*?)<\/STMTTRN>/g;
    transactions = []; // Limpa array anterior
    let match;

    while ((match = transactionRegex.exec(content)) !== null) {
        const transaction = {};
        const transactionContent = match[1];

        // Extrai data
        const dateMatch = transactionContent.match(/<DTPOSTED>(\d{8})/);
        if (dateMatch) {
            const date = dateMatch[1];
            transaction.date = `${date.substring(6, 8)}/${date.substring(4, 6)}/${date.substring(0, 4)}`;
        }

        // Extrai valor
        const amountMatch = transactionContent.match(/<TRNAMT>([-\d.]+)/);
        if (amountMatch) {
            transaction.amount = parseFloat(amountMatch[1]);
        }

        // Extrai descrição
        const memoMatch = transactionContent.match(/<MEMO>([^<]+)/);
        if (memoMatch) {
            // Trata caracteres especiais
            let description = memoMatch[1];
            // Converte possíveis códigos HTML/XML para caracteres normais
            description = description.replace(/&amp;/g, '&')
                                   .replace(/&lt;/g, '<')
                                   .replace(/&gt;/g, '>')
                                   .replace(/&quot;/g, '"')
                                   .replace(/&#39;/g, "'");
            transaction.description = description;
        } else {
            // Tenta obter a descrição pelo campo NAME se não houver MEMO
            const nameMatch = transactionContent.match(/<NAME>([^<]+)/);
            if (nameMatch) {
                let description = nameMatch[1];
                description = description.replace(/&amp;/g, '&')
                                       .replace(/&lt;/g, '<')
                                       .replace(/&gt;/g, '>')
                                       .replace(/&quot;/g, '"')
                                       .replace(/&#39;/g, "'");
                transaction.description = description;
            } else {
                transaction.description = "Descrição não disponível";
            }
        }

        // Extrai forma de pagamento a partir da descrição ou de outros campos
        transaction.paymentMethod = determinePaymentMethod(transactionContent, transaction.description);

        // Determina o tipo de transação
        transaction.type = transaction.amount >= 0 ? 'Crédito' : 'Débito';

        transactions.push(transaction);
    }

    if (transactions.length === 0) {
        alert("Não foi possível encontrar transações no arquivo. Verifique se é um arquivo OFX válido.");
    }

    displayTransactions(transactions);
    displayAccountInfo();
}

async function extractAccountInfo(content) {
    // Extrai nome do banco
    const bankNameMatch = content.match(/<BANKID>([^<]+)/);
    if (bankNameMatch) {
        accountInfo.bankName = await getBankName(bankNameMatch[1]);
    }

    // Extrai agência
    const branchMatch = content.match(/<BRANCHID>([^<]+)/);
    if (branchMatch) {
        accountInfo.branchNumber = branchMatch[1];
    }

    // Extrai conta
    const accountMatch = content.match(/<ACCTID>([^<]+)/);
    if (accountMatch) {
        accountInfo.accountNumber = accountMatch[1];
    }

    // Extrai tipo de conta
    const accountTypeMatch = content.match(/<ACCTTYPE>([^<]+)/);
    if (accountTypeMatch) {
        accountInfo.accountType = getAccountType(accountTypeMatch[1]);
    }

    // Extrai datas do extrato
    const startDateMatch = content.match(/<DTSTART>(\d{8})/);
    if (startDateMatch) {
        const date = startDateMatch[1];
        accountInfo.startDate = `${date.substring(6, 8)}/${date.substring(4, 6)}/${date.substring(0, 4)}`;
    }

    const endDateMatch = content.match(/<DTEND>(\d{8})/);
    if (endDateMatch) {
        const date = endDateMatch[1];
        accountInfo.endDate = `${date.substring(6, 8)}/${date.substring(4, 6)}/${date.substring(0, 4)}`;
    }

    // Extrai saldo inicial e final
    const ledgerBalanceMatch = content.match(/<LEDGERBAL>[\s\S]*?<BALAMT>([-\d.]+)<\/BALAMT>/);
    if (ledgerBalanceMatch) {
        accountInfo.saldoFinal = parseFloat(ledgerBalanceMatch[1]);
    }

    const availableBalanceMatch = content.match(/<AVAILBAL>[\s\S]*?<BALAMT>([-\d.]+)<\/BALAMT>/);
    if (availableBalanceMatch) {
        accountInfo.saldoInicial = parseFloat(availableBalanceMatch[1]);
    }

    // Extrai moeda
    const currencyMatch = content.match(/<CURDEF>([A-Z]{3})<\/CURDEF>/);
    if (currencyMatch) {
        accountInfo.moeda = currencyMatch[1];
    }
}

async function getBankName(bankId) {
    try {
        const response = await fetch('/bancos_brasil.json');
        const bancos = await response.json();
        
        // Procura o banco pelo código no arquivo bancos_brasil.json
        const banco = bancos.find(b => b.valor === bankId);
        if (banco) {
            return banco.nome_reduzido;
        }
        
        return `Banco ${bankId}`;
    } catch (error) {
        console.error('Erro ao carregar bancos_brasil.json:', error);
        return `Banco ${bankId}`;
    }
}

function getAccountType(type) {
    const tipos = {
        'CHECKING': 'Conta Corrente',
        'SAVINGS': 'Conta Poupança',
        'MONEYMRKT': 'Conta Investimento',
        'CREDITLINE': 'Linha de Crédito',
        // Adicione mais tipos conforme necessário
    };
    return tipos[type] || type;
}

function determinePaymentMethod(transactionContent, description) {
    // Verifica o campo de código de transação/tipo se disponível
    const transTypeMatch = transactionContent.match(/<TRNTYPE>([^<]+)/);
    let transType = transTypeMatch ? transTypeMatch[1].toUpperCase() : "";
    
    // Patterns para identificar métodos de pagamento comuns
    const patterns = {
        PIX: /\bPIX\b|\bTRANSF\b.*?\bPIX\b|\bPAG\b.*?\bPIX\b/i,
        BOLETO: /\bBOLETO\b|\bPGTO\s+BOLETO\b|\bCOBRANÇA\b/i,
        TRANSFERENCIA: /\bTED\b|\bDOC\b|\bTRANSF\b|\bTRANSFERENCIA\b/i,
        DEPOSITO: /\bDEPOSITO\b|\bCREDITO\b/i,
        SAQUE: /\bSAQUE\b|\bRETIRADA\b/i,
        PAGAMENTO: /\bPAGAMENTO\b|\bPGTO\b|\bPAG\b/i,
        DEBITO: /\bDEBITO\b|\bDÉBITO\b|\bCOMPRA\s+DÉBITO\b/i,
        CREDITO: /\bCREDITO\b|\bCRÉDITO\b|\bCOMPRA\s+CRÉDITO\b/i,
        "DÉBITO AUTOMÁTICO": /\bDEB\s*AUT\b|\bDEBITO\s*AUTOMATICO\b|\bDÉBITO\s*AUTOMÁTICO\b|\bCOBRANÇA\s*AUTOMATICA\b|\bASSINATURA\b|\bMENSALIDADE\b|\bSERVIÇO\s+DIGITAL\b|\bSERVICO\s+DIGITAL\b|\bFATURA\b|\bCONTA\s+DE\s+(LUZ|AGUA|GAS|TELEFONE|INTERNET|ENERGIA)/i
    };

    // Checa a descrição contra os padrões
    for (const [method, pattern] of Object.entries(patterns)) {
        if (pattern.test(description)) {
            return method;
        }
    }

    // Se não encontrou nos padrões, tenta derivar do tipo de transação
    if (transType === "CREDIT" || transType === "DEP" || transType === "XFER") {
        return "CRÉDITO";
    } else if (transType === "DEBIT" || transType === "PAYMENT" || transType === "ATM") {
        return "DÉBITO";
    } else if (transType === "CHECK") {
        return "CHEQUE";
    } else if (transType === "DIRECTDEBIT" || transType === "DIRECTDEP") {
        return "DÉBITO AUTOMÁTICO";
    }

    // Padrões para identificar empresas comuns de débito automático e serviços por assinatura
    const debitoAutomaticoPadroes = [
        /NETFLIX/i, /SPOTIFY/i, /AMAZON/i, /PRIME/i, /DISNEY/i, /HBO/i, /YOUTUBE/i,
        /TELECOMUNICAC/i, /TELECOM/i, /CLARO/i, /VIVO/i, /TIM/i, /NET/i, /OI/i,
        /ELETROPAULO/i, /SABESP/i, /COMGAS/i, /CPFL/i, /CEMIG/i, /COPEL/i, /LIGHT/i, /ENEL/i,
        /CONDOMINIO/i, /SEGURO/i, /PREVIDENCIA/i, /PLANO\s+DE\s+SAUDE/i, /CONVENIO/i, /UNIMED/i, /AMIL/i,
        /MENSALIDADE/i, /ANUIDADE/i, /ASSINATURA/i, /SERVICO\s+DIGITAL/i, /SERVIÇO\s+DIGITAL/i
    ];

    // Verifica se é um pagamento recorrente conhecido
    for (const pattern of debitoAutomaticoPadroes) {
        if (pattern.test(description)) {
            return "DÉBITO AUTOMÁTICO";
        }
    }

    // Verifica se é um débito com valor negativo sem nenhuma outra classificação clara
    // Muitos débitos automáticos têm essa característica
    if (transType === "DEBIT" || description.includes("DEB") || description.includes("TARIFA") || description.includes("COBRANÇA")) {
        return "DÉBITO AUTOMÁTICO";
    }

    // Se não conseguiu determinar
    return "Não identificado";
}

function displayAccountInfo() {
    // Atualiza os elementos HTML com as informações da conta
    document.getElementById('bankName').textContent = accountInfo.bankName || '-';
    document.getElementById('branchNumber').textContent = accountInfo.branchNumber || '-';
    document.getElementById('accountNumber').textContent = accountInfo.accountNumber || '-';
    document.getElementById('accountType').textContent = accountInfo.accountType || '-';
    
    const formatCurrency = (value) => {
        if (value === null) return '-';
        return value.toLocaleString('pt-BR', { style: 'currency', currency: accountInfo.moeda });
    };

    document.getElementById('previousBalance').textContent = formatCurrency(accountInfo.saldoInicial);
    document.getElementById('finalBalance').textContent = formatCurrency(accountInfo.saldoFinal);
    
    const period = accountInfo.startDate && accountInfo.endDate 
        ? `${accountInfo.startDate} a ${accountInfo.endDate}`
        : '-';
    document.getElementById('statementPeriod').textContent = period;
}

function displayTransactions(transactions) {
    const tbody = document.getElementById('transactionsTable');
    tbody.innerHTML = '';

    if (transactions.length === 0) {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td colspan="5" class="px-6 py-4 text-center text-sm text-gray-500">
                Nenhuma transação encontrada. Carregue um arquivo OFX válido.
            </td>
        `;
        tbody.appendChild(row);
        return;
    }

    transactions.forEach(transaction => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${transaction.date}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${transaction.description}</td>
            <td class="px-6 py-4 whitespace-nowrap text-sm ${transaction.amount >= 0 ? 'text-green-600' : 'text-red-600'}">
                ${transaction.amount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm ${transaction.type === 'Crédito' ? 'text-green-600' : 'text-red-600'}">
                ${transaction.type}
            </td>
            <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${transaction.paymentMethod}</td>
        `;
        tbody.appendChild(row);
    });
}

function exportToExcel() {
    if (transactions.length === 0) {
        alert('Nenhuma transação para exportar. Carregue um arquivo OFX primeiro.');
        return;
    }

    try {
        // Cria dados formatados para exportação
        const exportData = transactions.map(t => ({
            "Data": t.date,
            "Descrição": t.description,
            "Valor": t.amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 }),
            "Tipo": t.type,
            "Forma de Pagamento": t.paymentMethod
        }));

        const ws = XLSX.utils.json_to_sheet(exportData);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Transações");
        XLSX.writeFile(wb, "transacoes.xlsx");
    } catch (error) {
        console.error("Erro ao exportar para Excel:", error);
        alert("Ocorreu um erro ao exportar para Excel. Tente novamente.");
    }
}

function exportToCSV() {
    if (transactions.length === 0) {
        alert('Nenhuma transação para exportar. Carregue um arquivo OFX primeiro.');
        return;
    }

    try {
        const headers = ['Data', 'Descrição', 'Valor', 'Tipo', 'Forma de Pagamento'];
        
        // Dados das transações
        const transactionRows = transactions.map(t => [
            t.date,
            `"${t.description.replace(/"/g, '""')}"`, // Escapa aspas duplas dentro do texto
            t.amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 }),
            t.type,
            t.paymentMethod
        ]);
        
        const csvContent = [
            headers.join(','),
            ...transactionRows.map(row => row.join(','))
        ].join('\n');

        const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' }); // BOM para UTF-8
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = 'transacoes.csv';
        link.click();
    } catch (error) {
        console.error("Erro ao exportar para CSV:", error);
        alert("Ocorreu um erro ao exportar para CSV. Tente novamente.");
    }
}

function exportToPDF() {
    if (transactions.length === 0) {
        alert('Nenhuma transação para exportar. Carregue um arquivo OFX primeiro.');
        return;
    }

    try {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();

        // Adiciona informações da conta
        doc.setFontSize(14);
        doc.text("Informações da Conta", 14, 15);
        doc.setFontSize(10);
        
        const saldoAnterior = accountInfo.saldoInicial !== null ? 
            accountInfo.saldoInicial.toLocaleString('pt-BR', { style: 'currency', currency: accountInfo.moeda }) : 
            "Não disponível";
        const saldoFinal = accountInfo.saldoFinal !== null ? 
            accountInfo.saldoFinal.toLocaleString('pt-BR', { style: 'currency', currency: accountInfo.moeda }) : 
            "Não disponível";
            
        doc.text(`Saldo Anterior: ${saldoAnterior}`, 14, 25);
        doc.text(`Saldo Final: ${saldoFinal}`, 14, 32);
        
        // Adiciona a tabela de transações
        doc.setFontSize(14);
        doc.text("Transações", 14, 42);
        
        const tableData = transactions.map(t => [
            t.date,
            t.description,
            t.amount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }),
            t.type,
            t.paymentMethod
        ]);

        doc.autoTable({
            startY: 45,
            head: [['Data', 'Descrição', 'Valor', 'Tipo', 'Forma de Pagamento']],
            body: tableData,
            theme: 'grid',
            headStyles: { fillColor: [66, 66, 66] },
            styles: { fontSize: 8 },
            columnStyles: {
                0: { cellWidth: 25 },
                1: { cellWidth: 60 },
                2: { cellWidth: 30 },
                3: { cellWidth: 20 },
                4: { cellWidth: 35 }
            }
        });

        doc.save('transacoes.pdf');
    } catch (error) {
        console.error("Erro ao exportar para PDF:", error);
        alert("Ocorreu um erro ao exportar para PDF. Tente novamente.");
    }
} 