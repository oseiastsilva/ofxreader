let transactions = [];
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
    reader.onload = function(e) {
        try {
            const content = e.target.result;
            parseOFX(content);
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

function parseOFX(content) {
    // Remove cabeçalho XML se existir
    content = content.replace(/<\?xml.*?\?>/, '');
    
    // Extrai as transações
    const transactionRegex = /<STMTTRN>([\s\S]*?)<\/STMTTRN>/g;
    transactions = []; // Limpa array anterior e atribui globalmente
    let match;

    while ((match = transactionRegex.exec(content)) !== null) {
        const transaction = {};
        const transactionContent = match[1];

        // Extrai data
        const dateMatch = transactionContent.match(/<DTPOSTED>(\d{8})/);
        if (dateMatch) {
            const date = dateMatch[1];
            transaction.date = `${date.substring(0, 4)}-${date.substring(4, 6)}-${date.substring(6, 8)}`;
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
