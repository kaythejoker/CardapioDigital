// Papéis e permissões da equipe (spec-fase2.md, seção 10). Espelha
// private.default_permission no banco: mudar um dos lados exige mudar o outro.

export const MEMBER_ROLES = ["manager", "waiter", "kitchen", "bar"] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];
export const ROLE_LABELS: Record<MemberRole, string> = {
  manager: "Gestor",
  waiter: "Garçom",
  kitchen: "Cozinha",
  bar: "Bar",
};

export const PERMISSIONS = [
  { key: "cancel_items", label: "Cancelar itens e pedidos", group: "Salão" },
  { key: "register_payment", label: "Registrar pagamento", group: "Salão" },
  { key: "close_tab", label: "Fechar comanda", group: "Salão" },
  { key: "merge_tables", label: "Unir mesas", group: "Salão" },
  { key: "apply_discount", label: "Aplicar desconto", group: "Salão" },
  { key: "edit_menu", label: "Editar cardápio", group: "Gestão" },
  { key: "manage_stock", label: "Controlar estoque", group: "Gestão" },
  { key: "view_reports", label: "Ver relatórios e histórico", group: "Gestão" },
  { key: "view_finance", label: "Ver financeiro", group: "Gestão" },
] as const;
export type PermissionKey = (typeof PERMISSIONS)[number]["key"];
export type Permissions = Partial<Record<PermissionKey, boolean>>;
export type EffectivePermissions = Record<PermissionKey, boolean>;

const WAITER_DEFAULTS: readonly PermissionKey[] = [
  "cancel_items",
  "register_payment",
  "close_tab",
  "merge_tables",
];

/** Permissão padrão do papel, sem ajuste por pessoa. */
export function defaultPermission(roles: readonly string[], key: PermissionKey) {
  if (roles.includes("manager")) return true;
  if (roles.includes("waiter")) return WAITER_DEFAULTS.includes(key);
  return false;
}

/** Gestor tem tudo; os demais usam o ajuste por pessoa ou o padrão do papel. */
export function effectivePermissions(
  roles: readonly string[],
  permissions: Permissions | null | undefined,
): EffectivePermissions {
  const result = {} as EffectivePermissions;
  for (const { key } of PERMISSIONS) {
    result[key] = roles.includes("manager")
      ? true
      : (permissions?.[key] ?? defaultPermission(roles, key));
  }
  return result;
}

/** Permissões que abrem o painel do gestor para quem não é gestor. */
export const PANEL_PERMISSIONS: readonly PermissionKey[] = [
  "edit_menu",
  "manage_stock",
  "view_reports",
  "view_finance",
];

export function canOpenManagerPanel(
  roles: readonly string[],
  permissions: Permissions | null | undefined,
) {
  const can = effectivePermissions(roles, permissions);
  return roles.includes("manager") || PANEL_PERMISSIONS.some((p) => can[p]);
}

export const ALL_PERMISSIONS = effectivePermissions(["manager"], {});
