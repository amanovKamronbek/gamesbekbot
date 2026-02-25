import TelegramBot from "node-telegram-bot-api";
import dotenv from "dotenv";
import mongoose from "mongoose";
import moment from "moment-timezone";
import User from "./models/User.js";
import Media from "./models/Media.js";

dotenv.config();

const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });

await mongoose.connect(process.env.MONGO_URI);
console.log("✅ MongoDB connected");

const adminId = Number(process.env.ADMIN_ID);
const ownerId = Number(process.env.OWNER_ID);

const tempSteps = new Map();
const tempDelete = new Map();
const subChannels = new Set();

function isPrivileged(id) {
  return id === adminId || id === ownerId;
}

function formatDate(date) {
  return moment(date).tz("Asia/Tashkent").format("HH:mm DD.MM.YYYY");
}

/* ================= START ================= */

bot.onText(/\/start/, async (msg) => {
  const user = msg.from;
  const chatId = msg.chat.id;

  const exists = await User.findOne({ userId: user.id });

  if (!exists) {
    await User.create({
      userId: user.id,
      first_name: user.first_name,
      username: user.username,
      language_code: user.language_code
    });

    const fullName = `${user.first_name || ""} ${user.last_name || ""}`.trim();
    const username = user.username ? `@${user.username}` : "—";

    await bot.sendMessage(adminId,
      `🆕 <b>Yangi foydalanuvchi:</b>\n👤 <b>${fullName}</b>\n🔗 ${username}\n🆔 <code>${user.id}</code>`,
      { parse_mode: "HTML" }
    );
  }

  bot.sendMessage(chatId, "Assalomu alaykum 👋🏻\nKod yuboring 📥");
});

/* ================= STATS ================= */

bot.onText(/\/stats/, async (msg) => {
  if (!isPrivileged(msg.from.id)) return;

  const userCount = await User.countDocuments();
  const mediaCount = await Media.countDocuments();
  const latestUser = await User.findOne().sort({ createdAt: -1 });

  const lastStart = latestUser ? formatDate(latestUser.createdAt) : "—";

  const text = `📊 <b>Statistika:</b>

👥 Foydalanuvchilar: <b>${userCount}</b>
📁 Jami fayllar: <b>${mediaCount}</b>
🕒 Oxirgi start: <b>${lastStart}</b>`;

  bot.sendMessage(msg.chat.id, text, { parse_mode: "HTML" });
});

/* ================= NEW FILE ================= */

bot.onText(/\/new/, (msg) => {
  if (!isPrivileged(msg.from.id)) return;

  tempSteps.set(msg.from.id, { step: "awaiting_file" });
  bot.sendMessage(msg.chat.id, "📤 Fayl yuboring:");
});

bot.on("document", async (msg) => {
  if (!isPrivileged(msg.from.id)) return;

  const temp = tempSteps.get(msg.from.id);
  if (!temp || temp.step !== "awaiting_file") return;

  tempSteps.set(msg.from.id, {
    step: "awaiting_code",
    file_id: msg.document.file_id,
    file_name: msg.document.file_name
  });

  bot.sendMessage(msg.chat.id, "🔢 Kod yuboring:");
});

/* ================= DELETE FILE ================= */

bot.onText(/\/delete/, (msg) => {
  if (!isPrivileged(msg.from.id)) return;

  tempDelete.set(msg.from.id, true);
  bot.sendMessage(msg.chat.id, "❗ O‘chirish uchun kod yuboring:");
});

/* ================= LIST ================= */

bot.onText(/\/list/, async (msg) => {
  if (!isPrivileged(msg.from.id)) return;

  const files = await Media.find();
  if (!files.length) return bot.sendMessage(msg.chat.id, "📭 Fayl yo‘q");

  let text = "📂 <b>Fayllar:</b>\n\n";
  files.forEach(f => {
    text += `🔢 <code>${f.code}</code> — ${f.file_name}\n`;
  });

  bot.sendMessage(msg.chat.id, text, { parse_mode: "HTML" });
});

