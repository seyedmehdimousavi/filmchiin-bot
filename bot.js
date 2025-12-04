// bot.js
require("dotenv").config();
const { Telegraf } = require("telegraf");

// -----------------------------
// 1) Load BOT TOKEN
// -----------------------------
const BOT_TOKEN = process.env.BOT_TOKEN;

if (!BOT_TOKEN) {
  console.error("ERROR: BOT_TOKEN not found in .env");
  process.exit(1);
}

// -----------------------------
// 2) Create bot
// -----------------------------
const bot = new Telegraf(BOT_TOKEN);

console.log("Bot starting...");

// -----------------------------
// 3) /start handler (forward messages)
// -----------------------------
bot.start(async (ctx) => {
  const payload = ctx.startPayload || "";
  console.log("START from", ctx.from.id, "payload:", payload);

  if (!payload) {
    return ctx.reply(
      "Hi!\nPlease open movies from inside FilmChiin website Go to file button."
    );
  }

  // payload باید شکل forward_x_y باشد
  if (!payload.startsWith("forward_")) {
    return ctx.reply("Invalid movie link.");
  }

  try {
    const parts = payload.split("_");
    if (parts.length < 3) {
      return ctx.reply("Invalid movie code.");
    }

    const target = parts[1]; // internalId یا username
    const messageId = Number(parts[2]);

    if (!messageId) {
      return ctx.reply("Invalid message code.");
    }

    let sourceChat;

    // اگر target فقط عدد بود → private channel
    if (/^[0-9]+$/.test(target)) {
      sourceChat = `-100${target}`;
      console.log("Source is PRIVATE CHANNEL:", sourceChat);
    } else {
      // اگر متن بود → username group/channel
      sourceChat = `@${target}`;
      console.log("Source is PUBLIC GROUP/CHANNEL:", sourceChat);
    }

    // فوروارد پیام
    const forwarded = await ctx.telegram.forwardMessage(
      ctx.chat.id,
      sourceChat,
      messageId
    );

    const media =
      forwarded.video ||
      forwarded.document ||
      forwarded.animation ||
      forwarded.audio ||
      forwarded.voice ||
      null;

    if (!media) {
      return ctx.reply("This post does not contain a video or file.");
    }

    return;
  } catch (err) {
    console.error("Forward error:", err);
    return ctx.reply("Error forwarding the movie. Please try again.");
  }
});

// -----------------------------
// 4) Media ID Debug (Optional)
// -----------------------------
bot.on("video", async (ctx) => {
  try {
    const fileId = ctx.message.video.file_id;
    console.log("VIDEO FILE_ID:", fileId);
    await ctx.reply("video file_id:\n`" + fileId + "`", {
      parse_mode: "Markdown",
    });
  } catch (err) {
    console.error("video handler error:", err);
  }
});

bot.on("document", async (ctx) => {
  try {
    const fileId = ctx.message.document.file_id;
    console.log("DOC FILE_ID:", fileId);
    await ctx.reply("document file_id:\n`" + fileId + "`", {
      parse_mode: "Markdown",
    });
  } catch (err) {
    console.error("document handler error:", err);
  }
});

// -----------------------------
// 5) Global error handling
// -----------------------------
bot.catch((err, ctx) => {
  console.error("BOT ERROR for update type", ctx.updateType, ":", err);
});

// -----------------------------
// 6) Launch bot
// -----------------------------
bot.launch().then(() => {
  console.log("FilmChiin Telegram Bot is running...");
});

// Handle VPS shutdown
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
