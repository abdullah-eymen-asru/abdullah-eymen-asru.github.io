---
layout: default
title: Anasayfa
---

<div class="hero">
  <h1>Merhaba, ben Abdullah Eymen Asru 👋</h1>
  <p class="subtitle">Siyaset Bilimi ve Uluslararası İlişkiler Lisans Öğrencisi - İstanbul 29 Mayıs Üniversitesi</p>

  <div class="social-links">
    {% assign labels = "github:GitHub|linkedin:LinkedIn|twitter:X (Twitter)|instagram:Instagram|youtube:YouTube|nsosyal:NSosyal|orcid:ORCID|academia:Academia.edu|researchgate:ResearchGate|kitap1000:1000Kitap|playstore:Uygulama (Google Play Store)" | split: "|" %}
    {% for pair in labels %}
      {% assign parts = pair | split: ":" %}
      {% assign key = parts[0] %}
      {% assign label = parts[1] %}
      {% assign link = site.social[key] %}
      {% if link and link != "" %}
        <a href="{{ link }}" target="_blank">{{ label }}</a>
      {% endif %}
    {% endfor %}
    <a href="{{ site.substack_url }}" target="_blank">Substack</a>
  </div>
</div>

<div class="about-box">
  <h2 style="margin-top:0">Hakkımda</h2>
  <p>Ben Abdullah Eymen Asru. İkokul döneminden itibaren yazmaya karşı ilgim var. Küçük hikâye ve şiirler yazmaktayım. Ortaokul döneminde Arduino hakkında temel eğitimler aldım. Ayrıyeten Scratch üzerine eğitim aldım. Unity üzerinden oyun yapımını öğrenip Google Play Store üzerinden erişime sundum. 7 yıldır belli aralıklarla YouTube kanalım üzerinden araştırdığım konular üzerine içerik üretmekteyim. 
 BTK akademi açıldıktan sonra çeşitli kurslarından birkaçında belli bir bölüme kadar ilerledim ve bazılarını da tamamladım. Lise döneminde makale yazıp sunduğumuz GİSB sempozyumuna katıldım. Sonraki dönemlerde İTO iştirakinden olan BTM tarafından gerçekleştirilen EGG projesinin ilk senesine katıldım ve çeşitli eğitimler alıp sunum gerçekleştirme aşamasını geçerek belge almaya hak kazandım. Geçtiğimiz sene de Teknofest 2023’de Engelsiz Yaşam Teknolojileri kategorisinde takım olarak finale kaldık. Okulumuzda bulunan Cevheran kulübünde dönemsel olarak başkan yardımcılığını yürüttük. Lisenin son zamanlarından itibaren Linux gibi açık kaynak kodlu ve milli olan uygulamaları araştırıp kullanmayı denemekteyim.
 Araştırmayı seven bir yapım var. Yatay öğrenmeyle araştırma yapan bir yapıya sahibim. Şu anda 1. sınıf olarak 29 Mayıs Üniversitesi Siyaset Bilimi ve Uluslararası İlişkiler bölümünde okumaktayım. Son dönemlerde uluslararası ilişkiler alanına dair araştırmalarımı blog sayfamda ve sosyal medya sayfalarımda paylaşmaktayım.
    Burada kendinle ilgili 3-5 cümlelik kısa bir tanıtım yazacaksın: akademik ilgi
    alanların, şu an üzerinde çalıştığın konu, ve varsa kısa bir kişisel not.
    Örnek: "İlgi alanlarım X ve Y üzerine yoğunlaşıyor. Şu anda Z Üniversitesi'nde
    ... konusunda araştırma yapıyorum. Boş zamanlarımda film izlemeyi ve kitap
    okumayı seviyorum — bunları da sitenin ilgili sekmelerinde paylaşıyorum."
  </p>
</div>
