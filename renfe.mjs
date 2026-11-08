// Busca els AVE directes de Renfe per a una data i ruta, amb un Chrome real (Playwright).
// Ús: node renfe.mjs ORIGEN DESTI AAAA-MM-DD   (Girona=79300, Camp de Tarragona=04104)
import { chromium } from "playwright";
import fs from "node:fs";

export async function cercar(browser, origin, destination, date, debugName) {
  const ctx = await browser.newContext({
    locale: "es-ES",
    timezoneId: "Europe/Madrid",
    viewport: { width: 1366, height: 900 },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  });
  const page = await ctx.newPage();
  const url = `https://www.renfe.com/es/es/buscador-billetes?origin=${origin}&destination=${destination}&departure-date=${date}`;
  const log = [];
  try {
    const r = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    log.push(`renfe.com status ${r?.status()}`);
    // Cookies
    // Avís de cookies: n'hi ha dues versions; acceptem només les tècniques / rebutgem.
    await page.waitForTimeout(2500);
    for (const nom of [/Permitir solo cookies t[eé]cnicas/i, /Rechazarlas todas/i]) {
      const b = page.getByRole("button", { name: nom }).first();
      if (await b.isVisible({ timeout: 3000 }).catch(() => false)) { await b.click(); log.push("cookies tancades"); break; }
    }
    await page.waitForTimeout(800);
    // Només anada
    await page.getByText("Solo ida", { exact: true }).first().click({ timeout: 20000 });
    const buscar = page.getByRole("button", { name: /Buscar billetes/i }).first();
    for (let i = 0; i < 5; i++) {
      if (await buscar.isEnabled().catch(() => false)) break;
      await page.waitForTimeout(1000);
    }
    await Promise.all([
      page.waitForURL(/venta\.renfe\.com/, { timeout: 60000 }),
      buscar.click(),
    ]);
    log.push(`venta url ${page.url()}`);
    await page.waitForSelector('[aria-label^="Tipo de tren:"]', { timeout: 45000 }).catch(() => {});
    await page.waitForTimeout(2000);
    const trens = await page.evaluate(() => {
      const out = [];
      document.querySelectorAll('[aria-label^="Tipo de tren:"]').forEach((el) => {
        const tipo = el.getAttribute("aria-label").replace("Tipo de tren: ", "").replace(/\.$/, "");
        if (!/^AVE( INT)?$/.test(tipo)) return;
        let r = el;
        for (let i = 0; i < 15 && r; i++) {
          if (/Precio desde|Completo|no se encuentra disponible/.test(r.innerText || "")) break;
          r = r.parentElement;
        }
        const t = (r?.innerText || "").replace(/\s+/g, " ");
        const times = t.match(/\d\d:\d\d/g) || [];
        const p = (t.match(/Precio desde ([\d.,]+) €/) || [])[1];
        out.push({
          tipo,
          sale: times[0],
          llega: times[1],
          precio: p ? Number(p.replace(/\./g, "").replace(",", ".")) : null,
          estado: p ? "disponible" : /Completo/.test(t) ? "Completo" : "No disponible",
        });
      });
      return out;
    });
    log.push(`AVE trobats: ${trens.length}`);
    if (!trens.length && debugName) {
      await page.screenshot({ path: `${debugName}.png`, fullPage: true }).catch(() => {});
      fs.writeFileSync(`${debugName}.txt`, (await page.innerText("body").catch(() => "")).slice(0, 4000));
    }
    return { ok: trens.length > 0, trens, log };
  } catch (e) {
    log.push(`ERROR ${e.message.split("\n")[0]}`);
    if (debugName) {
      await page.screenshot({ path: `${debugName}.png`, fullPage: true }).catch(() => {});
      fs.writeFileSync(`${debugName}.txt`, `${page.url()}\n` + (await page.innerText("body").catch(() => "")).slice(0, 4000));
    }
    return { ok: false, trens: [], log };
  } finally {
    await ctx.close();
  }
}

// Prova manual
if (process.argv[1].endsWith("renfe.mjs") && process.argv.length >= 5) {
  const [o, d, f] = process.argv.slice(2);
  const browser = await chromium.launch({ headless: true });
  const res = await cercar(browser, o, d, f, "debug");
  await browser.close();
  fs.writeFileSync("resultat-prova.json", JSON.stringify({ quan: new Date().toISOString(), ruta: `${o}->${d}`, data: f, ...res }, null, 2));
  console.log(JSON.stringify(res, null, 2));
}
