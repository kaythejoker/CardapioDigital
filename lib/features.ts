// Módulos vendidos à parte pela revenda (spec-fase2.md, seção 13). Espelha as
// chaves de `plans.features` e de `public.restaurant_access`.
export const FEATURES = [
  { key: "bar", label: "Painel do bar", hint: "Bebidas em fila separada da cozinha" },
  { key: "stock", label: "Controle de estoque", hint: "Baixa automática e reposição" },
  { key: "finance", label: "Financeiro", hint: "Pagamentos por forma, taxa, desconto e fechamento do dia" },
  { key: "reports", label: "Relatórios", hint: "Vendas por período e exportação CSV" },
  { key: "service_calls", label: "Chamar garçom", hint: "Cliente chama e pede a conta pelo celular" },
  { key: "surveys", label: "Pesquisa de satisfação", hint: "Avaliação ao fechar a comanda e Google" },
  { key: "custom_domain", label: "Domínio próprio", hint: "Cardápio no domínio do restaurante" },
  // Fase 3 (spec-fase3.md).
  { key: "waitlist", label: "Lista de espera", hint: "Número de ordem e posição no celular do cliente" },
  { key: "order_blocks", label: "Bloqueios", hint: "Pausar pedidos, bloquear mesa, prato e horário" },
  { key: "languages", label: "Idiomas", hint: "Cardápio em português, inglês e espanhol" },
] as const;
export type FeatureKey = (typeof FEATURES)[number]["key"];
export type Features = Record<FeatureKey, boolean>;
export type SubscriptionStatus = "teste" | "ativa" | "atrasada" | "suspensa" | "cancelada";
export type Access = {
  status: SubscriptionStatus;
  blocked: boolean;
  plan: string | null;
  plan_id?: string;
  features: Features;
  period_end: string | null;
  trial_ends_at: string | null;
  grace_days?: number;
  max_tables: number | null;
};
export const STATUS_LABELS: Record<SubscriptionStatus, string> = {
  teste: "Em teste",
  ativa: "Ativa",
  atrasada: "Atrasada",
  suspensa: "Suspensa",
  cancelada: "Cancelada",
};
export const ALL_FEATURES: Features = Object.fromEntries(FEATURES.map((f) => [f.key, true])) as Features;
