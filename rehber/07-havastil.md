[⬅️ README'ye dön](../README.md)

[📖 Site Rehberi](./01-site-rehberi.md) · [☁️ Cloudflare Secret & Ayarlar](./04-cloudflare-secretlar.md) · **🌦️ HavaStil**

---

# 🌦️ HavaStil — Hava Durumu ve Giyim Danışmanı (v3)

Panelde **Araçlar › 🌦️ HavaStil** ve telefona kurulabilir bağımsız sayfa **`/panel/havastil/`** (PWA). Varsayılan **tüm roller kapalı**, yalnızca Site Sahibi kullanır; açma: **Yetki Ayarları › Özellikler › HavaStil**.

## 1. Kurulum (sırayla)
1. Supabase: `0099_havastil.sql` → `0100_havastil_konum_etiket.sql`.
2. Cloudflare Worker: [rehber/04 § 4.11](./04-cloudflare-secretlar.md) (`GROQ_API_KEY` Secret). Worker olmadan da hava, kombin ve uyarılar çalışır; yalnızca resmî uyarı sekmesi ve yapay zekâ yorumu devre dışı kalır.
3. Siteyi yayınla (`_headers` içinde `geolocation=(self)` şart — aksi halde tarayıcı konumu hiç sormaz).
4. HavaStil › Ayarlar › Yapay zekâ › **Bağlantıyı test et**.

## 2. Sekmeler (v3.1: "İkili Katman")
Arayüz iki algı düzeyine bölündü: **sıradan kullanıcı** 3 saniyede karar alır, **meteoroloji meraklısı** ayrı sekmede sayıları görür. Kıyafetle ilgili her şey **tek bir Kombin sekmesinde** toplandı.

| Sekme | İçerik |
|---|---|
| **Bugün** (sade) | Hüküm (ör. “Şemsiyesiz çıkabilirsin…”), **hissedilen + ölçülen sıcaklık**, 4 kademeli yağış çubuğu (Kurak/Sakin → Hafif çisenti (zararsız) → Sürekli yağmur → Tehlikeli/ani sağanak) ve benzetme (“m²’ye yarım su bardağı”), tek satırlık kombin özeti + etken etiketleri, saatlik akış |
| **Kombin** | Bugünün kombini (iç · çıkarılabilir orta · dış kabuk · alt giyim · ayakkabı) ve her satırın altında **“← neden:” tetikleyici etiketleri**; **Tetikleyiciler** (ölçülen değer, eşik, etkilediği öneriler: iki yönlü); çantaya at/yanına al (her biri etiketli); gün içi kritik an (stilist); gün içi katman planı; plan ve tercihler; CLO hesabı |
| **Derin analiz** (uzman) | **Gün seçicili** (bugün + sonraki günler): gün özeti · **PoP = Güven × Kapsam** (saatlik ısı tablosu) · **CAPE** (şimdi, saatlik, günlük en yüksek, skala ve açıklamalar) · **yağışın fiziği** (saatlik konvektif/geniş cephe grafiği, ani↔sürekli ibresi) · **E = PoP × P** ve 3 karar kuralı · mikro-iklim (hamle, çiğ noktası, basınç eğilimi, UV, yüzey ozonu) · saat saat matris |
| **10 gün** | Günlük min–max, aynı 4 kademeli yağış etiketi, rüzgâr, UV, giyim ipucu |
| **Uyarılar** | Bugün **bu konum** için giyimi etkileyen resmî/güvenilir hava uyarıları |
| **Ayarlar** | Saat bazlı uyarılar, yapay zekâ + bağlantı testi, bulut senkronu, haber doğrulama, gizlilik, teşhis |

Eski sekme adları (`ozet`, `saatlik`) tarayıcıda otomatik yeni sekmelere eşlenir.

**PoP = Güven × Kapsam:** Open-Meteo yalnızca PoP verir. Güven = yağış gören model oranı (ana tahmin + ECMWF + ICON + GFS, saatlik); Kapsam = PoP ÷ Güven (en fazla %100). Bu **tahmini bir ayrıştırmadır**, çarpım her zaman PoP’a eşittir. Model verisi olmayan ileri günlerde yalnızca PoP gösterilir.

**CAPE:** “Şimdi” değeri seçili konumun güncel saatlik model değeridir (↻ ile güncellenir); gün grafiği ve 10 günlük çubuklar saatlik tahminden gelir.

**Tetikleyici sistemi (`tetikleyici.js`):** Isı, plan, sıcaklık algın, gün içi fark, yağış, sürpriz sağanak, zararsız çisenti, rüzgâr, fırtına, ıslak zemin, don, kar, sıcak, UV, hava kalitesi ve sis; her biri değer ve eşiğiyle listelenir, her kombin parçası ve ekstra öneri hangi tetikleyiciden doğduğunu taşır.

## 2A. Yağış ve fırtına dinamikleri (`yagis-fizigi.js`, saf JS)
Open-Meteo’dan saatlik `precipitation_probability, precipitation, rain, showers, cape, wind_gusts_10m, weather_code` okunur. Karar kuralları (eşikler dosyada `ESIK` altında tek yerde):

| # | Kural | Koşul | Sonuç |
|---|---|---|---|
| 1 | Sahte alarm engelleyici | PoP ≥ %70 **ve** E = PoP × P < 0,8 mm | “Zararsız çisenti”; şemsiye ve ağır bot önerilmez |
| 2 | Sürpriz sağanak dedektörü | PoP ≤ %45, `showers` > 0, CAPE > 1000 J/kg | “Atmosfer patlamaya hazır” uyarısı, su geçirmez kabuk + bot |
| 3 | Fırtına / şemsiye kırıcı | CAPE > 1500 J/kg **veya** hamle > 40 km/s | Şemsiye sistemden çıkar; kapüşonlu teknik kabuk |

**Seviye:** 0 kurak · 1 hafif çisenti (zararsız) · 2 sürekli yağmur (saatlik ≥ 1 mm ya da E ≥ 0,8) · 3 tehlikeli/ani sağanak (kural 2, CAPE > 1500 + yağış, ≥ 4 mm/sa, `showers` ≥ 2 mm/sa, gök gürültülü fırtına kodu). Bilerek eklenen güvenlik: zararsız saatler birikip pencerede toplam ≥ 3 mm yaparsa seviye 2’ye çıkar; dondurucu çise/yağmur ve kar “zararsız” sayılmaz. Pencere: şimdiden 22:00’ye (akşam 21’den sonra yarın 07–22).

Motor çıktısı `cekirdek.js`’e **kısıt** olarak girer (yama değil): seviye 1 → yağış kısıtı yok; seviye 2–3 → su geçirmez kat/ayakkabı; kural 3 → rüzgâr seviyesi 2 + şemsiye yasağı.

## 3. CLO motoru (`cekirdek.js`, `katalog.js`)
- `Hedef CLO = (33 − T_etkin)/15 − aktivite`; `T_etkin = hissedilen + kişisel tolerans (−3/0/+3) + küçük nem/ıslaklık düzeltmesi` (hissedilen sıcaklık rüzgâr, nem ve güneşi zaten içerir; çift sayılmaz).
- Kombin **~70 gerçek parçadan** (çekirdek, modüler, kabuk, alt giyim, ayakkabı) seçilir; toplam = `0,10 + 0,85 × Σ parça CLO`. Her parçanın **uygun sıcaklık aralığı** ve özel koşulu vardır (kar pantolonu yalnız karda…).
- **Kısıtlar:** yağış düzeyi (hafif/orta/şiddetli → su itici/geçirmez), rüzgâr/hamle (rüzgâr geçirmez), buz/kar (kaymaz taban), sıcak ofis (**kabuk & çekirdek**: iç kat ≤ 0,80 CLO, kalın yün yasak), modüler gün (Δ ≥ 8 °C → çıkarılabilir ara kat), sıcak hava (ara/dış kat yok), UV, **çanta durumu** (çantan yoksa şemsiye yerine kapüşonlu yağmurluk; çıkardığın katman cebe/bele sığmalı), spor (hızlı kuruyan).
- **Çeşitlilik:** günün tarihinden türeyen tohum öncelikli stili ve eşit parçalar arasındaki seçimi döndürür; her seferinde 3 farklı kombin; tarz seçici (klasik/sportif/sokak/minimalist/dış mekân) ve “🎲 başka kombinler”.
- **Senaryolar:** yaya/toplu · yürüyüş+sıcak ofis · gün boyu dışarıda · araç · gün boyu gezi · koşu/spor.
- **Ek öneriler** (gruplu, öncelikli, ağırlıklı, “cebe sığar”): yağmurluk/şemsiye, yedek çorap, telefon kılıfı, sırt çantası yağmur kılıfı, bere/eldiven/boyunluk/yün çorap, el ısıtıcı, termos, dudak/el kremi, powerbank, SPF/gözlük/şapka/su, elektrolit, maske, görünürlük, araç için buz kazıyıcı/kış lastiği, gün içi çanta…

## 4. Haber doğrulama (sade)
- **Havuz mantığı:** Worker yalnızca hava olaylarıyla ilgili başlıkları iki havuzda (Türkiye, Dünya) toplar (10 dk taze, 90 dk bayat-ama-anında). Tarayıcı havuzu 15 dk saklar. **Tüm konumlar (il, ilçe, mahalle, sokak, kayıtlı yerler) aynı havuzu kullanır → konum değiştirmek ağ isteği doğurmaz.** Konum Worker'a gitmez.
- **Yer eşleşmesi** (tarayıcıda): sokak → mahalle → ilçe → il/şehir → bölge → ülke sırasıyla en özel eşleşme bulunur. Dünya için şehir/bölge/ülke İngilizce adlarıyla.
- **Süzgeçler:** tık tuzağı (soru işareti/sansasyonel kalıp) → yalnızca bugün (konumun saat dilimine göre; gelecek gün/geçmiş/eski haber elenir) → yer → giyim kuralına dönüşebilir mi.
- **Güvenilirlik:** metinde resmî kurum atfı (Meteoroloji, AFAD, Valilik…) → *resmî kurum*; AA/TRT/BBC… → *haber ajansı*; diğer → *haber sitesi*.
- **Veriyle çapraz teyit:** haberdeki olay Open-Meteo verisiyle karşılaştırılır (fırtına↔hamle, sağanak↔yağış ihtimali, don↔en düşük sıcaklık, kar, sıcak, çöl tozu↔toz/PM10, sis↔görüş). Resmî kurum → uygulanır (veri farklıysa not düşülür); ajans → veriyle çelişmiyorsa; genel haber → veriyle uyuşmalı ya da ≥2 kaynak.
- **Uygulama:** doğrulanan uyarılar yama olarak değil, CLO motoruna **kısıt** olarak girer (fırtına → şemsiye yok + rüzgâr geçirmez kat; çöl tozu → açık renk yasak + maske; don → kaymaz kauçuk bot; sağanak → su geçirmez kat…). Mod A'da LLM yoktur.

## 5. Yapay zekâ — “Taktik Stilist” (Mod A / Mod B)
Varsayılan **Mod A: hiçbir yapay zekâ isteği yok**; “Gün içi kritik an” satırı yerel ve deterministik üretilir (`krizSatiri`). Kural motoru kararları (şemsiye, kabuk, bot) zaten arayüzde olduğundan yapay zekâ onları **tekrarlamaz**.

**Kritik an** (`krizAniBul`): planına göre dışarıda olduğun saatler içinde çelişkinin en büyük olduğu saat bulunur (ofis/araçtan çıkış sıcaklık farkı, ani soğuma, hamle, yağış başlangıcı, konvektif enerji). Kritik an yoksa Groq’a hiç sorulmaz.

**Mod B** (isteğe bağlı) Worker’a `v:3` JSON gönderir: sıcaklık, ΔT, hamle, CAPE skoru, yağış seviyesi/türü, beklenen mm, plan, tolerans, çanta, kombin katalog id’leri, bayraklar ve `kriz` (saat, tür, öncesi/sonrası sıcaklık, hamle, mm). Serbest metin, konum ve kimlik gitmez; Worker her alanı aralık/enum olarak doğrular. Doğrulanmış haberin `haberId`’si varsa Worker başlığı kendi havuzundan ekler. **Çıktı standardı:** selam/genel tavsiye yok, tam 2 cümle (1: kriz anı, 2: katmanların nasıl taşınacağı); sunucu 2 cümleye kırpar. **Model:** `openai/gpt-oss-20b` → `-120b` zinciri. Hata olursa arayüz sebebini yazar; ayrıntı için **Bağlantıyı test et**.

## 6. Konumlar ve izinler
- **Arama:** önce internetsiz il eşleşmesi (“Ank” → Ankara), sonra dünya geneli Open-Meteo. **Listeden seçmeden hiçbir konum seçilmez** (önceki sürümde kısmi yazım yanlış yere düşebiliyordu). Sokak/adres yalnızca kullanıcı isterse (OpenStreetMap).
- **Kaydetme:** her sonucun yanındaki ☆ ile tek dokunuş; ad + simge (Ev, İş, Okul…) seçilir; kartlar yatay şeritte, son sıcaklıkla.
- **GPS:** izin yoksa/reddedildiyse ya da site başlığı engelliyorsa **neden** ve **tarayıcıya/cihaza özel adımlar** gösterilir (Chrome, Edge, Firefox, Safari, Samsung Internet, Opera, Brave; macOS/Windows/Android/iOS).
- **Saat bazlı uyarılar:** birden çok uyarı; saat + gün + tür (günlük öneri / yalnızca uyarı varsa). Bildirim izni yalnızca düğmeyle istenir; reddedilirse tarayıcıya özel “nasıl açılır” kartı çıkar.

## 7. Gizlilik / KVKK
Amaç hava + CLO ile giyim kararıdır; **konum toplamak amaç değildir**. GPS, kaydetme, hesapta saklama, haber doğrulama, yapay zekâ — hepsi **opsiyoneldir** (arayüzde “Opsiyonel” rozetli). Aydınlatma metni `kurumsal/kvkk-aydinlatma-metni.md › § 7/A` olarak eklendi (taslak; hukuki danışmanla gözden geçir). Üyelere HavaStil açılırken KVKK sürümünü (v1.1 → v1.2) yükseltmek isteyebilirsin (KVKK sürüm panelinden).

## 8. Bilinen sınırlar
- **Arka plan push yok:** saat bazlı uyarılar HavaStil açıkken (arka planda sekme açık olsa bile) saatinde çalışır; kapalıyken sonraki açılışta 3 saat içindeyse “kaçırılan uyarı” olarak gösterilir. Kesin saatte kapalıyken bildirim için sunucu Web Push (VAPID + abonelik tablosu + zamanlanmış Worker) gerekir.
- Dünya haberleri yalnızca büyük olayları kapsar (uluslararası İngilizce kaynaklar); yerel dilde uyarılar için ulusal meteoroloji kurumuna bak.
- MGM/AFAD için doğrulanmış resmî RSS yok; atıf yoluyla (AA/TRT) görünür.
- Open-Meteo ücretsiz API ticari olmayan kullanım içindir. 15 dakikalık yağış bölgeye göre yoktur (yoksa gizlenir). Polen verisi eklenmedi (Avrupa kapsamlı; Türkiye için güvenilir değil).
- Servis çalışanı yalnızca `/panel/havastil/` kapsamındadır.

## 9. Dosya haritası (`assets/js/havastil/`)
`yagis-fizigi.js` (**yağış & fırtına motoru, PoP ayrıştırma, kriz anı**) · `tetikleyici.js` (**hangi veri hangi öneriyi tetikledi**) · `cekirdek.js` (CLO motoru) · `katalog.js` (parçalar) · `veri.js` (hava/geocoding; rain, showers, cape, ozon) · `hava-kodlari.js` · `iller.js` · `haber-filtre.js` · `taktik.js` · `haber.js` · `izin-yardim.js` · `bildirim.js` · `konumlar.js` · `bulut.js` · `ui-temel.js` · `ui-konum.js` · `ui-sade.js` (**Bugün**) · `ui-uzman.js` (**Derin analiz**) · `ui-kombin.js` (**tek Kombin sekmesi**) · `ui-hava.js` (10 gün) · `ui-haber.js` · `ui-ayar.js` · `arayuz.js` (kabuk) · `panel.js` / `sayfa.js` (girişler).

## v4 — Meteoroloji, UX ve Veri Doğrulama revizyonu

- **Kurulum:** Supabase'de `0101_havastil_dogrulama_vitrin.sql` çalıştır (numeric(9,6) koordinat, `yer_adi/mahalle/sokak`, UPDATE politikası, demo `havastil` bölümü). `havastil_worker/worker.js`'i yeniden deploy et (yeni uç: `GET /yerel-haber?ulke=FR&sehir=Paris`).
- **Yeni sekmeler:** 🗓️ **Saatlik plan** (`ui-plan.js`, 14 güne kadar, saat saat, dokununca kombin tavsiyesi) ve 🔍 **Veri doğrulama** (`ui-lab.js`, herkese açık: ham Open-Meteo değerleri, ECMWF/ICON/GFS karşılaştırması, adım adım CLO formülü ve tetiklenen kurallar, haber doğrulaması). “10 gün” sekmesi artık **14 gün**.
- **PoP = Güven × Kapsam:** PoP %5'in altındaysa ayrıştırma yapılmaz (“·”); model oyu PoP'tan düşükse hücre `*` ile “tahmini” işaretlenir. Efektif yağış ve CAPE halk diliyle (şiddet rozeti, 3 kademeli CAPE özeti) gösterilir.
- **Konum:** koordinat artık yuvarlanmaz; kayıtlarda **konum ismi** (etiket) ve ✏️ düzenle (isim, simge, yeni aramayla koordinat; bulutta UPDATE). Serbest metin ve Ülke → Şehir → İlçe → Mahalle/Cadde araması (Nominatim, yedek Photon); rakım hava yanıtından gelir.
- **Haber (Türkiye dışı):** Worker, ülke kodu + şehir adıyla Google News coğrafi beslemesini (`hl/gl/ceid`) yerel resmî terimle sorgular; yalnızca resmî kurum/Tier-1 ajans ve soru işaretsiz başlıklar geçer.
- **Vitrin (demo/misafir):** konum her zaman İstanbul; “Konumu kaydet/düzenle”, hesap senkronu, haber Worker'ı ve **Mod B (Groq)** kapalı, yalnızca Mod A. Demo menüsü `tool-havastil` → `demo_config.havastil.aktif`.
- Yeni dosyalar: `ui-plan.js`, `ui-lab.js`.

---

## v5 — Kar & Don, 16 gün, misafir akışı, Groq sayacı (migration 0102)

**Kurulum sırası:** (1) Supabase SQL Editor'de `supabase/migrations/0102_havastil_misafir_groq_sayac.sql` çalıştır. (2) Worker'ı yeniden yayınla (`cloudflare worker/havastil_worker/worker.js`). (3) Siteyi yayınla; servis çalışanı sürümü `havastil-v6` olduğundan eski önbellek kendiliğinden temizlenir.

**Kar & Don:** WMO 71/73/75/77/85/86 + snowfall → sıvı eşdeğerden (SWE) taze kar cm; SLR 1:10 (T > −3 °C) / 1:15 (T ≤ −3 °C). Sıfır izotermi (m) ↔ konum rakımı; zemin yüzey sıcaklığı (`soil_temperature_0cm`) ile gizli buzlanma (Dikkat / Yüksek / Çok yüksek). Kar veya buzlanma ≥ Yüksek algılanınca şemsiye iptal; derin kauçuk dişli kar botu, termal içlik, yün/polar ara kat, dış kabuk, bere ve eldiven zorunlu. Derin analizde **🌧️ Yağmur Fiziği / ❄️ Kar & Don Dinamiği** alt sekmeleri vardır (seçilmezse gün fazına göre otomatik).

**16 gün + takvim:** `forecast_days=16`. Saatlik planda açılır mini takvim ve tarih seçici; 16 gün ötesi güne dokunmak **Mevsimlik eğilim** sekmesini o ayla açar (Open-Meteo Climate API, 1991–2020 normaline göre sıcaklık/yağış sapması; hava tahmini değildir).

**Misafir akışı:** Oturumsuz ziyaretçi `/panel/havastil/` adresine girişe atılmadan İstanbul vitrinini görür. Aç/kapa: *Yönetim Paneli › Yetki & Demo Ayarları › HavaStil › Oturumsuz misafir erişimi* (varsayılan AÇIK). SQL gerekmez.

**Groq sayacı:** Her Groq isteği Worker tarafından `havastil_groq_say()` ile sayılır. Kutu: *HavaStil › Veri Doğrulama › 🤖 Groq AI Kota & İstek Takibi* (`Bugün: 42/1.000 istek · Kalan: %95.8`). Site Sahibi her zaman görür; Admin için *Yetki Ayarları › HavaStil Groq Kota Takibini Görüntüleme* anahtarı (varsayılan kapalı). Limitler: `select owner_havastil_groq_limit_ayarla(1000, 30000);`. Gün sınırı UTC'dir.
İsteğe bağlı sertleştirme (sayaç sahteciliği): Worker'a `HAVASTIL_SAYAC_SIRRI` secret'ı ekle ve aynı değeri `select owner_havastil_groq_sayac_sir_ayarla('değer');` ile kaydet.

## v7 — Arayüz ferahlatması, geçmiş gün, bulut öncelikli konumlar

- **Kalem (✏️):** kayıtlı konum kartında artık kartın sağında, dikey ortalı, bağımsız 32 px düğme (görünmez halkayla ≈ 44 px dokunma alanı); sıcaklık ve metinle çakışmaz.
- **Katlanabilir arama:** arama bloğunun üstünde **▲ Gizle**; konum seçilince/GPS başarılı olunca akordeon gibi kapanır, yerine **🔍 Konum Değiştir / Ara** hapı gelir. Açık/kapalı tercihi oturum boyunca (sessionStorage) hatırlanır; varsayılan kapalı. GPS hata mesajı bloğu geçici açar ama tercihi değiştirmez.
- **Geçmiş gün (Saatlik plan › 🕘 Geçmiş bir günü incele):** tarih seçici (1940’tan düne) + Dün / 7 / 30 gün / Geçen yıl bugün. Seçilen gün **≤ 92 gün** ise `api.open-meteo.com/v1/forecast?past_days=N`, **daha eskiyse** `archive-api.open-meteo.com/v1/archive` (ERA5). Arşivde PoP, UV, sıfır izotermi ve sağanak yoktur; `cape` ve 0–7 cm toprak sıcaklığı ayrı istenir, 400 dönerse onlarsız yeniden denenir. Geçmişte yağış olasılığı yerine gerçekleşen değer kullanılır (≥ 0,1 mm → %100). Ekranda *“Geçmiş Hava Durumu (Ölçülen / Gerçekleşen Değerler)”* rozeti ve **Kıyafet retrospektifi** görünür. Sonuç `hv_gecmis1_*` anahtarlarıyla önbelleğe alınır (forecast 3 sa, arşiv 24 sa).
- **Bulut öncelikli konumlar (migration `0104_havastil_bulut_oncelikli_rls.sql`):** oturum açıkken ve kullanıcı onayladıysa (ilk kullanımda tek dokunuşluk davet; bulutta zaten kayıt varsa başka cihazdaki rıza sayılır) açılışta ve sekmeye dönünce bulut doğruluk kaynağıdır; ekle/sil/düzenle anında INSERT/DELETE/UPDATE gider, yerel önbellek sonuçtan sonra yazılır. Ağ/RLS hatasında konum yerelde beklemede kalır ve sonraki eşitlemede yüklenir; silmeler kuyruğa alınır. Vitrin/misafirde buluta hiç istek gitmez (RLS hatası oluşmaz). **0104’ü Supabase SQL Editor’de çalıştır.**

