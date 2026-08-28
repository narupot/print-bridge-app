/**
 * สร้างไฟล์ icon สำหรับ Electron installer
 * วิธีใช้:
 *   1. วางรูป PNG (1024x1024) ไว้ที่ assets/icon-source.png
 *   2. npm install jimp to-ico  (ครั้งเดียว)
 *   3. node scripts/generate-icon.js
 */

const fs   = require("fs");
const path = require("path");

const ROOT     = path.join(__dirname, "..");
const SRC_PNG  = path.join(ROOT, "assets", "icon-source.png");
const OUT_ICO  = path.join(ROOT, "assets", "icon.ico");
const OUT_PNG  = path.join(ROOT, "assets", "icon.png");

if (!fs.existsSync(SRC_PNG)) {
  console.error("❌  ไม่พบ assets/icon-source.png");
  console.error("    วางรูป PNG (1024×1024) ไว้ที่ไฟล์นั้นก่อน");
  process.exit(1);
}

async function run() {
  const Jimp  = require("jimp");
  const toIco = require("to-ico");

  console.log("📷  อ่านรูปต้นฉบับ...");
  const src = await Jimp.read(SRC_PNG);

  // สร้าง PNG หลายขนาดสำหรับ ICO
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  console.log(`🔄  Resize → ${sizes.join(", ")} px`);

  const pngBuffers = await Promise.all(
    sizes.map(async (size) => {
      const img = src.clone().resize(size, size, Jimp.RESIZE_LANCZOS3);
      return img.getBufferAsync(Jimp.MIME_PNG);
    })
  );

  // บันทึก ICO
  const icoBuffer = await toIco(pngBuffers);
  fs.writeFileSync(OUT_ICO, icoBuffer);
  console.log("✅  สร้าง assets/icon.ico สำเร็จ");

  // บันทึก PNG 512px (สำหรับ electron-builder บน macOS/Linux)
  const png512 = src.clone().resize(512, 512, Jimp.RESIZE_LANCZOS3);
  await png512.writeAsync(OUT_PNG);
  console.log("✅  สร้าง assets/icon.png สำเร็จ");

  console.log("\n🎉  เสร็จแล้ว! ตอนนี้รัน: npm run build");
}

run().catch((err) => {
  console.error("❌  เกิดข้อผิดพลาด:", err.message);
  console.error("    ลอง: npm install jimp to-ico  แล้วรันใหม่");
});
