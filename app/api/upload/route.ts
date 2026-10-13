import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { z } from "zod";
import { managerAccess, resellerAccess } from "@/lib/manage-access";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin)
    return Response.json({ error: "Origem inválida" }, { status: 403 });
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  const scope = z
    .object({ kind: z.enum(["restaurant", "reseller"]), id: z.uuid() })
    .safeParse({ kind: form?.get("kind"), id: form?.get("id") });
  if (
    !scope.success ||
    !(file instanceof File) ||
    file.size > 5 * 1024 * 1024 ||
    !["image/jpeg", "image/png", "image/webp"].includes(file.type)
  )
    return Response.json(
      { error: "Envie JPG, PNG ou WebP de até 5 MB" },
      { status: 400 },
    );
  const access =
    scope.data.kind === "restaurant"
      ? await managerAccess(scope.data.id)
      : await resellerAccess(scope.data.id);
  if (!access)
    return Response.json({ error: "Acesso negado" }, { status: 403 });
  try {
    const image = await sharp(Buffer.from(await file.arrayBuffer()), {
      limitInputPixels: 40_000_000,
    })
      .rotate()
      .resize(1600, 1600, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();
    const admin = createAdminClient();
    const path = `${scope.data.kind}/${scope.data.id}/${randomUUID()}.webp`;
    const { error } = await admin.storage
      .from("restaurant-images")
      .upload(path, image, {
        contentType: "image/webp",
        upsert: false,
        cacheControl: "31536000",
      });
    if (error) throw error;
    return Response.json({
      url: admin.storage.from("restaurant-images").getPublicUrl(path).data
        .publicUrl,
    });
  } catch {
    return Response.json(
      { error: "Não foi possível processar a imagem" },
      { status: 400 },
    );
  }
}
