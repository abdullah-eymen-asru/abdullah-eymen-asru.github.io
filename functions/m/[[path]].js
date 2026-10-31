/**
 * functions/m/[[path]].js — Cloudflare Pages: /m/<yazi>/<dosya> (yazı medyası, 0128) → r2-arsiv-worker'a 302.
 * GitHub Pages'te aynı işi 404 sayfasındaki paylasim-yonlendir.js (bağlantı/PDF) ve r2-medya.js (görseller) yapar.
 */
const WORKER = "https://r2-arsiv-worker.aeymena.workers.dev";
export function onRequestGet({ params }) {
  const p = [].concat(params.path || []);
  if (p.length !== 2 || !/^[a-z0-9][a-z0-9-]{0,119}$/.test(p[0]) || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,150}$/.test(p[1]))
    return new Response("Dosya bulunamadı", { status: 404, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
  return Response.redirect(`${WORKER}/m/${p[0]}/${encodeURIComponent(p[1])}`, 302);
}
