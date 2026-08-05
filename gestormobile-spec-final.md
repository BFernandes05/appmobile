# GestorMobile — Spec Técnica Final
## App de Gestão de Stock, Reservas e Vendas de Camisolas de Futebol

Documento fechado para desenvolvimento. Todas as regras de negócio, fluxos e critérios de aceitação abaixo são vinculativos — qualquer alteração deve ser refletida aqui antes de ser implementada.

---

## 1. Stack Tecnológica

| Camada | Escolha | Motivo |
| :--- | :--- | :--- |
| Frontend | React Native (Expo) | App fluida iOS/Android, ecossistema maduro para offline-first |
| Backend / BD | Supabase (PostgreSQL + Auth + Storage) | Auth robusta, RLS para permissões por role, Storage para imagens |
| Base de dados local (offline) | SQLite via expo-sqlite | Necessária para o suporte offline (ver secção 5) |
| Estado do servidor | TanStack Query (React Query) | Cache automática, retries de rede, sync em background |
| Estado global de UI (carrinho, sessão) | Zustand | Leve, evita re-renders desnecessários do carrinho a cada clique (ao contrário da Context API) |
| Pagamentos | Stripe (opcional, futuro) | Registo de transações eletrónicas |

---

## 2. Autenticação e Permissões (RBAC)

Roles definidos em `profiles.role`: **admin** / **staff**.

| Ação | Admin | Staff |
| :--- | :---: | :---: |
| Registar vendas | ✅ | ✅ |
| Registar reservas | ✅ | ✅ |
| Consultar histórico do próprio dia | ✅ | ✅ |
| Editar preços de produtos | ✅ | ❌ |
| Apagar / desativar produtos | ✅ | ❌ |
| Ver dashboard financeiro completo | ✅ | ❌ |
| Filtrar histórico por colaborador / período alargado | ✅ | ❌ |

Implementação: usar **Row Level Security (RLS)** no Supabase baseada em `auth.uid()` → `profiles.role`, não apenas validação no frontend.

Sessão: persistente entre fechos da app (refresh token seguro). Se expirar a meio de um registo (ex: nova venda), a app deve:
1. Guardar o estado do formulário em curso (localmente, não perdido).
2. Mostrar mensagem clara: *"A tua sessão expirou. Inicia sessão novamente para continuar."*
3. Após novo login, restaurar automaticamente o utilizador ao ecrã e formulário exatos onde estava, com os dados já preenchidos.

---

## 3. Arquitetura de Base de Dados (Supabase / PostgreSQL)

### 3.1 `products`
| Campo | Tipo | Notas |
| :--- | :--- | :--- |
| `id` | UUID | PK |
| `name` | VARCHAR | Obrigatório |
| `category` | VARCHAR | Obrigatório (ex: Home, Away, Third, Retro) |
| `image_url` | TEXT | Opcional |
| `is_active` | BOOLEAN | Default `true` — soft delete (ver 4.3) |
| `created_at` | TIMESTAMP | Auto, `Europe/Lisbon` |

### 3.2 `product_variants`
| Campo | Tipo | Notas |
| :--- | :--- | :--- |
| `id` | UUID | PK |
| `product_id` | UUID | FK → products |
| `size` | VARCHAR | Obrigatório |
| `base_price` | DECIMAL | Obrigatório — preço sugerido, editável em cada venda/reserva |
| `stock_quantity` | INT | Obrigatório, default 0. **Nunca negativo** |
| `is_active` | BOOLEAN | Default `true` — soft delete (ver 4.3) |
| `updated_at` | TIMESTAMP | Auto |

