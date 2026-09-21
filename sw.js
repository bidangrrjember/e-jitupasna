/* =========================================================================
   SERVICE WORKER - DASHBOARD JITUPASNA BPBD JEMBER
   =========================================================================
   Tugasnya: membuat aplikasi tetap bisa DIBUKA saat tidak ada sinyal.

   Berkas ini WAJIB diletakkan sejajar dengan index.html di GitHub Pages
   (mis. /peta-bencana-jember/sw.js). Service Worker hanya berkuasa atas
   folder tempat dia berada dan isinya, jadi kalau ditaruh lebih dalam,
   halaman induknya tidak ikut tersimpan.

   Service Worker TIDAK bisa jalan dari berkas lokal (file:// atau yang
   dibuka lewat Telegram/WhatsApp). Harus lewat HTTPS.

   Naikkan VERSI setiap kali index.html diperbarui, supaya petugas di
   lapangan tidak terus memakai versi lama yang tersimpan.
   ========================================================================= */

const VERSI = "v18";
const CACHE_APP = "jitupasna-app-" + VERSI;
const CACHE_UBIN = "jitupasna-ubin";     // sengaja tanpa versi: ubin peta mahal
                                          // diunduh, jangan ikut terhapus tiap rilis

// Kerangka aplikasi. Dipakai relatif supaya ikut ke mana pun folder ini ditaruh.
const ISI_APP = [
  "./",
  "./index.html",
  "https://bidangrrjember.github.io/peta-bencana-jember/logo-bpbd.png"
];

// Pustaka pihak ketiga. Disimpan saat pertama kali diminta (bukan di awal),
// supaya pemasangan tidak gagal total hanya karena satu CDN sedang bermasalah.
const ASAL_PUSTAKA = [
  "https://unpkg.com",
  "https://cdn.jsdelivr.net",
  "https://npmcdn.com",
  "https://cdn.tailwindcss.com",
  "https://fonts.googleapis.com",
  "https://fonts.gstatic.com",
  "https://bidangrrjember.github.io"
];

const ASAL_UBIN = ["https://tile.openstreetmap.org", "https://server.arcgisonline.com"];

/* Ubin lama dari server OSM dibuang sekali. Balasan "Access blocked"
   mereka berstatus 200, jadi ia tersimpan seperti ubin biasa - dan akan
   terus tersaji dari cache meski kodenya tidak lagi memintanya. */
const ASAL_BUANG = ["openstreetmap.fr", "basemaps.cartocdn.com"];

/* Ubin blokir OSM berstatus 200 dan berukuran tetap 6933 byte - gambar
   yang SAMA untuk setiap petak. Kalau tidak ditolak di sini, ia tersimpan
   seperti ubin biasa dan terus tersaji dari cache lama setelah blokirnya
   lepas. Ukurannya dipakai sebagai tanda karena tajuk x-blocked tidak
   selalu bisa dibaca dari sisi halaman. */
const UKURAN_UBIN_BLOKIR = 6933;

self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(CACHE_APP)
      .then(function (c) { return c.addAll(ISI_APP); })
      .then(function () { return self.skipWaiting(); })
      .catch(function (err) { console.error("[sw] gagal memasang:", err); })
  );
});

/* Ubin lama dari server OSM dibuang satu per satu dari CACHE_UBIN.
   Cache-nya sendiri TIDAK dihapus - ubin CARTO dan Esri yang sudah
   terkumpul tetap dipakai; yang dibuang hanya yang asalnya sudah tidak
   diminta lagi. Tanpa ini, gambar "Access blocked" dari OSM terus
   tersaji dari simpanan meski kodenya sudah pindah penyedia: balasan
   blokir itu berstatus 200, jadi ia tersimpan seperti ubin biasa. */
