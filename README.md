# ChessMove

Sayfadaki satranç tahtasını okuyan, en iyi hamleyi hesaplayan ve istenirse o hamleyi
tahtada otomatik oynayan bir Chrome eklentisi (Manifest V3, yan panel).

```
┌─ yan panel ─────────────────┐        ┌─ sayfa ───────────────┐
│ arayüz                      │◀──────▶│ içerik betiği         │
│ motor (Web Worker)          │ mesaj  │ tahtayı okur/oynatır  │
│ görüntü tanıma (ekrandan)   │        │ katman çizer          │
└─────────────────────────────┘        └───────────────────────┘
```

## Kurulum

1. `chrome://extensions` adresini açın.
2. Sağ üstten **Geliştirici modu**nu açın.
3. **Paketlenmemiş öğe yükle** → bu klasörü seçin.
4. Araç çubuğundaki ♞ simgesine tıklayın; yan panel açılır.

## Kullanım

| Adım | Ne olur |
|---|---|
| Panel açılır | Sayfadaki tahta otomatik aranır, bulunursa konum ve sıra gösterilir |
| **Analiz et** | Motor düşünür; en iyi hamle, değerlendirme ve varyant listelenir, tahtaya ok çizilir |
| **Hamleyi oyna** | Hamle gerçek fare olaylarıyla tahtada oynanır |
| **Otomatik oyna** | Durmadan çalışır: sıra size gelince analiz edip oynar, rakibi bekler, tekrar oynar |
| **Sürekli analiz** | Sıra rakipteyken de analiz sürer; değerlendirme ve beklenen cevap canlı kalır |

Kısayollar: `Alt+Shift+A` analiz, `Alt+Shift+P` hamleyi oyna.

### Otomatik mod nasıl çalışır

Açtığınız anda bir döngü başlar ve siz kapatana kadar sürer:

```
konumu oku ──▶ sıra kimde?
                 ├─ bizde  ──▶ analiz ──▶ (gecikme) ──▶ konum hâlâ aynı mı? ──▶ oyna ──┐
                 └─ rakipte ─▶ analiz (canlı değerlendirme) ──▶ bekle ─────────────────┤
                 ▲                                                                     │
                 └─────────────────────────────────────────────────────────────────────┘
```

- Hamleyi oynadıktan sonra beklemez, hemen bir sonraki konumu okumaya döner.
- Analiz ile oynama arasında konum değiştiyse (rakip oynadı, hamle geri alındı)
  hamle iptal edilir; yanlış konuma oynanmaz.
- Tıklama sayfaya geçmezse birkaç saniye sonra aynı hamle yeniden denenir,
  döngü kilitlenmez.
- Mat/pat durumunda hamle uydurmaz, durumu bildirir.
- *Tarama aralığı* ayarı döngünün hızını belirler (varsayılan 0,7 sn).

### Desteklenen tahtalar

- **Lichess** — `cg-board`, taş konumları ve son hamle işareti okunur.
- **Chess.com** — `wc-chess-board`, `square-XY` sınıflarından okunur.
- **Diğer siteler** — iki seçenek var:
  - *Ekrandan tanıma* (aşağıya bakın): konumu ekran görüntüsünden okur.
  - *Ayarlar → Bölge seç*: tahtanın köşelerini sürükleyip bölgeyi tanımlarsınız,
    konumu FEN kutusuna elle yazarsınız. Hamleler seçtiğiniz bölgeye oynanır.

## Ekrandan tanıma

Tuval (canvas) ile çizilen tahtalarda ya da görsel bulmacalarda DOM'da okunacak bir
şey yoktur. Bu modda konum ekran görüntüsünden çıkarılır.

**Bir kez kalibrasyon gerekir.** Tahtayı bilinen bir konuma getirin (en kolayı
başlangıç konumu), *Ekrandan tanıma → Kalibre et* deyin. Eklenti o sitenin taş
setini öğrenir ve bir daha sormaz; şablonlar site adresine göre saklanır.
Sonrasında *Konumu hep ekrandan oku* kutusunu işaretleyin, otomatik mod bu
kaynağı kullanır.

Nasıl çalıştığı:

1. `captureVisibleTab` ile görünen alan yakalanır, tahta bölgesi 512×512'ye kırpılır
   (kendi çizdiğimiz ok ve rozetler önce gizlenir).
2. Karelerin köşelerinden iki zemin rengi kestirilir — böylece son hamle vurgusu
   yapılan kareler de doğru okunur.
3. Her karede zemine uzaklık haritası çıkarılır, Otsu eşiğiyle tohum maske bulunur,
   histerezis eşiklemeyle taşın dış çizgisi de maskeye katılır, kapalı boşluklar
   doldurulur. (Açık zemindeki açık renkli taşta yalnızca dış çizgi, koyu zemindeki
   açık renkli taşta yalnızca iç dolgu eşiği geçer; iki adım ikisini de toparlar.)
