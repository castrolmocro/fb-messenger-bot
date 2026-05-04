const { createCanvas, loadImage } = require("canvas");
const path = require("path");
const fs = require("fs-extra");

async function generateWelcomeCard({ name, avatarURL }) {
  const width = 800;
  const height = 300;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  // Background gradient
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, "#0f0c29");
  gradient.addColorStop(0.5, "#302b63");
  gradient.addColorStop(1, "#24243e");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  // Circle avatar border
  ctx.save();
  ctx.beginPath();
  ctx.arc(150, 150, 90, 0, Math.PI * 2);
  ctx.strokeStyle = "#00d2ff";
  ctx.lineWidth = 5;
  ctx.stroke();
  ctx.clip();

  if (avatarURL) {
    try {
      const avatar = await loadImage(avatarURL);
      ctx.drawImage(avatar, 60, 60, 180, 180);
    } catch {
      ctx.fillStyle = "#00d2ff";
      ctx.fillRect(60, 60, 180, 180);
    }
  }
  ctx.restore();

  // Welcome text
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 42px sans-serif";
  ctx.fillText("Welcome!", 280, 120);

  ctx.fillStyle = "#00d2ff";
  ctx.font = "bold 36px sans-serif";
  const displayName = name && name.length > 20 ? name.slice(0, 20) + "…" : name || "User";
  ctx.fillText(displayName, 280, 170);

  ctx.fillStyle = "#aaaaaa";
  ctx.font = "24px sans-serif";
  ctx.fillText("Glad to have you here! 🎉", 280, 220);

  const outPath = path.join(__dirname, "../../data/welcome_temp.png");
  const buffer = canvas.toBuffer("image/png");
  fs.writeFileSync(outPath, buffer);
  return outPath;
}

async function generateProfileCard({ name, exp, money, level }) {
  const width = 700;
  const height = 250;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  // BG
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, "#1a1a2e");
  gradient.addColorStop(1, "#16213e");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  // Border
  ctx.strokeStyle = "#e94560";
  ctx.lineWidth = 4;
  ctx.strokeRect(4, 4, width - 8, height - 8);

  // Name
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 40px sans-serif";
  ctx.fillText(name || "User", 30, 70);

  // Stats
  ctx.fillStyle = "#e94560";
  ctx.font = "bold 28px sans-serif";
  ctx.fillText(`Level: ${level || 1}`, 30, 130);

  ctx.fillStyle = "#00d2ff";
  ctx.fillText(`EXP: ${exp || 0}`, 30, 175);

  ctx.fillStyle = "#ffd700";
  ctx.fillText(`💰 ${money || 0} coins`, 30, 220);

  // EXP Bar
  const barX = 300;
  const barY = 120;
  const barW = 360;
  const barH = 24;
  const expMax = (level || 1) * 100;
  const progress = Math.min((exp || 0) % expMax, expMax);
  const pct = progress / expMax;

  ctx.fillStyle = "#333";
  ctx.roundRect(barX, barY, barW, barH, 12);
  ctx.fill();

  ctx.fillStyle = "#00d2ff";
  ctx.beginPath();
  ctx.roundRect(barX, barY, barW * pct, barH, 12);
  ctx.fill();

  ctx.fillStyle = "#fff";
  ctx.font = "16px sans-serif";
  ctx.fillText(`${progress} / ${expMax} EXP`, barX + 10, barY + 18);

  const outPath = path.join(__dirname, "../../data/profile_temp.png");
  fs.writeFileSync(outPath, canvas.toBuffer("image/png"));
  return outPath;
}

module.exports = { generateWelcomeCard, generateProfileCard };
