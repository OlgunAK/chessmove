# ChessMove

Sayfadaki satranç tahtasını okuyan, en iyi hamleyi hesaplayan ve istenirse o hamleyi
tahtada otomatik oynayan bir Chrome eklentisi (Manifest V3, yan panel).

```
┌─ yan panel ──────────┐        ┌─ sayfa ───────────────┐
│ arayüz + motor       │◀──────▶│ içerik betiği         │
│ (Web Worker)         │ mesaj  │ tahtayı okur/oynatır  │
└──────────────────────┘        └───────────────────────┘
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
| **Otomatik oyna** | Sıra size geldiğinde analiz edip hamleyi kendisi oynar |

Kısayollar: `Alt+Shift+A` analiz, `Alt+Shift+P` hamleyi oyna.

### Desteklenen tahtalar

- **Lichess** — `cg-board`, taş konumları ve son hamle işareti okunur.
- **Chess.com** — `wc-chess-board`, `square-XY` sınıflarından okunur.
- **Diğer siteler** — *Ayarlar → Bölge seç* ile tahtanın köşelerini sürükleyip
  bölgeyi tanımlayın, konumu FEN kutusuna yazın. Hamleler seçtiğiniz bölgenin
  karelerine oynanır. (Bu modda konum ekrandan okunmaz, elle girilir.)

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
npm test            # perft + tahta okuma testleri
npm run test:engine # sadece kural motoru (perft)
npm run test:board  # sadece DOM adaptörleri ve FEN çıkarımı
```

`test/perft.test.js` bilinen perft değerleriyle kural motorunu, `test/board.test.js`
asgari bir DOM taklidiyle lichess/chess.com adaptörlerini, koordinat matematiğini
ve sıra çıkarımını doğrular.

### Dosya düzeni

```
manifest.json
src/engine/    chess.js (kurallar) · evaluate.js · search.js · worker.js
src/content/   board-readers.js · overlay.js · player.js · main.js
src/sidepanel/ panel.html · panel.css · panel.js
src/background/service_worker.js
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
