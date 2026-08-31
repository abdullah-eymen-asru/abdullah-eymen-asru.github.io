<div class="lang-tabs">
  <button type="button" class="lang-tab-btn active" data-lang="en">🇬🇧 English</button>
  <button type="button" class="lang-tab-btn" data-lang="tr">🇹🇷 Türkçe</button>
</div>

<script>
  (function () {
    // NOT: Bu buton için eskiden onclick="..." inline attribute'u
    // kullanılıyordu. CSP'nin script-src'si sadece <script> ELEMENT
    // içeriklerini SHA-256 hash'leyip izin veriyor (bkz.
    // _plugins/csp_hash_enjekte.rb) — inline event handler ATTRIBUTE'ları
    // ('unsafe-hashes' gerektirir) kapsam dışı, bu yüzden onclick sessizce
    // bloklanıyor ve butonlar tıklanınca hiçbir şey olmuyordu. Çözüm:
    // mantığı gerçek bir <script> elementine taşımak — bu blok build
    // sırasında otomatik hash'lenip CSP'ye eklenir.
    document.querySelectorAll(".lang-tab-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var lang = btn.getAttribute("data-lang");
        document.querySelectorAll(".lang-panel").forEach(function (p) {
          p.classList.remove("active");
        });
        document.querySelectorAll(".lang-tab-btn").forEach(function (b) {
          b.classList.remove("active");
        });
        document.getElementById("lang-" + lang).classList.add("active");
        btn.classList.add("active");
      });
    });
  })();
</script>

<div id="lang-en" class="lang-panel active">
  <h2>🎯 About Me</h2>
  <p>I am an International Relations student with a keen interest in <strong>geostrategic resource competition and great power dynamics</strong>, particularly in regions like the Arctic. My goal is to combine traditional qualitative analysis with data-driven research tools to explore how resource scarcity and strategic chokepoints shape global politics.</p>

  <h2>💻 Technical Background &amp; Skills</h2>
  <ul>
    <li>🌐 <strong>Technical Interests:</strong> Enthusiastic about open-source technologies (<code>Linux</code>, <code>Open WebUI</code>) and leveraging open-source applications for academic research.</li>
    <li>🛠️ <strong>Background:</strong> My technical journey began with Scratch, basic Arduino, Android Studio and Unity projects, which laid the foundation for my interest in technical methodologies in social sciences.</li>
  </ul>

  <h2>📚 Research &amp; Content Creation</h2>
  <ul>
    <li>📝 <strong>Blog:</strong> I write analytical blog posts on <strong>strategic competition, resource geopolitics, and geoeconomic trends</strong>.</li>
    <li>🎥 <strong>YouTube:</strong> I create educational content and analysis videos on <strong>strategic studies, geopolitics, and international security</strong>.</li>
  </ul>
</div>

<div id="lang-tr" class="lang-panel">
  <h2>🎯 Hakkımda</h2>
  <p>Uluslararası İlişkiler öğrencisiyim. Çalışmalarımı özellikle Arktik gibi bölgelerdeki <strong>jeostratejik kaynak rekabeti ve büyük güç dinamikleri</strong> üzerine yoğunlaştırıyorum. Amacım, kaynak kıtlığının ve stratejik deniz geçiş noktalarının küresel siyaseti nasıl şekillendirdiğini incelemek için geleneksel nitel analizleri veriye dayalı araştırma araçlarıyla birleştirmektir.</p>

  <h2>💻 Teknik Geçmiş ve İlgi Alanları</h2>
  <ul>
    <li>🌐 <strong>Teknik İlgi Alanları:</strong> Açık kaynaklı teknolojilere (<code>Linux</code>, <code>Open WebUI</code>) ve akademik araştırmalarda açık kaynaklı uygulamalardan yararlanmaya ilgi duyuyorum.</li>
    <li>🛠️ <strong>Geçmiş:</strong> Teknik yolculuğum Scratch, temel Arduino, Android Studio ve Unity projeleriyle başladı; bu süreç sosyal bilimlerdeki teknik metodolojilere olan ilgimin temelini oluşturdu.</li>
  </ul>

  <h2>📚 Araştırma ve İçerik Üretimi</h2>
  <ul>
    <li>📝 <strong>Blog:</strong> <strong>Stratejik rekabet, kaynak jeopolitiği ve jeoekonomik eğilimler</strong> üzerine analitik blog gönderileri yazıyorum.</li>
    <li>🎥 <strong>YouTube:</strong> <strong>Stratejik çalışmalar, jeopolitik ve uluslararası güvenlik</strong> konularında eğitici içerikler ve analiz videoları üretiyorum.</li>
  </ul>
</div>
