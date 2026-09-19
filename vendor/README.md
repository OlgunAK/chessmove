# Stockfish (isteğe bağlı)

Dahili motor derinlik 8–12 civarında oynar; çoğu taktik bulmacası için yeter.
Daha güçlüsünü isterseniz Stockfish'in WASM sürümünü buraya bırakın:

1. `stockfish.js` (ve varsa `stockfish.wasm`) dosyalarını bu klasöre kopyalayın.
   Örnek kaynak: https://github.com/lichess-org/stockfish.wasm veya
   https://github.com/nmrugg/stockfish.js — tek dosyalık (single-file) build tercih edin.
2. Eklentiyi Chrome'da yeniden yükleyin.
3. Panelde **Ayarlar → Stockfish kullan** kutusunu işaretleyin.

Dosya bulunamazsa eklenti sessizce dahili motora döner.
WASM derlemeleri `manifest.json`'da ek CSP gerektirebilir; bu durumda
`"content_security_policy": {"extension_pages": "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'"}`
satırını ekleyin.
