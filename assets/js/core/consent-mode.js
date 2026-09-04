/*
 * assets/js/core/consent-mode.js
 *
 * GOOGLE CONSENT MODE v2 — VARSAYILAN (DEFAULT) DURUM
 * -----------------------------------------------------------------------
 * SORUN (GA4 uyarısı): "Analytics çerez izni sinyalleri etkin değil
 * (analytics_storage)". Site zaten çerez onayı ALINMADAN GA4/AdSense
 * script'lerini hiç yüklemiyor (bkz. site-islemleri.js "varsayılan =
 * kapalı" ilkesi) — ama bu, GA4'ün beklediği şey DEĞİL: GA4 diagnostics,
 * sayfanın Google'ın Consent Mode API'siyle HİÇ konuşmadığını (ne
 * "denied" ne "granted" — sessizce hiçbir sinyal yok) tespit edip bu
 * uyarıyı veriyor. Google'ın resmi Consent Mode entegrasyonu, GA4/Ads
 * script'i yüklenmeden ÖNCE bir "varsayılan durum" bildirmeyi ŞART koşar
 * — script sonradan (onay alınınca) yüklense bile.
 *
 * ÇÖZÜM: dataLayer/gtag() burada, sayfadaki HERHANGİ bir başka script'ten
 * (GA4 loader, AdSense loader, site-islemleri.js) ÖNCE tanımlanır ve
 * gtag('consent','default', ...) ile dört sinyal de ("denied") kaydedilir.
 * Bu komut dataLayer'a push edildiği an (gerçek gtag.js kütüphanesi HENÜZ
 * yüklenmemiş olsa bile) GA4/Ads bu durumu daha sonra script yüklenince
 * OKUYABİLİR — dataLayer bir kuyruk olduğu için sıra korunur.
 *
 * NEDEN SENKRON (defer/async YOK): bu script <head>'in en başına,
 * mümkün olduğunca erken konur ki dataLayer.push sırası HER ZAMAN
 * gtag('js', ...)/gtag('config', ...) çağrılarından ÖNCE gelsin. Dosya
 * tek satırlık, ağdan çok küçük indiği için bunun sayfa çizimine
 * ölçülebilir bir gecikmesi yoktur.
 *
 * KATEGORİ EŞLEŞMESİ (bkz. site-islemleri.js analitikUygula/reklamUygula):
 *   - "Analitik" onay kutusu  -> analytics_storage
 *   - "Reklam" onay kutusu    -> ad_storage, ad_user_data, ad_personalization
 * Ziyaretçi bu kategorilerden birini kabul/red ettiğinde site-islemleri.js
 * ilgili gtag('consent','update', {...}) çağrısını yapar — bu dosya
 * SADECE ilk (sayfa henüz hiçbir tercihi okumadan önceki) varsayılanı
 * tanımlar; site-islemleri.js init() daha önce kaydedilmiş bir tercih
 * bulursa (mevcut ziyaretçi) bu varsayılanın hemen üzerine gerçek
 * durumu 'update' ile yazar — sıra dataLayer'da korunduğu için hiçbir
 * çelişki oluşmaz.
 */
window.dataLayer = window.dataLayer || [];
function gtag() {
  window.dataLayer.push(arguments);
}
window.gtag = gtag;

gtag("consent", "default", {
  analytics_storage: "denied",
  ad_storage: "denied",
  ad_user_data: "denied",
  ad_personalization: "denied",
  // wait_for_update: gtag.js/GTM'in kendi tag'lerini ateşlemeden önce
  // (varsa) bir güncelleme sinyali için ne kadar (ms) bekleyeceği.
  // Bu sitede GA4 script'inin kendisi zaten onaya kadar hiç
  // yüklenmiyor, bu yüzden pratik bir etkisi yok — yine de resmi
  // Consent Mode belgelerinin önerdiği güvenlik payı olarak bırakıldı.
  wait_for_update: 500,
});
