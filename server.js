const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const dbBasePath = fs.existsSync('/data') ? '/data' : __dirname;
const DB_FILE = path.join(__dirname, 'database.db');
console.log(`[DB Init] Arquivo do banco de dados será salvo em: ${DB_FILE}`);

// --- Conexão e Inicialização do Banco de Dados ---
const db = new sqlite3.Database(DB_FILE, (err) => {
    if (err) {
        console.error("Erro ao conectar ao banco de dados SQLite:", err.message);
        return;
    }
    console.log("Conectado ao banco de dados SQLite.");

    // Ler e executar o schema.sql para garantir que as tabelas existam
    // Isso só criará as tabelas se elas NÃO existirem. Não altera tabelas existentes.
    fs.readFile(path.join(__dirname, 'schema.sql'), 'utf8', (err, sql) => {
        if (err) {
            console.error("Erro ao ler o arquivo schema.sql:", err);
            return;
        }
        db.exec(sql, (err) => {
            if (err) {
                // Se o DB já existir com schema antigo, este erro pode não aparecer aqui,
                // mas sim nas queries SQL que tentarem usar colunas novas.
                console.error("Erro ao executar o schema SQL:", err.message);
            } else {
                console.log("Schema do banco de dados garantido.");
            }
        });
    });
});

// --- Middlewares ---
app.use(cors()); // Habilita CORS
app.use(express.json()); // Para parsear body de requests JSON
// Descomente a linha abaixo se quiser que o backend sirva o frontend também
// app.use(express.static(path.join(__dirname, '../frontend')));

// --- Rotas da API ---

// GET /api/items - Retorna a lista de todos os itens craftáveis (id, nome, preço npc)
app.get('/api/items', (req, res) => {
    // Seleciona a coluna npc_sell_price
    const sql = "SELECT id, name, npc_sell_price FROM recipes ORDER BY name ASC";
    db.all(sql, [], (err, rows) => {
        if (err) {
            // Este erro ocorrerá se a coluna npc_sell_price não existir no ARQUIVO database.db atual
            console.error("Erro na query GET /api/items:", err.message);
            res.status(500).json({ error: 'Erro interno do servidor ao buscar itens (verifique schema do DB).' });
            return;
        }
        res.json(rows);
    });
});

// GET /api/items/:id/recipe - Retorna a receita detalhada de um item específico
app.get('/api/items/:id/recipe', (req, res) => {
    const itemId = parseInt(req.params.id, 10);
    if (isNaN(itemId)) { return res.status(400).json({ error: 'ID do item inválido.' }); }

    // Busca dados da receita incluindo npc_sell_price
    const sqlRecipe = "SELECT id, name, quantity_produced, npc_sell_price FROM recipes WHERE id = ?";
    const sqlMaterials = "SELECT material_name, quantity, material_type, default_npc_price FROM recipe_materials WHERE recipe_id = ?";

    db.get(sqlRecipe, [itemId], (err, recipeRow) => {
        if (err) {
            console.error(`Erro na query de receita para ID ${itemId}:`, err.message);
            return res.status(500).json({ error: 'Erro interno do servidor ao buscar receita.' });
        }
        if (!recipeRow) { return res.status(404).json({ error: 'Item não encontrado.' }); }

        db.all(sqlMaterials, [itemId], (err, materialRows) => {
            if (err) {
                console.error(`Erro na query de materiais para ID ${itemId}:`, err.message);
                return res.status(500).json({ error: 'Erro interno do servidor ao buscar materiais da receita.' });
            }
            const fullRecipe = { ...recipeRow, materials: materialRows || [] };
            res.json(fullRecipe);
        });
    });
});