### 3.3 `reservations`
| Campo | Tipo | Notas |
| :--- | :--- | :--- |
| `id` | UUID | PK |
| `customer_name` | VARCHAR | Obrigatório |
| `customer_contact` | VARCHAR | Opcional (recomendado, para avisar antes da expiração das 24h) |
| `product_variant_id` | UUID | FK → product_variants, obrigatório |
| `quantity` | INT | Obrigatório, default 1 |
| `total_price` | DECIMAL | Obrigatório (pré-preenchido com `base_price × quantity`, editável) |
| `status` | VARCHAR | `Pendente` / `Confirmada` / `Cancelada` (segue a tabela, corrige a inconsistência do doc original) |
| `reservation_date` | TIMESTAMP | Auto, editável |
| `expires_at` | TIMESTAMP | Auto = `reservation_date + 24h` |

### 3.4 `sales`
| Campo | Tipo | Notas |
| :--- | :--- | :--- |
| `id` | UUID | PK |
| `customer_name` | VARCHAR | **Opcional** (vendas diretas/rápidas podem não ter nome) |
| `product_variant_id` | UUID | FK → product_variants, obrigatório |
| `quantity` | INT | Obrigatório |
| `total_price` | DECIMAL | Obrigatório |
| `payment_method` | VARCHAR | Obrigatório (Dinheiro, MB Way, Transferência, Stripe) |
| `stripe_payment_intent_id` | VARCHAR | Opcional |
| `sale_date` | TIMESTAMP | Auto, `Europe/Lisbon`, editável |
| `sync_status` | VARCHAR | `pending` / `synced` / `error` — necessário para offline (ver 5) |
| `local_id` | UUID | Gerado no dispositivo antes do sync, evita duplicados |

### 3.5 `profiles`
Sem alterações — `id`, `email`, `full_name`, `role`, `created_at`.

---

## 4. Regras de Negócio Críticas

### 4.1 Fluxo Reserva → Venda (bloqueio de stock)
1. Ao **criar uma reserva**, o `stock_quantity` da variante é decrementado imediatamente (stock fica "bloqueado" para outros clientes).
2. A reserva fica com `status = Pendente` e `expires_at = agora + 24h`.
3. **Se não for paga dentro de 24h**: um job automático (Supabase Edge Function agendada / cron) repõe o `stock_quantity` e muda `status` para `Cancelada`.
4. **Se for paga dentro de 24h**: o utilizador converte a reserva em venda → cria-se uma nova linha em `sales` com os mesmos dados, e a reserva original é **apagada** (não fica histórico da reserva, só da venda).
5. Ao apagar uma reserva concluída como venda, **não há reposição de stock** (o stock já estava corretamente descontado desde o passo 1).

### 4.2 Validação de Stock
Se a quantidade pedida (numa venda direta ou reserva) exceder o `stock_quantity` disponível:
- Bloqueia o registo.
- Mostra: *"Stock insuficiente. Disponível: [X] unidade(s)."*

### 4.3 Soft Delete
`products` e `product_variants` nunca são apagados fisicamente se tiverem vendas/reservas associadas — apenas `is_active = false`. Itens inativos desaparecem do catálogo de seleção, mas mantêm-se visíveis no histórico de vendas/reservas antigas.

### 4.4 Campos Obrigatórios vs Opcionais (resumo)
| Formulário | Obrigatório | Opcional |
| :--- | :--- | :--- |
| Novo produto | Nome, Categoria | Imagem |
| Nova variante | Tamanho, Preço base | — |
| Nova reserva | Cliente, Produto+Tamanho, Quantidade, Valor | Contacto do cliente |
| Nova venda | Produto+Tamanho, Quantidade, Valor, Método de pagamento | Nome do cliente |

---

## 5. Suporte Offline

### 5.1 Arquitetura
- Base de dados local no dispositivo (SQLite) espelha as tabelas `products`, `product_variants` e mantém uma fila local de `sales` pendentes.
- Todo o ecrã de vendas lê/escreve primeiro localmente — nunca bloqueia à espera da rede.

