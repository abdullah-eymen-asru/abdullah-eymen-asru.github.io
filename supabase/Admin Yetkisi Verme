-- 1. Güvenlik tetikleyicisini geçici olarak devre dışı bırak
ALTER TABLE public.profiles DISABLE TRIGGER trg_prevent_role_escalation;

-- 2. Profilini admin yap (E-postanı veya UUID adresini kontrol et)
UPDATE public.profiles 
SET role = 'admin' 
WHERE email = 'mail@mail.com';

-- 3. Güvenlik tetikleyicisini tekrar aktif et
ALTER TABLE public.profiles ENABLE TRIGGER trg_prevent_role_escalation;

--4. Adimin Başarılı Oldu mu Doğrulama
SELECT id, email, role FROM public.profiles WHERE email = 'mail@mail.com';
