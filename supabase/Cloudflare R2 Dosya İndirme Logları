create table if not exists public.indirme_loglari (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete set null,
  dosya_adi text not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- RLS Politikası: Sadece Worker service_role ile yazabilsin veya kullanıcılar kendi geçmişini görebilsin
alter table public.indirme_loglari enable row level security;