app.get('/api/items/name/:name', (req, res) => {
    const itemName = req.params.name;
    const sql = "SELECT npc_sell_price FROM recipes WHERE name = ?";
    db.get(sql, [itemName], (err, row) => {
        if (err) {
            console.error("Erro ao buscar item por nome:", err.message);
            return res.status(500).json({ error: 'Erro ao buscar item.' });
        }
        if (row) {
            return res.json({ npc_sell_price: row.npc_sell_price });
        } else {
            return res.status(404).json({ message: 'Item não encontrado.' });
        }
    });
   });

// POST /api/items - Criar nova receita
app.post('/api/items', (req, res) => {
    // Inclui npc_sell_price na desestruturação
    const { name, quantity_produced, npc_sell_price, materials } = req.body;

    // Validações
    if (!name || !quantity_produced || !materials || !Array.isArray(materials)) { return res.status(400).json({ error: 'Dados inválidos para criar item.' }); }
    if (materials.some(mat => !mat.material_name || !mat.quantity || !mat.material_type)) { return res.status(400).json({ error: 'Dados inválidos em um ou mais materiais.' }); }

    // Inclui npc_sell_price no SQL INSERT
    const sqlInsertRecipe = `INSERT INTO recipes (name, quantity_produced, npc_sell_price) VALUES (?, ?, ?)`;
    const sqlInsertMaterial = `INSERT INTO recipe_materials (recipe_id, material_name, quantity, material_type, default_npc_price) VALUES (?, ?, ?, ?, ?)`;

    db.serialize(() => {
        db.run('BEGIN TRANSACTION');
        let recipeId = null;
        // Passa npc_sell_price (ou 0) como parâmetro
        db.run(sqlInsertRecipe, [name, quantity_produced, npc_sell_price || 0], function(err) {
            if (err) {
                // Este erro ocorrerá se a coluna npc_sell_price não existir no ARQUIVO database.db atual
                console.error("Erro ao inserir receita:", err.message);
                db.run('ROLLBACK');
                return res.status(500).json({ error: `Erro ao salvar receita: ${err.message}` });
            }
            recipeId = this.lastID;

            const stmtMaterial = db.prepare(sqlInsertMaterial);
            let materialErrorOccurred = false;
            materials.forEach(mat => {
                if (materialErrorOccurred) return;
                stmtMaterial.run([recipeId, mat.material_name, mat.quantity, mat.material_type, mat.default_npc_price || 0], (runErr) => {
                    if (runErr) { console.error("Erro ao inserir material:", runErr.message); materialErrorOccurred = true; }
                });
            });
            stmtMaterial.finalize((finalizeErr) => {
                 if (finalizeErr) { console.error("Erro ao finalizar statement de material:", finalizeErr.message); materialErrorOccurred = true; }
                 if (materialErrorOccurred) {
                    db.run('ROLLBACK'); return res.status(500).json({ error: 'Erro ao salvar um ou mais materiais.' });
                 } else {
                    db.run('COMMIT'); return res.status(201).json({ message: 'Receita criada com sucesso!', id: recipeId });
                 }
            });
        });
    });
});

