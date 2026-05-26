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

const AI_MODELS = [
  "google/gemini-2.0-flash:free",
  "meta-llama/llama-3.1-8b-instruct:free"
];

async function askAIWithRotation(prompt) {
  for (const model of AI_MODELS) {
    try {
      const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.OPENROUTER_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: model,
          messages: [{ role: "user", content: prompt }],
          temperature: 0.5
        })
      });
      if (response.status === 429 || !response.ok) continue;
      const data = await response.json();
      if (data.choices && data.choices[0]?.message?.content) {
        return data.choices[0].message.content.trim();
      }
    } catch (e) {
      console.error(`${model} hatası:`, e.message);
    }
  }
  throw new Error("🚨 Tüm AI limitleri dolu!");
}

// Tetikleme Noktası (Cron-job burayı çağıracak)
app.get('/haber-cek', async (req, res) => {
  console.log("🔄 Tetiklendi! Haber tarama işlemi başladı...");
  let eklenenHaberSayisi = 0;

  for (const feed of FEEDS) {
    try {
      const feedData = await parser.parseURL(feed.url);
      const sonHaberler = feedData.items.slice(0, 3);

      for (const item of sonHaberler) {
        const haberId = item.guid || item.link;
        const { data: mevcutHaber } = await supabase.from('haberler').select('id').eq('id', haberId).single();
        
        if (mevcutHaber) continue;

        const prompt = `Aşağıdaki haberi oku. Bana sadece şu formatta yanıt ver:\nÖzet: [Haberin tek cümlelik Türkçe özeti]\nKategori: [Gündem, Teknoloji, Ekonomi veya Spor]\n\nBaşlık: ${item.title}\nİçerik: ${item.contentSnippet || item.content || ""}`;

        try {
          const aiYaniti = await askAIWithRotation(prompt);
          const ozetMatch = aiYaniti.match(/Özet:\s*(.*)/i);
          const kategoriMatch = aiYaniti.match(/Kategori:\s*(.*)/i);

          const ozet = ozetMatch ? ozetMatch[1] : item.contentSnippet || "Özet yok.";
          const kategori = kategoriMatch ? kategoriMatch[1] : "Gündem";

          await supabase.from('haberler').insert([{
            id: haberId,
            baslik: item.title,
            ozet: ozet,
            kategori: kategori,
            kaynak: feed.name,
            link: item.link,
            tarih: item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString()
          }]);
          
          eklenenHaberSayisi++;
        } catch (aiError) {
          console.error(aiError.message);
        }
      }
    } catch (feedError) {
      console.error(`${feed.name} hatası:`, feedError.message);
    }
  }
  res.send(`İşlem başarılı. ${eklenenHaberSayisi} yeni haber eklendi.`);
});

// Ana sayfa boş kalmasın
app.get('/', (req, res) => res.send('Nowly AI Rotator Çalışıyor!'));

app.listen(port, () => console.log(`🚀 Sunucu ${port} portunda hazır!`));
