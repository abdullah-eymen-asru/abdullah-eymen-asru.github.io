---
layout: default
title: İletişim
---

<h1>İletişim</h1>
<p>Bana aşağıdaki formu kullanarak mesaj gönderebilirsin, direkt e-postama düşer.</p>

<form class="contact-form" action="https://formspree.io/f/{{ site.formspree_id }}" method="POST">
  <input type="text" name="name" placeholder="İsminiz" required>
  <input type="email" name="email" placeholder="E-posta adresiniz" required>
  <textarea name="message" rows="6" placeholder="Mesajınız" required></textarea>
  <button type="submit">Gönder</button>
</form>

<p style="margin-top:2em; color:var(--muted); font-size:0.9rem;">
  Alternatif olarak bana <a href="mailto:seninmail@ornek.com">seninmail@ornek.com</a>
  adresinden de ulaşabilirsin.
</p>
