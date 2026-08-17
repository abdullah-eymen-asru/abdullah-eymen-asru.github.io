-- admin_guvenlik_bildirim_worker'ı Supabase'e bağlama şablonu.
-- Bu dosya bir migration DEĞİLDİR, elle çalıştırılacak bir yardımcı script'tir
-- (Supabase Dashboard > SQL Editor içine yapıştırıp çalıştırın).
--
-- Aşağıdaki iki alanı kendi değerlerinizle değiştirin:
--   <WORKER_URL>   -> Cloudflare'de deploy ettiğiniz worker'ın tam adresi
--                      (workers.dev adresi + sonuna /GIZLI_YOL eklenmiş hali)
--   Örnek: https://admin-guvenlik-bildirim-worker.hesap-adiniz.workers.dev/x7f3-admin-guvenlik

update public.guvenlik_bildirim_ayarlari
set webhook_url = '<WORKER_URL>',
    aktif = true
where id = 1;

-- Kontrol: satırın güncellendiğini doğrulamak için
select id, webhook_url, aktif
from public.guvenlik_bildirim_ayarlari
where id = 1;
