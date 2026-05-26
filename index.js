// ╔══════════════════════════════════════════════════════════════════╗
// ║         NOWLY ZEN NEWS — ANA WORKER (RENDER.COM)                ║
// ║  Google AI birincil → OpenRouter yedek                          ║
// ║  Dünya ajanslarından çok dilli haber toplama                    ║
// ╚══════════════════════════════════════════════════════════════════╝

const express = require('express');
const Parser  = require('rss-parser');
const { createClient } = require('@supabase/supabase-js');

const app    = express();
const parser = new Parser({ timeout: 10000 });
const sleep  = ms => new Promise(r => setTimeout(r, ms));

// ── ORTAM DEĞİŞKENLERİ (Render → Environment'a ekle) ──────────────
const SUPABASE_URL        = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const GOOGLE_AI_KEY       = process.env.GOOGLE_AI_KEY;       // Yeni ekliyoruz
const OPENROUTER_KEY      = process.env.OPENROUTER_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ── DÜNYA AJANSLARI — 20 KAYNAK, 8 DİL ───────────────────────────
const KAYNAKLAR = [
  // 🇹🇷 TÜRKİYE
  { url: 'https://www.trthaber.com/sondakika.rss',                     kaynak: 'TRT Haber',      bolge: 'turkiye',       dil: 'tr' },
  { url: 'https://feeds.bbci.co.uk/turkce/rss.xml',                    kaynak: 'BBC Türkçe',     bolge: 'turkiye',       dil: 'tr' },
  { url: 'https://www.cumhuriyet.com.tr/rss/son_dakika.xml',           kaynak: 'Cumhuriyet',     bolge: 'turkiye',       dil: 'tr' },
  { url: 'https://www.aa.com.tr/tr/rss/default?cat=guncel',            kaynak: 'Anadolu Ajansı', bolge: 'turkiye',       dil: 'tr' },
  { url: 'https://www.sabah.com.tr/rss/anasayfa.xml',                  kaynak: 'Sabah',          bolge: 'turkiye',       dil: 'tr' },

  // 🌍 ULUSLARARASI İNGİLİZCE AJANSLAR
  { url: 'https://feeds.reuters.com/reuters/topNews',                   kaynak: 'Reuters',        bolge: 'dunya',         dil: 'en' },
  { url: 'https://feeds.bbci.co.uk/news/world/rss.xml',                kaynak: 'BBC World',      bolge: 'dunya',         dil: 'en' },
  { url: 'https://rss.cnn.com/rss/edition_world.rss',                  kaynak: 'CNN',            bolge: 'dunya',         dil: 'en' },
  { url: 'https://feeds.skynews.com/feeds/rss/world.xml',              kaynak: 'Sky News',       bolge: 'dunya',         dil: 'en' },
  { url: 'https://www.aljazeera.com/xml/rss/all.xml',                  kaynak: 'Al Jazeera',     bolge: 'orta-dogu',     dil: 'en' },
  { url: 'https://feeds.washingtonpost.com/rss/world',                 kaynak: 'Washington Post', bolge: 'kuzey-amerika', dil: 'en' },
  { url: 'https://rss.nytimes.com/services/xml/rss/nyt/World.xml',     kaynak: 'NY Times',       bolge: 'kuzey-amerika', dil: 'en' },

  // 🇩🇪 ALMANCA
  { url: 'https://www.spiegel.de/schlagzeilen/index.rss',              kaynak: 'Der Spiegel',    bolge: 'avrupa',        dil: 'de' },
  { url: 'https://www.dw.com/de/rss/themen/s-9077/rss.xml',           kaynak: 'DW Deutsch',     bolge: 'avrupa',        dil: 'de' },

  // 🇫🇷 FRANSIZCA
  { url: 'https://www.lemonde.fr/rss/une.xml',                         kaynak: 'Le Monde',       bolge: 'avrupa',        dil: 'fr' },
  { url: 'https://www.rfi.fr/fr/rss',                                  kaynak: 'RFI',            bolge: 'avrupa',        dil: 'fr' },

  // 🇸🇦 ARAPÇA
  { url: 'https://www.aljazeera.net/aljazeerarss/1/1',                 kaynak: 'Al Jazeera AR',  bolge: 'orta-dogu',     dil: 'ar' },
  { url: 'https://arabic.rt.com/rss/',                                 kaynak: 'RT Arabiyya',    bolge: 'orta-dogu',     dil: 'ar' },

  // 🇷🇺 RUSÇA / 🇨🇳 ÇİNCE
  { url: 'https://tass.ru/rss/v2.xml',                                 kaynak: 'TASS',           bolge: 'asya',          dil: 'ru' },
  { url: 'https://www.xinhuanet.com/english/rss/worldrss.xml',         kaynak: 'Xinhua',         bolge: 'asya',          dil: 'zh' },
];

