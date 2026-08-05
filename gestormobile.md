Quero desenvolver uma aplicação mobile full-stack para gestão interna do meu negócio de venda de camisolas de futebol. A aplicação deve ser altamente prática, focada em eficiência para registos rápidos no dia a dia, e destina-se inicialmente a uso próprio, embora deva incluir um sistema de autenticação robusto desde o início.

### 1. Stack Tecnológica Sugerida (ou equivalente moderna)
* **Frontend:** React Native (Expo) ou Flutter para garantir uma app fluida para iOS e Android.
* **Backend / Base de Dados:** Supabase ou Firebase (para autenticação, base de dados em tempo real e armazenamento de imagens).
* **Pagamentos / Alavancagem:** Integração opcional com Stripe para futuros registos de pagamentos online ou referência visual de transações.

### 2. Módulos e Funcionalidades Principais

#### A. Autenticação e Segurança
* Sistema de login e registo seguro (Email/Password).
* Como a app é de uso exclusivo meu (ou futuros colaboradores), deve manter a sessão ativa de forma segura.

#### B. Gestão de Stock (Catálogo de Camisolas)
* **Adicionar Novo Modelo:** 
  * Nome da camisola (ex: "Sporting CP Home 24/25", "Real Madrid Away").
  * Upload de imagem (armazenada em cloud, com preview rápido).
  * Gestão de tamanhos e respetivas quantidades (ex: S, M, L, XL).
* **Atualização de Stock:** Interface rápida para somar quantidades quando chegam novas remessas.

#### C. Sistema de Reservas
* Registo rápido de novas reservas com os seguintes campos:
  * Nome do cliente.
  * Produto em questão (seleção direta a partir do catálogo de camisolas e respetivo tamanho).
  * Valor cobrado / acordado.
  * Data do registo da reserva (preenchida automaticamente, mas editável).
  * Estado da reserva (Pendente / Paga / Entregue).

#### D. Sistema de Vendas
* Registo de vendas diretas ou conversão de reservas:
  * Nome do cliente.
  * Produto vendido (com baixa automática no stock correspondente).
  * Valor cobrado.
  * Data da venda.
  * (Opcional) Integração com botão de pagamento via Stripe para registar transações eletrónicas.

#### E. Dashboard e Relatórios Financeiros
* **Gestão de Valor Faturado por Mês:** 
  * Gráfico interativo de vendas mensais (ex: barras ou linhas).
  * Histórico detalhado de vendas com filtros por data e produto.
  * Métricas rápidas no topo (faturamento do mês atual, total de reservas pendentes, camisolas mais vendidas).

### 3. Requisitos de UI/UX
* Design minimalista, limpo e focado no modo escuro/claro.
* Botões grandes e acessíveis (focado em usabilidade móvel rápida, ideal para quem está a registar vendas em movimento).
* Navegação inferior (Bottom Tabs) intuitiva: Catálogo, Reservas, Vendas, Dashboard.

Por favor, começa por me apresentar a arquitetura recomendada para este projeto e o código base para as tabelas da base de dados e os ecrãs principais.

# Arquitetura de Base de Dados para Gestão de Venda de Camisolas de Futebol

Para suportar todas as funcionalidades solicitadas de forma eficiente, escalável e relacional, a estrutura de base de dados ideal é composta por **5 tabelas principais**. Esta arquitetura foi desenhada para sistemas SQL (como **PostgreSQL / Supabase** ou **MySQL**), integrando-se perfeitamente com autenticação e plataformas de pagamento como o Stripe.

---

## 1. Tabela `products` (Catálogo de Camisolas)
Guarda a informação base de cada modelo de camisola de futebol adicionado ao negócio.

| Campo | Tipo | Descrição / Restrições |
| :--- | :--- | :--- |
| `id` | UUID / INT | Chave Primária (Primary Key) |
| `name` | VARCHAR | Nome da camisola (ex: *Benfica Home 24/25*) |
| `image_url` | TEXT | Link da imagem armazenada em nuvem (ex: Supabase Storage) |
| `created_at` | TIMESTAMP | Data de criação do registo |