/* ================= CHANNEL ADD ================= */

bot.onText(/\/kanal/, (msg) => {
  if (!isPrivileged(msg.from.id)) return;

  tempSteps.set(msg.from.id, { step: "awaiting_channel" });
  bot.sendMessage(msg.chat.id, "📢 Kanal username yuboring (@kanal):");
});

/* ================= STOP CHANNEL ================= */

bot.onText(/\/stop-kanal/, (msg) => {
  if (!isPrivileged(msg.from.id)) return;
  if (!subChannels.size) return bot.sendMessage(msg.chat.id, "📭 Kanal yo‘q");

  const buttons = [...subChannels].map(ch => ([
    { text: `❌ ${ch}`, callback_data: `remove_${ch}` }
  ]));

  bot.sendMessage(msg.chat.id, "O‘chirish:", {
    reply_markup: { inline_keyboard: buttons }
  });
});

/* ================= SUB CHECK ================= */

async function isSubscribed(userId) {
  for (const ch of subChannels) {
    try {
      const member = await bot.getChatMember(ch, userId);
      if (!["member", "administrator", "creator"].includes(member.status))
        return false;
    } catch {
      return false;
    }
  }
  return true;
}

/* ================= CALLBACK ================= */

bot.on("callback_query", async (q) => {
  const id = q.from.id;

  if (q.data.startsWith("remove_")) {
    const ch = q.data.replace("remove_", "");
    subChannels.delete(ch);
    bot.answerCallbackQuery(q.id, { text: "O‘chirildi" });
  }

  if (q.data === "check_sub") {
    const ok = await isSubscribed(id);
    bot.answerCallbackQuery(q.id, {
      text: ok ? "✅ Tasdiqlandi" : "❌ Obuna bo‘ling",
      show_alert: true
    });
  }
});

/* ================= MESSAGE HANDLER ================= */

bot.on("message", async (msg) => {
  const userId = msg.from.id;
  const text = msg.text;
  const temp = tempSteps.get(userId);

  if (temp?.step === "awaiting_channel") {
    if (!/^@[\w\d_]+$/.test(text))
      return bot.sendMessage(userId, "❌ Noto‘g‘ri format");

    subChannels.add(text);
    tempSteps.delete(userId);
    return bot.sendMessage(userId, "✅ Kanal qo‘shildi");
  }

  if (!text || text.startsWith("/")) return;

  if (!isPrivileged(userId)) {
    if (!(await isSubscribed(userId))) {
      return bot.sendMessage(userId, "📢 Obuna bo‘ling", {
        reply_markup: {
          inline_keyboard: [
            ...[...subChannels].map(ch => [{
              text: ch,
              url: `https://t.me/${ch.replace("@", "")}`
            }]),
            [{ text: "✅ Tekshirish", callback_data: "check_sub" }]
          ]
        }
      });
    }

    const file = await Media.findOne({ code: Number(text) });
    if (!file) return bot.sendMessage(userId, "❌ Kod topilmadi");

    return bot.sendDocument(userId, file.file_id, {
      caption: file.caption || `Kod: ${file.code}`
    });
  }

  if (temp?.step === "awaiting_code") {
    tempSteps.set(userId, { ...temp, code: Number(text), step: "awaiting_caption" });
    return bot.sendMessage(userId, "📝 Izoh yuboring:");
  }

  if (temp?.step === "awaiting_caption") {
    await Media.create({
      code: temp.code,
      file_id: temp.file_id,
      file_name: temp.file_name,
      caption: text
    });

    tempSteps.delete(userId);
    return bot.sendMessage(userId, "✅ Saqlandi");
  }

  if (tempDelete.get(userId)) {
    const file = await Media.findOneAndDelete({ code: Number(text) });
    tempDelete.delete(userId);
    return bot.sendMessage(userId, file ? "🔴 O‘chirildi" : "❌ Topilmadi");
  }
});

console.log("🚀 Bot ishlayapti");