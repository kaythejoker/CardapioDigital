import { chromium } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

async function main() {
  const origin = process.env.QA_BASE_URL ?? "http://localhost:3001";
  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false } },
  );
  const { data: table, error } = await db
    .from("tables")
    .select("qr_token")
    .eq("restaurant_id", "20000000-0000-4000-8000-000000000001")
    .eq("label", "1")
    .single();
  if (error) throw error;
  const browser = await chromium.launch();
  try {
    for (let run = 1; run <= 3; run++) {
      const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
        isMobile: true,
        deviceScaleFactor: 1,
      });
      const page = await context.newPage();
      const cdp = await context.newCDPSession(page);
      await cdp.send("Network.enable");
      await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
      // 4G: 9 Mbps download, 1.5 Mbps upload, 150 ms round-trip latency.
      await cdp.send("Network.emulateNetworkConditions", {
        offline: false,
        latency: 150,
        downloadThroughput: 9_000_000 / 8,
        uploadThroughput: 1_500_000 / 8,
        connectionType: "cellular4g",
      });
      await page.addInitScript(() => {
        (window as Window & { qaLcp?: number }).qaLcp = 0;
        new PerformanceObserver((list) => {
          (window as Window & { qaLcp?: number }).qaLcp = list
            .getEntries()
            .at(-1)?.startTime;
        }).observe({ type: "largest-contentful-paint", buffered: true });
      });
      const started = Date.now();
      await page.goto(`${origin}/brasa-bistro/m/${table.qr_token}`, {
        waitUntil: "commit",
      });
      await page
        .getByRole("heading", { name: "Brasa Bistrô", exact: true })
        .waitFor();
      await page
        .getByRole("heading", { name: "Destaques da casa", exact: true })
        .waitFor();
      const visible = Date.now() - started;
      await page.getByLabel("Buscar no cardápio").fill("Picanha");
      await page
        .getByRole("heading", { name: "Destaques da casa", exact: true })
        .waitFor({ state: "hidden" });
      const interactive = Date.now() - started;
      await page.waitForFunction(
        () =>
          Array.from(document.images)
            .filter((image) => image.getBoundingClientRect().top < innerHeight)
            .every((image) => image.complete && image.naturalWidth > 0),
        undefined,
        { timeout: 15_000 },
      );
      const imagesReady = Date.now() - started;
      await page.screenshot({ path: `tmp/menu-4g-${run}.png` });
      const metrics = await page.evaluate(() => ({
        lcp: Math.round((window as Window & { qaLcp?: number }).qaLcp ?? 0),
        ttfb: Math.round(
          (
            performance.getEntriesByType(
              "navigation",
            )[0] as PerformanceNavigationTiming
          ).responseStart,
        ),
      }));
      console.log(
        JSON.stringify({
          run,
          visible_ms: visible,
          interactive_ms: interactive,
          images_ready_ms: imagesReady,
          ...metrics,
        }),
      );
      await context.close();
    }
  } finally {
    await browser.close();
  }
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Falha na medição");
  process.exitCode = 1;
});
