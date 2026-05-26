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
  { name: 'TRT Haber', url: 'https://www.trthaber.com/manset_articles.rss' },
  { name: 'BBC Türkçe', url: 'https://feeds.bbci.co.uk/turkce/rss.xml' },
  { name: 'Cumhuriyet', url: 'https://www.cumhuriyet.com.tr/rss' }
];

// OpenRouter'ın şu an yayında olan en güncel ücretsiz modelleri
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
        console.error(`❌ OpenRouter Reddetme Nedeni (${model} - Durum ${response.status}):`, errorText);
        continue;
      }

      const data = await response.json();
      if (data.choices && data.choices[0]?.message?.content) {
        return data.choices[0].message.content.trim();
      }
    } catch (e) {
      console.error(`❌ Sistem hatası (${model}):`, e.message);
    }
  }
  throw new Error("🚨 Maalesef rotasyondaki tüm AI modellerinin limitleri şu an dolu!");
}

app.get('/haber-cek', async (req, res) => {
  console.log("🔄 Tetiklendi! Haber tarama işlemi başladı...");
  let eklenenHaberSayisi = 0;

  for (const feed of FEEDS) {
    try {
      const feedData = await parser.parseURL(feed.url);
      
      // EKONOMİK MOD: Günlük 50 limiti korumak için sadece EN GÜNCEL 1 HABERİ alıyoruz
      const sonHaberler = feedData.items.slice(0, 1);

      for (const item of sonHaberler) {
        const haberId = item.guid || item.link;
        
        const { data: mevcutHaber } = await supabase.from('haberler').select('id').eq('id', haberId).single();
        if (mevcutHaber) continue;

        // Anti-Spam Koruması: İki istek arasında 2.5 saniye mola
        await sleep(2500);

        const prompt = `Aşağıdaki haberi oku. Bana sadece şu formatta yanıt ver:\nÖzet: [Haberin tek cümlelik Türkçe özeti]\nKategori: [Gündem, Teknoloji, Ekonomi veya Spor]\n\nBaşlık: ${item.title}\nİçerik: ${item.contentSnippet || item.content || ""}`;

        try {
          const aiYaniti = await askAIWithRotation(prompt);
          const ozetMatch = aiYaniti.match(/Özet:\s*(.*)/i);
          const kategoriMatch = aiYaniti.match(/Kategori:\s*(.*)/i);

          const ozet = ozetMatch ? ozetMatch[1] : item.contentSnippet || "Özet yok.";
          const kategori = kategoriMatch ? kategoriMatch[1] : "Gündem";

          const { error: supabaseError } = await supabase.from('haberler').insert([{
            id: haberId,
            baslik: item.title,
            ozet: ozet,
            kategori: kategori,
            kaynak: feed.name,
            link: item.link,
            tarih: item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString()
          }]);

          if (supabaseError) {
            console.error(`❌ Supabase Veritabanı Kayıt Hatası:`, supabaseError.message);
          } else {
            eklenenHaberSayisi++;
            console.log(`🚀 BAŞARILI: Haber veritabanına işlendi: ${item.title}`);
          }
        } catch (aiError) {
          console.error("Haber işlenirken atlandı:", aiError.message);
        }
      }
    } catch (feedError) {
      console.error(`${feed.name} RSS okuma hatası:`, feedError.message);
    }
  }
  res.send(`İşlem başarılı. ${eklenenHaberSayisi} yeni haber eklendi.`);
});

app.get('/', (req, res) => res.send('Nowly AI Rotator Çalışıyor!'));
app.listen(port, () => console.log(`🚀 Sunucu ${port} portunda hazır!`));