// PUT /api/items/:id - Atualizar uma receita existente
app.put('/api/items/:id', (req, res) => {
    const itemId = parseInt(req.params.id, 10);
    // Inclui npc_sell_price na desestruturação
    const { name, quantity_produced, npc_sell_price, materials } = req.body;

    // Validações
    if (isNaN(itemId)) { return res.status(400).json({ error: 'ID do item inválido.' }); }
    if (!name || !quantity_produced || !materials || !Array.isArray(materials)) { return res.status(400).json({ error: 'Dados inválidos para atualizar item.' }); }
    if (materials.some(mat => !mat.material_name || !mat.quantity || !mat.material_type)) { return res.status(400).json({ error: 'Dados inválidos em um ou mais materiais.' }); }

    // Inclui npc_sell_price no SQL UPDATE
    const sqlUpdateRecipe = `UPDATE recipes SET name = ?, quantity_produced = ?, npc_sell_price = ? WHERE id = ?`;
    const sqlDeleteMaterials = `DELETE FROM recipe_materials WHERE recipe_id = ?`;
    const sqlInsertMaterial = `INSERT INTO recipe_materials (recipe_id, material_name, quantity, material_type, default_npc_price) VALUES (?, ?, ?, ?, ?)`;

    db.serialize(() => {
        db.run('BEGIN TRANSACTION');
        let errorOccurred = false;
        // Passa npc_sell_price (ou 0) como parâmetro para o UPDATE
        db.run(sqlUpdateRecipe, [name, quantity_produced, npc_sell_price || 0, itemId], function(err) {
            if (err) { errorOccurred = true; console.error("Erro ao atualizar receita:", err.message); db.run('ROLLBACK'); return res.status(500).json({ error: `Erro ao atualizar receita: ${err.message}` }); }
            // Verifica se alguma linha foi realmente alterada
            if (this.changes === 0 && !errorOccurred) { errorOccurred = true; db.run('ROLLBACK'); return res.status(404).json({ error: 'Item não encontrado para atualização.' }); }

            if(!errorOccurred) {
                db.run(sqlDeleteMaterials, [itemId], (deleteErr) => {
                    if (deleteErr) { errorOccurred = true; console.error("Erro ao deletar materiais antigos:", deleteErr.message); db.run('ROLLBACK'); return res.status(500).json({ error: 'Erro ao limpar materiais antigos.' }); }

                    if (!errorOccurred) {
                        const stmtMaterial = db.prepare(sqlInsertMaterial);
                        let materialInsertError = false;
                        materials.forEach(mat => {
                            if (materialInsertError) return;
                            stmtMaterial.run([itemId, mat.material_name, mat.quantity, mat.material_type, mat.default_npc_price || 0], (runErr) => { if (runErr) { console.error("Erro ao inserir novo material:", runErr.message); materialInsertError = true; } });
                        });
                        stmtMaterial.finalize((finalizeErr) => {
                            if (finalizeErr) { console.error("Erro ao finalizar statement de material (update):", finalizeErr.message); materialInsertError = true; }
                            if (materialInsertError) { errorOccurred = true; db.run('ROLLBACK'); return res.status(500).json({ error: 'Erro ao salvar um ou mais materiais atualizados.' }); }
                            else if (!errorOccurred) { db.run('COMMIT'); return res.json({ message: 'Receita atualizada com sucesso!', id: itemId }); }
                        });
                    }
                });
            }
        });
    });
});

// DELETE /api/items/:id - Deletar uma receita
app.delete('/api/items/:id', (req, res) => {
    const itemId = parseInt(req.params.id, 10);
    if (isNaN(itemId)) { return res.status(400).json({ error: 'ID do item inválido.' }); }
    const sql = `DELETE FROM recipes WHERE id = ?`;
    // ON DELETE CASCADE no schema cuidará dos materiais
    db.run(sql, [itemId], function(err) {
        if (err) { console.error("Erro ao deletar receita:", err.message); return res.status(500).json({ error: `Erro ao deletar receita: ${err.message}` }); }
        if (this.changes === 0) { return res.status(404).json({ error: 'Item não encontrado para deletar.' }); }
        res.status(200).json({ message: 'Receita deletada com sucesso!' }); // Ou res.sendStatus(204) se preferir sem corpo
    });
});

// --- Tratamento de Erro Genérico ---
// Middleware de erro deve vir por último
app.use((err, req, res, next) => {
    console.error("Erro não tratado:", err.stack);
    res.status(500).json({ error: 'Algo deu muito errado no servidor!' });
});

app.get('/health', (req, res) => {
    console.log("[GET /health] Ping received.");
    res.status(200).send('OK');
});

// --- Iniciar o Servidor ---
app.listen(PORT, () => {
    console.log(`Servidor backend rodando na porta ${PORT}`);
    console.log(`API disponível em http://localhost:${PORT}/api`);
});