4. Siluetten iki ızgara betimleyicisi üretilir — biri kareye göre (taşın boyunu
   korur), biri siluet kutusuna göre (ölçekten bağımsız biçim) — ve öğrenilmiş
   şablonlarla en yakın komşu eşlemesi yapılır.
5. Sonuca satranç kısıtları uygulanır: piyon 1. ve 8. yatayda olamaz, her renkte
   tam bir şah bulunur, piyon sayısı sekizi geçemez.

Güveni düşük kareler panel önizlemesinde sarı çerçeveyle işaretlenir; yanlışsa FEN
kutusundan düzeltip doğru konumla yeniden kalibre edebilirsiniz — öğrenme birikimlidir.

### Sıra kimde?

DOM'da "sıra kimde" bilgisi güvenilir biçimde bulunmadığı için üç kademeli çıkarım var:

1. Sitenin işaretlediği **son hamle** karesi (en güvenilir),
2. iki tarama arasındaki **taş değişimi**,
3. tahta **yönü** (tahmin).

Yanlış giderse *Konum → Sıra* menüsünden elle sabitleyin. Rok hakları şah/kale
başlangıç karesinde mi diye bakılarak tahmin edilir; geçmişte şah oynayıp geri
dönmüş nadir konumlarda FEN'i elle düzeltmeniz gerekebilir.

## Motor

Dahili motor sıfırdan yazıldı, harici bağımlılığı yok:

- 0x88 tahta gösterimi, tam kural desteği (rok, geçerken alma, terfi, 50 hamle)
- alfa-beta + iteratif derinleşme, transpozisyon tablosu (Zobrist),
- null-move budama, geç hamle indirimi (LMR), killer/history sıralaması,
- sessizlik araması (quiescence) + delta budama,
- materyal + kare tabloları + piyon yapısı + kale/fil bonuslarıyla değerlendirme.

Tipik olarak ~1 sn'de derinlik 8–10, 600k+ düğüm/sn. Daha güçlüsü için
`vendor/` klasörüne Stockfish WASM bırakıp Ayarlar'dan açabilirsiniz
(bkz. `vendor/README.md`).

## Geliştirme

```bash
npm test             # hepsi
npm run test:engine  # kural motoru (perft)
npm run test:board   # DOM adaptörleri, koordinat matematiği, sıra çıkarımı
npm run test:vision  # ekrandan tanıma
npm run test:loop    # otomatik oynatma döngüsü
```

Testler tarayıcısız çalışır:

- `test/perft.test.js` — bilinen perft değerleriyle kural motoru, Zobrist tutarlılığı.
- `test/board.test.js` — asgari bir DOM taklidiyle lichess/chess.com adaptörleri.
- `test/vision.test.js` — `test/render-board.js` sentetik tahtalar üretir (farklı
  boyut, tema, vurgulu kareler, gürültü, taş kaymaları); kalibrasyon ve tanıma
  bunlar üzerinde ölçülür.
- `test/loop.test.js` — `test/panel-harness.js` paneli sahte DOM + sahte chrome API
  + gerçek motorla ayağa kaldırır, sahte sayfada rakip de oynar; otomatik modun
  kesintisiz hamle oynadığı, kapatılınca durduğu, mat konumunda hamle uydurmadığı
  ve geçmeyen hamleyi yeniden denediği doğrulanır.

### Dosya düzeni

```
manifest.json
src/engine/    chess.js (kurallar) · evaluate.js · search.js · worker.js
src/vision/    recognizer.js (ekrandan taş tanıma)
src/content/   board-readers.js · overlay.js · player.js · main.js
src/sidepanel/ panel.html · panel.css · panel.js
src/background/service_worker.js
test/          perft · board · vision · loop + yardımcılar
```

### Yeni site desteği eklemek

`src/content/board-readers.js` içine `detect()` ve `read()` metodu olan bir adaptör
ekleyip `readers` dizisine koyun. `read()` şu nesneyi döndürmeli:

```js
{ source, pieces: {'e4':'P', ...}, orientation:'white'|'black',
  rect:{x,y,width,height}, squareSize, lastMove:['e2','e4']|null }
```

## Sorumluluk

Bu araç bulmaca çözme, analiz ve kendi oyunlarınızı inceleme içindir. Lichess ve
chess.com dahil çevrimiçi satranç siteleri, insanlara karşı oynanan partilerde motor
yardımı almayı kurallarıyla yasaklar; oraya karşı kullanmak hesabınızın kapatılmasına
yol açar. Nerede kullandığınız size ait bir sorumluluktur.
