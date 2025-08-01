// Carrega as variáveis de ambiente do arquivo .env
require('dotenv').config();

// Importa as bibliotecas necessárias
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');

// --- INICIALIZAÇÃO E CONFIGURAÇÃO ---

const app = express();

// Middlewares essenciais
app.use(cors()); // Permite que seu frontend em outro domínio acesse esta API
app.use(express.json({ limit: '10mb' })); // Permite que o servidor entenda JSON e aumenta o limite para uploads de arquivos

// Validação das variáveis de ambiente
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    console.error("ERRO: As variáveis de ambiente SUPABASE_URL e SUPABASE_SERVICE_KEY são obrigatórias.");
    process.exit(1); // Encerra a aplicação se as chaves não estiverem configuradas
}

// Cria o cliente Supabase usando a chave de serviço (segura no backend)
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);


// --- ROTAS DA API ---

/**
 * ROTA PRINCIPAL: GET /transactions
 * Busca, filtra, ordena e pagina os dados das transações.
 */
app.get('/transactions', async (req, res) => {
    try {
        // Pega os parâmetros da query string da URL
        const page = parseInt(req.query.page) || 1;
        const itemsPerPage = parseInt(req.query.itemsPerPage) || 16;
        const startIndex = (page - 1) * itemsPerPage;

        const searchTerm = req.query.search || '';
        const statusFilter = req.query.status || '';
        const dateFilter = req.query.data_transacao || '';
        const above10k = req.query.above10k === 'true';

        // Constrói a query no Supabase
        let query = supabase
            .from('transactions') // Nome da sua tabela de transações
            .select(`*, companies_data(*)`, { count: 'exact' }); // Pega dados da transação e faz um "join" com os dados da empresa

        // Aplica filtros dinamicamente
        if (searchTerm) {
            // Busca pelo termo em múltiplas colunas
            query = query.or(`loja.ilike.%${searchTerm}%,cpf_cnpj_loja.ilike.%${searchTerm}%,tid.ilike.%${searchTerm}%`);
        }
        if (statusFilter) {
            query = query.eq('status', statusFilter);
        }
        if (dateFilter) {
            query = query.eq('data_transacao', dateFilter);
        }
        if (above10k) {
            query = query.gt('valor_transacao', 10000);
        }
        
        // Ordenação e Paginação (executado pelo banco de dados)
        query = query
            .order('valor_transacao', { ascending: false })
            .order('data_transacao', { ascending: false })
            .range(startIndex, startIndex + itemsPerPage - 1);
        
        // Executa a query
        const { data, error, count } = await query;

        if (error) {
            // Se houver um erro do Supabase, lança o erro para ser pego pelo bloco catch
            throw error;
        }

        // Envia a resposta de sucesso com os dados e o total de itens
        res.status(200).json({ data, totalItems: count });

    } catch (error) {
        console.error('Erro ao buscar transações:', error.message);
        res.status(500).json({ error: 'Erro interno do servidor ao buscar transações.' });
    }
});


/**
 * ROTA DE ATUALIZAÇÃO: POST /update-client
 * Atualiza o status, observação, tarefas e anexo de um cliente (CNPJ).
 */
app.post('/update-client', async (req, res) => {
    // Pega os dados enviados no corpo da requisição
    const { cnpj, newStatus, newObservation, tasks, attachmentUrl } = req.body;

    // Validação básica dos dados recebidos
    if (!cnpj || !newStatus) {
        return res.status(400).json({ error: 'CNPJ e novo status são obrigatórios.' });
    }

    try {
        // 1. Atualiza o status de todas as transações daquele CNPJ
        const { error: statusError } = await supabase
            .from('transactions')
            .update({ status: newStatus })
            .eq('cpf_cnpj_loja', cnpj);

        if (statusError) throw statusError;

        // 2. Atualiza (ou insere, se não existir) os dados da empresa na tabela 'companies_data'
        const { error: companyError } = await supabase
            .from('companies_data') // Nome da sua tabela de dados por CNPJ
            .upsert({
                cpf_cnpj: cnpj,
                observation: newObservation,
                tasks: tasks,
                attachment_url: attachmentUrl
            }, { onConflict: 'cpf_cnpj' }); // 'onConflict' diz qual coluna usar para verificar se o registro já existe

        if (companyError) throw companyError;

        res.status(200).json({ message: 'Dados do cliente atualizados com sucesso!' });

    } catch (error) {
        console.error('Erro ao atualizar dados do cliente:', error.message);
        res.status(500).json({ error: 'Erro interno do servidor ao atualizar dados.' });
    }
});


/**
 * ROTA DE LIMPEZA: POST /remove-duplicates
 * Remove transações duplicadas baseadas no NSU e CNPJ.
 */
app.post('/remove-duplicates', async (req, res) => {
    try {
        // Em vez de SQL direto, podemos chamar uma função do banco de dados (melhor prática)
        // Você deve criar essa função no seu editor SQL do Supabase.
        const { data, error } = await supabase.rpc('remove_duplicate_transactions');

        if (error) throw error;

        // A função 'remove_duplicate_transactions' deve retornar o número de linhas removidas.
        res.status(200).json({ message: `${data || 0} duplicatas removidas com sucesso.` });

    } catch (error) {
        console.error('Erro ao remover duplicatas:', error.message);
        res.status(500).json({ error: 'Erro interno do servidor ao remover duplicatas.' });
    }
});


// --- INICIALIZAÇÃO DO SERVIDOR ---

// Define a porta. Usa a variável de ambiente do Coolify ou 3009 como padrão.
const PORT = process.env.PORT || 3009;
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}. API pronta para receber requisições.`);
});