---

## 2. Tabela `product_variants` (Gestão de Tamanhos e Stock)
Como uma camisola tem vários tamanhos (S, M, L, XL, etc.) e cada um possui a sua própria quantidade, os dados são normalizados numa tabela filha ligada aos produtos.

| Campo | Tipo | Descrição / Restrições |
| :--- | :--- | :--- |
| `id` | UUID / INT | Chave Primária (Primary Key) |
| `product_id` | UUID / INT | Chave Estrangeira (Foreign Key para `products`) |
| `size` | VARCHAR | Tamanho (ex: *S*, *M*, *L*, *XL*, *XXL*) |
| `stock_quantity` | INT | Quantidade física disponível em stock |
| `updated_at` | TIMESTAMP | Data da última atualização de stock |

---

## 3. Tabela `reservations` (Sistema de Reservas)
Guarda o registo de camisolas que estão reservadas para clientes antes de serem vendidas ou entregues.

| Campo | Tipo | Descrição / Restrições |
| :--- | :--- | :--- |
| `id` | UUID / INT | Chave Primária (Primary Key) |
| `customer_name` | VARCHAR | Nome do cliente |
| `product_variant_id` | UUID / INT | Chave Estrangeira (Foreign Key para `product_variants`) |
| `quantity` | INT | Quantidade reservada |
| `total_price` | DECIMAL | Valor cobrado / acordado |
| `status` | VARCHAR | Estado (ex: *Pendente*, *Confirmada*, *Cancelada*) |
| `reservation_date` | TIMESTAMP | Data do registo da reserva |

---

## 4. Tabela `sales` (Sistema de Vendas)
Guarda o histórico de tudo o que foi efetivamente vendido. Pode ser alimentada diretamente ou através da conversão de uma reserva concluída.

| Campo | Tipo | Descrição / Restrições |
| :--- | :--- | :--- |
| `id` | UUID / INT | Chave Primária (Primary Key) |
| `customer_name` | VARCHAR | Nome do cliente |
| `product_variant_id` | UUID / INT | Chave Estrangeira (Foreign Key para `product_variants`) |
| `quantity` | INT | Quantidade vendida |
| `total_price` | DECIMAL | Valor cobrado final |
| `payment_method` | VARCHAR | Método (ex: *Dinheiro*, *MB Way*, *Transferência*, *Stripe*) |
| `stripe_payment_intent_id` | VARCHAR | ID da transação (Opcional, para integrações Stripe) |
| `sale_date` | TIMESTAMP | Data e hora exata da venda |

---

## 5. Tabela `profiles` (Utilizadores / Autenticação)
Gere os acessos à aplicação, ligando-se ao sistema de autenticação base (como Supabase Auth ou Firebase Auth).

| Campo | Tipo | Descrição / Restrições |
| :--- | :--- | :--- |
| `id` | UUID | Chave Primária (Ligado ao sistema de Auth) |
| `email` | VARCHAR | Email do utilizador |
| `full_name` | VARCHAR | Nome completo |
| `role` | VARCHAR | Permissões (ex: *admin*, *staff*) |
| `created_at` | TIMESTAMP | Data de registo |

---

## Dicas Úteis para a Implementação

1. **Atualização Automática de Stock:** 
   Podes criar uma *Trigger* na base de dados (ou lógica no backend) para que, sempre que um novo registo for criado na tabela `sales`, o campo `stock_quantity` na tabela `product_variants` diminua automaticamente.

2. **Faturação por Mês (Dashboard):** 
   Para alimentar gráficos mensais de forma rápida e eficiente no telemóvel, podes criar uma *View* em SQL que agrupe a soma da coluna `total_price` da tabela `sales` por mês e ano.