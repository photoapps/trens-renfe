# Trens Girona ⇄ Camp de Tarragona

Revisa automàticament els preus de l'AVE a Renfe 4 vegades al dia (GitHub Actions),
els desa a Supabase per a la web i envia un correu si algun tren baixa de preu.

- `revisar.mjs`: la revisió completa.
- `renfe.mjs`: cerca a Renfe amb un Chrome real (Playwright).
- `.github/workflows/revisar.yml`: horari i execució.
- `ultima-revisio.json`: resultat de l'última revisió.

Secrets necessaris (Settings → Secrets and variables → Actions):
`SUPABASE_CLAVE` (obligatori), `GMAIL_USER`, `GMAIL_APP_PASSWORD`, `EMAIL_TO` (per al correu).
