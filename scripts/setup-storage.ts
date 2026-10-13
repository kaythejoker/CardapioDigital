import { createClient } from "@supabase/supabase-js";

async function main() {
  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false } },
  );
  const options = {
    public: true,
    fileSizeLimit: 5 * 1024 * 1024,
    allowedMimeTypes: ["image/webp"],
  };
  const { data, error } = await db.storage.getBucket("restaurant-images");
  if (error && error.message !== "Bucket not found") throw error;
  const result = data
    ? await db.storage.updateBucket("restaurant-images", options)
    : await db.storage.createBucket("restaurant-images", options);
  if (result.error) throw result.error;
  console.log("Bucket restaurant-images configurado");
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Falha no Storage");
  process.exitCode = 1;
});