// ── OpenRouter model rotasyonu (yedek için) ────────────────────────
const OR_MODELLER = [
  'google/gemini-2.5-flash:free',
  'qwen/qwen-2.5-72b-instruct:free',
  'mistralai/mistral-7b-instruct:free',
];
let orModelIdx = 0;

// ══════════════════════════════════════════════════════════════════
//  AI FONKSİYONLARI
// ══════════════════════════════════════════════════════════════════

// 1️⃣ BİRİNCİL: Google AI Studio (Gemini 2.0 Flash) — günde 1500 istek ücretsiz
async function googleAI(prompt) {
  if (!GOOGLE_AI_KEY) return null;
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GOOGLE_AI_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 200, temperature: 0.3 }
        })
      }
    );
    if (!res.ok) {
      console.warn(`⚠️ Google AI hata: ${res.status}`);
      return null;
    }
    const d = await res.json();
    return d.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
  } catch (e) {
    console.warn('⚠️ Google AI bağlantı hatası:', e.message);
    return null;
  }
}

// 2️⃣ YEDEK: OpenRouter (ücretsiz modeller, günde 50 istek)
async function openRouterAI(prompt) {
  if (!OPENROUTER_KEY) return null;
  const model = OR_MODELLER[orModelIdx % OR_MODELLER.length];
  orModelIdx++;
  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://nowly-zen-news.com',
        'X-Title': 'Nowly Zen News'
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 200,
        temperature: 0.3
      })
    });
    if (res.status === 429) { console.warn('⚠️ OpenRouter rate limit!'); return null; }
    const d = await res.json();
    return d.choices?.[0]?.message?.content ?? null;
  } catch (e) {
    console.warn('⚠️ OpenRouter bağlantı hatası:', e.message);
    return null;
  }
}

// 3️⃣ AKILLI YÖNLENDİRİCİ: Google dene → başarısızsa OpenRouter → ikisi de yoksa başlık kullan
async function aiOzetAl(haber) {
  const dilAciklama = {
    tr: 'Türkçe', en: 'İngilizce', de: 'Almanca',
    fr: 'Fransızca', ar: 'Arapça', ru: 'Rusça', zh: 'Çince'
  };
  const dilAd = dilAciklama[haber.dil] || 'yabancı dil';

  const prompt = `Sen bir haber editörüsün. Aşağıdaki ${dilAd} haber başlığını ve içeriğini oku.
Haberi Türkçeye çevir ve tek cümlelik Türkçe özet yaz.

Başlık: "${haber.title}"
İçerik: "${(haber.content || haber.contentSnippet || '').slice(0, 400)}"

SADECE şu JSON formatında yanıt ver, başka hiçbir şey yazma:
{"ozet": "Türkçe tek cümlelik özet buraya", "kategori": "Politika/Ekonomi/Spor/Teknoloji/Dünya/Sağlık/Kültür/Bilim/Çevre/Genel"}`;

  // Önce Google dene
  let ham = await googleAI(prompt);
  let kaynak_ai = 'google';

  // Google başarısızsa OpenRouter dene
  if (!ham) {
    console.log('🔄 Google AI başarısız, OpenRouter deneniyor...');
    ham = await openRouterAI(prompt);
    kaynak_ai = 'openrouter';
  }

  // Her ikisi de başarısızsa başlığı kullan
  if (!ham) {
    console.log('⚠️ Her iki AI da başarısız — başlık özet olarak kullanılıyor');
    return { ozet: haber.title, kategori: 'Genel', ai_kaynak: 'none' };
  }

  // JSON parse
  try {
    const eslesme = ham.match(/\{[\s\S]*?\}/);
    if (eslesme) {
      const parsed = JSON.parse(eslesme[0]);
      return { ...parsed, ai_kaynak: kaynak_ai };
    }
  } catch (_) {}

  return { ozet: haber.title, kategori: 'Genel', ai_kaynak: 'fallback' };
}

