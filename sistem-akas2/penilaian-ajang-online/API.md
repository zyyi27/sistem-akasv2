# Dokumentasi API

Semua alamat berada di bawah `/api/`. Data dikirim dan diterima sebagai JSON. Aplikasi web memakai API ini; Anda juga dapat
memakainya dari alat lain.

## Autentikasi
- `POST /api/login` dengan `{"role":"a","pin":"..."}` (admin) atau `{"role":"j","pin":"..."}` (asisten juri).
  Balasan: `{"token":"...","me":{...},"dp":true|false}`. `dp` benar jika PIN admin masih bawaan.
- Kirim token pada setiap permintaan lain: `Authorization: Bearer <token>`. Token berlaku 12 jam.
- Percobaan PIN yang salah dibatasi: 8 kali per 5 menit per alamat IP (balasan 429).

## Titik akhir
| Metode dan alamat | Siapa | Fungsi |
|---|---|---|
| `GET /api/health` | publik | Status server dan jenis penyimpanan |
| `GET /api/brand` | publik | Judul, tema, dan logo untuk halaman masuk |
| `POST /api/login` | publik | Masuk |
| `GET /api/me` | masuk | Identitas sesi |
| `POST /api/logout` | masuk | Keluar |
| `GET /api/doc?path=...` | masuk | Baca satu dokumen |
| `POST /api/doc` `{op:"set"|"update",path,data}` | masuk | Tulis dokumen (divalidasi dan dibatasi hak akses) |
| `GET /api/changes?since=N&epoch=E&wait=S` | masuk | Daftar perubahan sejak revisi N. `wait` (maks. 25 detik) menahan permintaan sampai ada perubahan (long-poll) |
| `GET /api/status` | admin | Jenis penyimpanan, jumlah dokumen, galat terakhir |
| `POST /api/admin/pin` `{pin}` | admin | Ganti PIN admin |
| `GET /api/backup` | admin | Unduh seluruh data |
| `POST /api/restore` | admin | Pulihkan dari cadangan |
| `POST /api/reset` | admin | Hapus semua data |

## Dokumen
| Jalur | Isi | Siapa yang boleh menulis |
|---|---|---|
| `meta/setup` | Pengaturan acara, lomba, juri, peserta, asisten, pengesahan, persetujuan koreksi | admin |
| `meta/brand` | Logo acara | admin |
| `sc/<peserta>_<juri>` | Nilai per kriteria `{p,j,cells:{i:{v,t,a,h}}}` | admin; asisten hanya untuk lombanya, selama tidak terkunci |
| `sn/<peserta>` | Penanda nilai terkirim `{p,t}` | admin; asisten untuk lombanya |
| `rq/<id>` | Permintaan koreksi | asisten membuat (menunggu); admin memutuskan |

Aturan yang dijaga server: nilai 0-100; cap waktu tidak boleh jauh di masa depan; nilai dengan cap waktu lebih lama tidak menimpa yang lebih baru;
nilai yang sudah dikirim atau hasil yang sudah disahkan terkunci kecuali admin menyetujui koreksi; asisten tidak melihat PIN dan tidak melihat lomba lain.

## Kode galat
`400 bad_request` data tidak valid, `400 invalid_argument` dokumen belum ada (untuk `update`), `401 unauthenticated`, `403 denied`,
`413` terlalu besar, `429 rate_limited`, `503 unavailable` penyimpanan sementara tidak tersedia (aman diulang).

## Skema database Supabase
Lihat `supabase/schema.sql`: tabel `ajang_docs(path, d jsonb, r bigint)` dan `ajang_kv(k, v jsonb)` dengan Row Level Security aktif tanpa kebijakan
(hanya server dengan kunci service_role yang dapat mengakses).