### 5.2 Fluxo de Sincronização
1. Venda criada offline → guardada localmente com `local_id`, `sync_status = pending`. UI mostra badge **"Por sincronizar"**.
2. Ao restabelecer ligação, a app envia as vendas pendentes, uma a uma, para uma função RPC no Supabase (`process_sale`) que:
   - Verifica atomicamente se ainda há stock suficiente na variante.
   - Se sim: decrementa stock, grava a venda, devolve sucesso → `sync_status = synced`.
   - Se não: devolve erro → `sync_status = error`, badge **"Erro — stock insuficiente, requer revisão manual"**.
3. Vendas com erro ficam visíveis num ecrã de "Pendências" para resolução manual (ajustar quantidade, cancelar, ou repor stock manualmente).

### 5.3 Gestão de Conflitos
Em vez de "last-write-wins" (arriscado com stock), a verificação de stock é sempre feita **no servidor, no momento do sync**, nunca confiando no valor local. Isto evita venda de stock inexistente quando dois dispositivos vendem o mesmo artigo offline em simultâneo — o segundo a sincronizar recebe o erro.

---

## 6. Imagens (Upload de Produtos)

- Redimensionar no frontend (`expo-image-manipulator`) para máx. **1000×1000px**, comprimir para **WebP ou JPEG a 80% de qualidade**, alvo final **< 300KB**.
- Bucket dedicado no Supabase Storage: `product-images`.
  - Leitura: **pública** (sem tokens, carregamento rápido em listas/catálogo).
  - Escrita: **restrita a utilizadores autenticados** com role admin/staff.
- Se o upload falhar, mostrar o motivo específico (ex: *"Sem ligação à internet"*, *"Imagem demasiado grande"*, *"Erro do servidor, tenta novamente"*).

---

## 7. UI/UX — Estados

- **Ecrãs vazios** (sem produtos/reservas/vendas ainda): mensagem visualmente positiva, ex. *"Tudo novo por aqui! Começa por adicionar o teu primeiro artigo."* — evitar tom negativo tipo "nenhum registo encontrado".
- **Falha de upload**: mensagem específica do motivo (ver secção 6).
- **Sessão expirada a meio de registo**: mensagem explicativa + restauro automático do formulário após novo login (ver secção 2).
- Modo escuro/claro, botões grandes, navegação inferior: Catálogo, Reservas, Vendas, Dashboard.

---

## 8. Outros Requisitos Técnicos

- **Timezone**: todos os `TIMESTAMP` assumem `Europe/Lisbon`.
- **Exportação**: possibilidade de exportar histórico de vendas para CSV/Excel (para contabilidade).

---

## 9. Critérios de Aceitação por Módulo

### 9.1 Autenticação e Perfis
- [ ] Login com email/password válido redireciona para o painel principal.
- [ ] Credenciais inválidas mostram mensagem de erro clara.
- [ ] Acesso restrito por role: admin acede à gestão de preços/stock global; staff apenas ao POS.
- [ ] Sessão mantém-se ativa entre fechos da app.

### 9.2 Catálogo e Gestão de Stock
- [ ] Criar artigo exige Nome, Preço, Categoria e Quantidade inicial.
- [ ] Upload de imagem é redimensionado/comprimido para < 300KB antes do envio.
- [ ] Listagem atualiza em tempo real quando o stock muda.
- [ ] Sistema impede/avisa quando a quantidade pedida excede o stock disponível.

### 9.3 Vendas (POS / Registo em Movimento)
- [ ] Adicionar artigos ao carrinho por pesquisa de nome (ou código de barras, se aplicável).
- [ ] Total calculado automaticamente, sem erros de arredondamento.
- [ ] Offline: venda guardada localmente com indicador "Por sincronizar".
- [ ] Ao voltar a rede: sync automático, indicador passa a "Sincronizado" (ou "Erro").
- [ ] Stock desce corretamente no momento da venda.

### 9.4 Histórico e Relatórios
- [ ] Vendedor consulta vendas do próprio dia (data, hora, valor).
- [ ] Admin filtra histórico por intervalo de datas e por colaborador.
- [ ] Totais diários/mensais batem certo com a soma individual das vendas.


todos os textos da app em PT-PT, conforme o spec.