// ══════════════════════════════════════════════════════════════════
//  ANA HABER ÇEKME FONKSİYONU
// ══════════════════════════════════════════════════════════════════
async function haberCek() {
  console.log('\n🚀 ===== NOWLY HABER ÇEKME BAŞLADI =====');
  console.log(`⏰ Zaman: ${new Date().toISOString()}`);

  let toplamYeni = 0;
  let toplamAI   = 0;

  for (const kaynak of KAYNAKLAR) {
    try {
      console.log(`\n📡 Çekiliyor: ${kaynak.kaynak} (${kaynak.dil.toUpperCase()})`);
      const feed = await parser.parseURL(kaynak.url);

      // Her kaynaktan en güncel 2 haberi al
      const haberler = (feed.items || []).slice(0, 2);

      for (const haber of haberler) {
        const link = haber.link || haber.guid;
        if (!link) continue;

        // Mükerrer kontrolü — aynı link daha önce kaydedilmiş mi?
        const { data: mevcut } = await supabase
          .from('haberler')
          .select('id')
          .eq('link', link)
          .maybeSingle();

        if (mevcut) {
          console.log(`  ⏭️  Zaten var: ${haber.title?.slice(0, 50)}`);
          continue;
        }

        // AI'dan özet ve kategori al
        const aiSonuc = await aiOzetAl({ ...haber, dil: kaynak.dil });
        toplamAI++;

        // Veritabanına kaydet
        const { error } = await supabase.from('haberler').insert({
          baslik:       haber.title || 'Başlıksız',
          link:         link,
          ozet:         aiSonuc.ozet,
          kategori:     aiSonuc.kategori || 'Genel',
          kaynak:       kaynak.kaynak,
          bolge:        kaynak.bolge,
          dil:          kaynak.dil,
          tarih:        haber.pubDate ? new Date(haber.pubDate).toISOString() : new Date().toISOString(),
          ai_kullanildi: aiSonuc.ai_kaynak !== 'none',
          ai_kaynak:    aiSonuc.ai_kaynak,
        });

        if (error) {
          console.error(`  ❌ Kayıt hatası: ${error.message}`);
        } else {
          toplamYeni++;
          console.log(`  ✅ [${aiSonuc.ai_kaynak.toUpperCase()}] ${haber.title?.slice(0, 55)}`);
        }

        // API'leri boğmamak için bekleme (Google için 200ms yeterli)
        await sleep(300);
      }

      // Kaynaklar arası kısa bekleme
      await sleep(500);

    } catch (err) {
      console.error(`❌ ${kaynak.kaynak} HATA: ${err.message}`);
    }
  }

  // Eski haberleri temizle — tabloda max 500 haber tut
  try {
    await supabase.rpc('eski_haberleri_temizle');
  } catch (_) {}

  console.log(`\n🏁 TAMAMLANDI — Yeni: ${toplamYeni} haber, AI: ${toplamAI} istek`);
  console.log('========================================\n');

  return { toplamYeni, toplamAI };
}

// ══════════════════════════════════════════════════════════════════
//  EXPRESS ENDPOINT'LERİ
// ══════════════════════════════════════════════════════════════════

// Cron-Job bu adresi çağırır
app.get('/haber-cek', async (req, res) => {
  try {
    const sonuc = await haberCek();
    res.json({ ok: true, ...sonuc, zaman: new Date().toISOString() });
  } catch (err) {
    console.error('❌ Kritik hata:', err);
    res.status(500).json({ ok: false, hata: err.message });
  }
});

// Render'ın "uyku moduna" girmemesi için basit ping
app.get('/ping', (req, res) => res.send('🟢 Nowly Worker çalışıyor'));

// Ana sayfa
app.get('/', (req, res) => res.send(`
  <h2>🌿 Nowly Zen News Worker</h2>
  <p>✅ Servis aktif</p>
  <p><a href="/haber-cek">Manuel tetikle</a> | <a href="/ping">Ping</a></p>
`));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🌿 Nowly Worker ayakta → port ${PORT}`));
