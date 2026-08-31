update public.guvenlik_bildirim_ayarlari
set webhook_secret = '2. ADIMDA ÜRETTİĞİN AYNI DEĞER'
where id = 1;

-- doğrula:
select webhook_secret, length(webhook_secret) from public.guvenlik_bildirim_ayarlari where id = 1;
