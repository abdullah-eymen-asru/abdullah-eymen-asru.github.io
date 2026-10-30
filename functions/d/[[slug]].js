/**
 * functions/d/[[slug]].js — Cloudflare Pages: /d/<slug> paylaşım bağlantılarını r2-arsiv-worker'a yönlendirir (0123).
 * GitHub Pages'te aynı işi 404 sayfasındaki /assets/js/paylasim-yonlendir.js görür (statik sunucu dinamik yol bilmez).
 * Gatekeeper (_middleware.js) bu yolu kilitlemez: herkese açık bağlantılar bakım/kilit sırasında da çalışmalı.
 */
const WORKER = "https://r2-arsiv-worker.aeymena.workers.dev";
export function onRequestGet({ params, request }) {
  const slug = [].concat(params.slug || []).join("/");
  if (!/^[A-Za-z0-9-]{6,80}$/.test(slug)) return new Response("Bağlantı bulunamadı", { status: 404, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
  const o = new URL(request.url).searchParams.get("o") === "1" ? "?o=1" : "";
  return Response.redirect(`${WORKER}/d/${slug.toLowerCase()}${o}`, 302);
}
