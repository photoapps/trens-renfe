// Revisió automàtica dels preus de l'AVE Girona ⇄ Camp de Tarragona.
// S'executa a GitHub Actions: llegeix el cap de setmana triat a Supabase, consulta Renfe
// amb un Chrome real, desa els preus a Supabase i envia un correu si algun tren ha baixat.
import { chromium } from "playwright";
import fs from "node:fs";
import { cercar } from "./renfe.mjs";

const SB_URL = "https://xnxlctijcnikrxksijnf.supabase.co";
const SB_KEY = "sb_publishable_5ux0544UjDR7DVAaKJ38bQ_ho5UMq9W"; // clau pública (la mateixa que fa servir la web)
const CLAVE = process.env.SUPABASE_CLAVE; // clau privada per desar preus (secret de GitHub)
const WEB = process.env.WEB_URL || "";
const GIRONA = "79300", CAMP = "04104";
const H = { apikey: SB_KEY, "Content-Type": "application/json" };

const madrid = (d = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const sumaDies = (iso, n) => { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const avui = madrid(), dema = sumaDies(avui, 1);
const proximDivendres = () => { let f = dema; while (new Date(f + "T12:00:00Z").getUTCDay() !== 5) f = sumaDies(f, 1); return f; };
const eur = (n) => n.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
const diaCurt = (f) => new Date(f + "T12:00:00Z").toLocaleDateString("es-ES", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const compra = (o, d, f) => `https://www.renfe.com/es/es/buscador-billetes?origin=${o}&destination=${d}&departure-date=${f}`;

async function sb(path, opts = {}) {
  const r = await fetch(SB_URL + path, { ...opts, headers: { ...H, ...(opts.headers || {}) } });
  if (!r.ok) throw new Error(`Supabase ${path} -> ${r.status} ${await r.text()}`);
  return r.json();
}

async function enviarCorreu(assumpte, text) {
  const { GMAIL_USER, GMAIL_APP_PASSWORD } = process.env;
  const to = process.env.EMAIL_TO || GMAIL_USER;
  if (!GMAIL_USER || !GMAIL_APP_PASSWORD) { console.log("Correu no configurat: no s'envia."); return false; }
  const nodemailer = (await import("nodemailer")).default;
  const t = nodemailer.createTransport({ host: "smtp.gmail.com", port: 465, secure: true, auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD } });
  await t.sendMail({ from: `Trens Girona-Tarragona <${GMAIL_USER}>`, to, subject: assumpte, text });
  return true;
}

const main = async () => {
  if (!CLAVE) throw new Error("Falta el secret SUPABASE_CLAVE");
  const aj = (await sb("/rest/v1/ajustes?select=setmanes,trenes_ida,trenes_vuelta&id=eq.1"))[0] || {};
  let divendres = (aj.setmanes || []).filter((f) => typeof f === "string" && f >= dema).sort().slice(0, 10);
  if (!divendres.length) divendres = [proximDivendres()];
  const feines = divendres.flatMap((f) => [
    { ruta: "ida", fecha: f, o: GIRONA, d: CAMP, nom: "Ida Girona→Tarragona" },
    { ruta: "vuelta", fecha: sumaDies(f, 2), o: CAMP, d: GIRONA, nom: "Vuelta Tarragona→Girona" },
  ]);

  const hist = await sb(`/rest/v1/consultas?select=ruta,fecha,ts,trenes&fecha=gte.${avui}&order=ts.asc&limit=5000`);
  const browser = await chromium.launch({ headless: true });
  const ts = new Date().toISOString();
  const files = [], baixades = [], resum = [];
  for (const f of feines) {
    let res = await cercar(browser, f.o, f.d, f.fecha, null);
    if (!res.ok) res = await cercar(browser, f.o, f.d, f.fecha, null); // segon intent
    console.log(f.nom, f.fecha, res.log.join(" | "));
    if (!res.ok) { resum.push(`${f.nom} ${diaCurt(f.fecha)}: no s'han pogut llegir els preus`); continue; }
    const amb = res.trens.filter((t) => typeof t.precio === "number");
    const min = amb.length ? amb.reduce((a, b) => (b.precio < a.precio ? b : a)) : null;
    files.push({ ruta: f.ruta, fecha: f.fecha, ts, min: min?.precio ?? null, salida: min?.sale ?? null, trenes: res.trens });
    const ant = hist.filter((h) => h.ruta === f.ruta && h.fecha === f.fecha).pop();
    const prev = Object.fromEntries((ant?.trenes || []).map((t) => [t.sale, t.precio]));
    const fav = (f.ruta === "ida" ? aj.trenes_ida : aj.trenes_vuelta) || [];
    for (const t of amb) {
      if (typeof prev[t.sale] === "number" && t.precio < prev[t.sale]) {
        baixades.push({ fav: fav.includes(t.sale), text: `${f.nom}, ${diaCurt(f.fecha)} · AVE ${t.sale}: ${eur(t.precio)} (antes ${eur(prev[t.sale])})`, link: compra(f.o, f.d, f.fecha) });
      }
    }
    resum.push(`${f.nom} ${diaCurt(f.fecha)}: ` + res.trens.map((t) => `${t.sale} ${typeof t.precio === "number" ? eur(t.precio) : t.estado}`).join(" · "));
  }
  await browser.close();

  if (files.length) {
    const n = await sb("/rest/v1/rpc/guardar_consultas", { method: "POST", body: JSON.stringify({ clave: CLAVE, filas: files }) });
    console.log("Files desades:", n);
  }

  baixades.sort((a, b) => b.fav - a.fav);
  let correu = false;
  if (baixades.length) {
    const cos = [
      baixades.length > 1 ? "Han bajado estos AVE:" : "Ha bajado este AVE:",
      ...baixades.map((b) => `• ${b.text}${b.fav ? "  ♥ tu tren" : ""}\n  Comprar: ${b.link}`),
      "",
      "Precios actuales:",
      ...resum.map((r) => "• " + r),
      WEB ? `\nWeb: ${WEB}` : "",
    ].join("\n");
    correu = await enviarCorreu(`↓ Baja el AVE: ${baixades[0].text}`.slice(0, 140), cos);
  }

  const out = { quan: ts, divendres, desades: files.length, baixades: baixades.map((b) => b.text), correu, resum };
  fs.writeFileSync("ultima-revisio.json", JSON.stringify(out, null, 2) + "\n");
  console.log(JSON.stringify(out, null, 2));
  if (!files.length) process.exitCode = 1;
};

main().catch((e) => { console.error(e); fs.writeFileSync("ultima-revisio.json", JSON.stringify({ quan: new Date().toISOString(), error: String(e.message || e) }, null, 2) + "\n"); process.exitCode = 1; });
