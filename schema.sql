-- Tabela para armazenar as receitas dos itens craftáveis
CREATE TABLE IF NOT EXISTS recipes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,           -- Nome do item/pack (ex: "100 Nightmare Medium Potion")
    quantity_produced INTEGER NOT NULL DEFAULT 1, -- Quantidade produzida pela receita base
    npc_sell_price INTEGER DEFAULT 0     -- Preço de venda do item final para o NPC (pelo pack/receita)
);

-- Tabela para armazenar os materiais necessários para cada receita
CREATE TABLE IF NOT EXISTS recipe_materials (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    recipe_id INTEGER NOT NULL,
    material_name TEXT NOT NULL,
    quantity INTEGER NOT NULL,                     -- Quantidade para a 'quantity_produced' da receita base
    -- Tipo: 'profession' (sem custo inputável), 'drop' (tem preço NPC/Market), 'buy' (idem)
    material_type TEXT NOT NULL CHECK(material_type IN ('profession', 'drop', 'buy')),
    -- Preço padrão de referência NPC para este material (se aplicável)
    default_npc_price INTEGER DEFAULT 0,
    FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE CASCADE -- Se a receita for deletada, seus materiais também são
);

-- Índices opcionais para melhorar performance de consulta
CREATE INDEX IF NOT EXISTS idx_recipe_materials_recipe_id ON recipe_materials (recipe_id);
CREATE INDEX IF NOT EXISTS idx_recipes_name ON recipes (name);