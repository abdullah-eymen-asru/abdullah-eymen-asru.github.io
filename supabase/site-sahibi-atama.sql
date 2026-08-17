alter table public.profiles disable trigger trg_prevent_role_escalation;

update public.profiles set role = 'owner' where email = 'SENIN_EPOSTAN@ornek.com';

alter table public.profiles enable trigger trg_prevent_role_escalation;

-- Kontrol İçin
select id, email, role from public.profiles where email = 'SENIN_EPOSTAN@ornek.com';
