-- Skema penyimpanan Penilaian Ajang untuk Supabase (Postgres).
-- Cara pakai: buka proyek Supabase > SQL Editor > New query > tempel seluruh isi berkas ini > Run.
-- Aman dijalankan berulang kali.

create table if not exists public.ajang_docs (
  path       text primary key,                 -- contoh: sc/<peserta>_<juri>, sn/<peserta>, rq/<id>, meta/setup
  d          jsonb       not null,             -- isi dokumen
  r          bigint      not null,             -- nomor revisi (naik tiap perubahan)
  updated_at timestamptz not null default now()
);

create table if not exists public.ajang_kv (
  k          text primary key,                 -- state, admin, pins, sessions
  v          jsonb       not null,
  updated_at timestamptz not null default now()
);

create index if not exists ajang_docs_r_idx on public.ajang_docs (r);

-- Keamanan: aktifkan Row Level Security TANPA kebijakan apa pun.
-- Dengan begitu kunci publik (anon/authenticated) tidak bisa membaca atau menulis sama sekali.
-- Hanya server (memakai kunci service_role yang rahasia) yang dapat mengakses data.
alter table public.ajang_docs enable row level security;
alter table public.ajang_kv   enable row level security;
revoke all on public.ajang_docs from anon, authenticated;
revoke all on public.ajang_kv   from anon, authenticated;
