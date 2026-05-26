import express from 'express';
import Parser from 'rss-parser';
import { createClient } from '@supabase/supabase-js';
import fetch from 'node-fetch';

const app = express();
const port = process.env.PORT || 3000;

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);
const parser = new Parser();

const FEEDS = [
  { name: 'TRT Haber', url: 'https://www.trthaber.com/manset_articles.rss', bolge: 'turkiye', dil: 'tr' },
  { name: 'BBC Türkçe', url: 'https://feeds.bbci.co.uk/turkce/rss.xml', bolge: 'turkiye', dil: 'tr' },
  { name: 'Cumhuriyet', url: 'https://www.cumhuriyet.com.tr/rss', bolge: 'turkiye', dil: 'tr' },
  { name: 'Sabah', url: 'https://www.sabah.com.tr/rss/gundem.xml', bolge: 'turkiye', dil: 'tr' },
  { name: 'Al Jazeera EN', url: 'https://www.aljazeera.com/xml/rss/all.xml', bolge: 'dunya', dil: 'en' },
  { name: 'Washington Post', url: 'https://feeds.washingtonpost.com/rss/world', bolge: 'dunya', dil: 'en' },
  { name: 'NY Times', url: 'https://rss.nytimes.com/services/xml/rss/nyt/World.xml', bolge: 'dunya', dil: 'en' },
  { name: 'Der Spiegel', url: 'https://www.spiegel.de/index.rss', bolge: 'dunya', dil: 'de' },
  { name: 'Le Monde', url: 'https://www.lemonde.fr/rss/une.xml', bolge: 'dunya', dil: 'fr' },
  { name: 'RFI', url: 'https://www.rfi.fr/fr/general/rss', bolge: 'dunya', dil: 'fr' },
  { name: 'RT Arabiyya', url: 'https://arabic.rt.com/rss/', bolge: 'dunya', dil: 'ar' },
  { name: 'TASS', url: 'https://tass.com/rss/v2.xml', bolge: 'dunya', dil: 'en' },
  { name: 'Xinhua', url: 'https://www.xinhuanet.com/english/rss/worldrss.xml', bolge: 'dunya', dil: 'en' }
];

const AI_MODELS = [
  "openrouter/free",
  "google/gemini-2.5-flash:free",
  "meta-llama/llama-3.3-70b-instruct:free",
  "qwen/qwen-2.5-72b-instruct:free"
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function askAIWithRotation(prompt) {
  for (const model of AI_MODELS) {
    try {
      console.log(`🤖 ${model} modeli çağrılıyor...`);
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.OPENROUTER_KEY}`,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://nowly.app", 
          "X-Title": "Nowly App"
        },
        body: JSON.stringify({
          model: model,
          messages: [{ role: "user", content: prompt }],
          temperature: 0.5
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`❌ OpenRouter Reddetme Nedeni (${model}):`, errorText);
        continue;
      }

      const data = await response.json();
      if (data.choices && data.choices[0]?.message?.content) {
        return { content: data.choices[0].message.content.trim(), model: model };
      }
    } catch (e) {
      console.error(`❌ Sistem hatası (${model}):`, e.message);
    }
  }
  throw new Error("🚨 Tüm AI limitleri dolu!");
}

app.get('/haber-cek', async (req, res) => {
  console.log("🔄 Tetiklendi! Haber tarama işlemi başladı...");
  let eklenenHaberSayisi = 0;

  for (const feed of FEEDS) {
    try {
      console.log(`📡 ${feed.name} (${feed.dil.toUpperCase()}) çekiliyor...`);
      const feedData = await parser.parseURL(feed.url);
      const sonHaberler = feedData.items.slice(0, 1);

      for (const item of sonHaberler) {
        let haberId = item.guid || item.link || item.id;
        
        if (typeof haberId === 'object' && haberId !== null) {
          haberId = haberId.text || haberId.id || item.link;
        }
        
        if (!haberId && item.title) {
          haberId = "news-" + item.title.toLowerCase().replace(/[^a-z0-9]/g, "").substring(0, 30) + "-" + item.title.length;
        }

        if (!haberId) continue;

        const { data: mevcutHaber } = await supabase.from('haberler').select('id').eq('id', haberId).single();
        
        // LOG EKRANINI CANLANDIRAN YENİ SATIR BURASI:
        if (mevcutHaber) {
          console.log(`ℹ️ Zaten ekli (Atlandı): ${item.title.substring(0, 40)}...`);
          continue;
        }

        await sleep(2500);

        const prompt = `Aşağıdaki haberi oku. Bana sadece şu formatta yanıt ver:\nÖzet: [Haberin tek cümlelik Türkçe özeti]\nKategori: [Gündem, Teknoloji, Ekonomi veya Spor]\n\nBaşlık: ${item.title}\nİçerik: ${item.contentSnippet || item.content || ""}`;

        try {
          const aiResult = await askAIWithRotation(prompt);
          const ozetMatch = aiResult.content.match(/Özet:\s*(.*)/i);
          const kategoriMatch = aiResult.content.match(/Kategori:\s*(.*)/i);

          const ozet = ozetMatch ? ozetMatch[1] : item.contentSnippet || "Özet yok.";
          const kategori = kategoriMatch ? kategoriMatch[1] : "Gündem";

          const { error: supabaseError } = await supabase.from('haberler').insert([{
            id: haberId,
            baslik: item.title,
            link: item.link || haberId,
            ozet: ozet,
            kategori: kategori,
            kaynak: feed.name,
            tarih: item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString(),
            bolge: feed.bolge,
            dil: feed.dil,
            ai_kullanildi: aiResult.model,
            ai_kaynak: 'openrouter'
          }]);

          if (supabaseError) {
            console.error(`❌ Supabase Kayıt Hatası:`, supabaseError.message);
          } else {
            eklenenHaberSayisi++;
            console.log(`🚀 BAŞARILI: Veritabanına kaydedildi: ${item.title}`);
          }
        } catch (aiError) {
          console.error("Haber yapay zeka limitine takıldı, atlandı:", aiError.message);
        }
      }
    } catch (feedError) {
      console.error(`❌ ${feed.name} Okuma Hatası:`, feedError.message);
    }
  }
  res.send(`İşlem başarılı. ${eklenenHaberSayisi} yeni haber eklendi.`);
});

app.get('/', (req, res) => res.send('Nowly Global AI Rotator Canlıda!'));
app.listen(port, () => console.log(`🚀 Sunucu ${port} portunda hazır!`));
