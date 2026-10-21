import { z } from "zod";
import { PERMISSIONS, type PermissionKey } from "@/lib/permissions";
const text = z.string().trim().min(1).max(100);
export const imageUrl = z
  .union([
    z.literal(""),
    z.url().refine((v) => {
      const url = new URL(v);
      return (
        url.protocol === "https:" &&
        (url.hostname === "images.unsplash.com" ||
          (url.hostname === "yekmailbymutimhmddzx.supabase.co" &&
            url.pathname.startsWith(
              "/storage/v1/object/public/restaurant-images/",
            )))
      );
    }, "Use uma imagem enviada pelo painel"),
    z.null(),
  ])
  .transform((v) => v || null);
export const groupSchema = z
  .object({
    name: text,
    required: z.boolean(),
    min_select: z.number().int().min(0).max(50),
    max_select: z.number().int().min(1).max(50),
    position: z.number().int().min(0),
    modifiers: z
      .array(
        z.object({
          name: text,
          price_cents: z.number().int().min(0).max(1_000_000),
          position: z.number().int().min(0),
        }),
      )
      .min(1)
      .max(50),
  })
  .refine(
    (g) =>
      g.min_select <= g.max_select &&
      (!g.required || g.min_select >= 1) &&
      g.max_select <= g.modifiers.length,
    "Confira mínimo, máximo e opções do grupo",
  );
export const itemSchema = z.object({
  category_id: z.uuid(),
  name: text,
  description: z.string().max(1000),
  price_cents: z.number().int().min(0).max(1_000_000),
  photo_url: imageUrl,
  prep_minutes: z.number().int().min(1).max(240),
  active: z.boolean(),
  featured: z.boolean(),
  position: z.number().int().min(0).default(0),
  stock_enabled: z.boolean().default(false),
  stock_quantity: z.number().int().min(0).max(100_000).nullable().default(null),
  low_stock_threshold: z.number().int().min(0).max(100_000).default(5),
  // null = herda o setor da categoria.
  station: z.enum(["cozinha", "bar"]).nullable().default(null),
  groups: z.array(groupSchema).max(20),
}).refine(
  (i) => !i.stock_enabled || i.stock_quantity !== null,
  "Informe a quantidade em estoque",
);
export const stationSchema = z.enum(["cozinha", "bar"]);
export const stockSchema = z.object({
  item_id: z.uuid(),
  kind: z.enum(["entrada", "ajuste"]),
  quantity: z.number().int().min(0).max(100_000),
  note: z.string().trim().max(200).optional(),
});
export type ItemInput = z.input<typeof itemSchema>;
export const settingsSchema = z.object({
  mode: z.enum(["fifo", "complexity", "balanced"]),
  weight_wait: z.number().min(0).max(999.99),
  weight_complexity: z.number().min(0).max(999.99),
  max_wait_minutes: z.number().int().min(1).max(240),
});
export const restaurantSchema = z.object({
  name: text,
  logo_url: imageUrl,
  cover_url: imageUrl,
  primary_color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
  background_color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
});
export const financeSettingsSchema = z.object({
  service_fee_percent: z.number().min(0).max(20),
  service_fee_optional: z.boolean(),
});
export const surveySettingsSchema = z.object({
  survey_enabled: z.boolean(),
  google_review_url: z
    .union([z.literal(""), z.url().refine((v) => v.startsWith("https://"), "Use um link https://"), z.null()])
    .transform((v) => v || null),
});
export const PAYMENT_METHODS = ["pix", "dinheiro", "debito", "credito", "outro"] as const;
export const paymentMethod = z.enum(PAYMENT_METHODS);
const memberRole = z.enum(["manager", "waiter", "kitchen", "bar"]);
export const permissionsSchema = z
  .object(
    Object.fromEntries(
      PERMISSIONS.map((p) => [p.key, z.boolean().optional()]),
    ) as Record<PermissionKey, z.ZodOptional<z.ZodBoolean>>,
  )
  .strict();
export const teamSchema = z
  .object({
    email: z.email().max(254),
    name: text,
    // `role` continua aceito pela versão anterior do formulário.
    role: memberRole.optional(),
    roles: z.array(memberRole).min(1).max(4).optional(),
    permissions: permissionsSchema.optional(),
    password: z.string().min(12).max(72).optional(),
    redirect_url: z.url().optional(),
  })
  .transform((v) => ({
    ...v,
    roles: [...new Set(v.roles ?? (v.role ? [v.role] : []))],
  }))
  .refine((v) => v.roles.length > 0, "Escolha pelo menos um papel");
export const memberSchema = z.object({
  user_id: z.uuid(),
  roles: z.array(memberRole).min(1).max(4),
  permissions: permissionsSchema,
  active: z.boolean(),
});