function buangUbinLama() {
  return caches.open(CACHE_UBIN).then(function (c) {
    return c.keys().then(function (permintaan) {
      return Promise.all(permintaan.map(function (req) {
        return cocok(req.url, ASAL_BUANG) ? c.delete(req) : null;
      }));
    });
  }).catch(function () { /* cache belum ada - tidak ada yang perlu dibuang */ });
}

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (kunci) {
      return Promise.all(kunci.map(function (k) {
        // Buang cache app versi lama, tapi JANGAN sentuh cache ubin peta
        if (k !== CACHE_APP && k !== CACHE_UBIN) return caches.delete(k);
      }));
    })
      .then(buangUbinLama)
      .then(function () { return self.clients.claim(); })
  );
});

function cocok(url, daftar) {
  return daftar.some(function (a) { return url.indexOf(a) === 0; });
}

self.addEventListener("fetch", function (e) {
  const req = e.request;

  // Hanya GET yang boleh disimpan. Pengiriman laporan (POST ke Apps Script)
  // harus lewat apa adanya - kalau dicegat, antrean offline di halaman tidak
  // akan pernah tahu apakah kiriman benar-benar sampai.
  if (req.method !== "GET") return;

  const url = req.url;

  // Data dari Apps Script tidak pernah disimpan: laporan basi lebih berbahaya
  // daripada tidak ada data sama sekali.
  if (url.indexOf("script.google.com") !== -1 ||
      url.indexOf("script.googleusercontent.com") !== -1) return;

  // Cuaca & kualitas udara: biarkan gagal saat offline, jangan sajikan yang basi
  if (url.indexOf("api.open-meteo.com") !== -1 ||
      url.indexOf("air-quality-api.open-meteo.com") !== -1) return;

  // --- Ubin peta: ambil dari simpanan dulu ---
  if (cocok(url, ASAL_UBIN)) {
    e.respondWith(
      caches.open(CACHE_UBIN).then(function (c) {
        return c.match(req).then(function (tersimpan) {
          if (tersimpan) return tersimpan;
          return fetch(req).then(function (res) {
            // Ubin di luar wilayah yang disiapkan tetap disimpan saat online,
            // jadi daerah yang pernah dibuka ikut tersedia offline.
            //
            // TAPI: ubin blokir OSM juga berstatus 200. Kalau ia tersimpan,
            // ia akan terus tersaji dari cache lama setelah blokirnya lepas -
            // watermark yang tidak pernah hilang meski masalahnya sudah
            // selesai. Jadi yang berukuran tepat sama dengan ubin blokir
            // ditolak: disajikan ke halaman, tapi tidak disimpan.
            if (res && res.status === 200) {
              const panjang = Number(res.headers.get("content-length"));
              const diblokir = res.headers.get("x-blocked") !== null ||
                               panjang === UKURAN_UBIN_BLOKIR;
              if (!diblokir) c.put(req, res.clone());
            }
            return res;
          }).catch(function () {
            return new Response("", { status: 504, statusText: "Ubin tidak tersedia offline" });
          });
        });
      })
    );
    return;
  }

  // --- Aplikasi & pustaka: sajikan simpanan, perbarui di latar ---
  if (cocok(url, ASAL_PUSTAKA) || url.indexOf(self.location.origin) === 0) {
    e.respondWith(
      caches.open(CACHE_APP).then(function (c) {
        return c.match(req).then(function (tersimpan) {
          const dariJaringan = fetch(req).then(function (res) {
            if (res && res.status === 200) c.put(req, res.clone());
            return res;
          }).catch(function () { return null; });

          // Ada simpanan -> pakai itu (cepat & tahan offline), sambil
          // memperbarui diam-diam untuk kunjungan berikutnya.
          if (tersimpan) { dariJaringan; return tersimpan; }

          return dariJaringan.then(function (res) {
            if (res) return res;
            // Permintaan halaman yang gagal total -> berikan aplikasi tersimpan
            if (req.mode === "navigate") return c.match("./index.html");
            return new Response("", { status: 504, statusText: "Tidak tersedia offline" });
          });
        });
      })
    );
  }
});

// Halaman bisa meminta pembaruan segera setelah index.html berganti versi
self.addEventListener("message", function (e) {
  if (e.data && e.data.tipe === "lewatiMenunggu") self.skipWaiting();
});
