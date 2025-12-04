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

// =======================================================================
// 3) /start handler (supports: private channel + group topic forwarding)
// =======================================================================

bot.start(async (ctx) => {
  const payload = ctx.startPayload || "";
  console.log("START from", ctx.from.id, "payload:", payload);

  if (!payload) {
    return ctx.reply(
      "Hi!\nPlease open movies using Go to file button inside FilmChiin website."
    );
  }

  // همه payload ها باید با forward_ شروع شوند
  if (!payload.startsWith("forward_")) {
    return ctx.reply("Invalid movie link.");
  }

  try {
    const parts = payload.split("_");

    // حالا payload های ما دو مدل هستند:
    // forward_<internalId>_<messageId>
    // forward_<username>_<topicId>_<messageId>

    if (parts.length === 3) {
      // ----------------------------------------------------
      // حالت 1: کانال خصوصی
      // forward_2195618604_403
      // → channelId = -1002195618604
      // ----------------------------------------------------
      const internalId = parts[1];
      const messageId = Number(parts[2]);

      if (!/^[0-9]+$/.test(internalId)) {
        return ctx.reply("Invalid channel ID.");
      }

      const channelId = `-100${internalId}`;
      console.log("Forwarding PRIVATE CHANNEL →", channelId, "msg:", messageId);

      const forwarded = await ctx.telegram.forwardMessage(
        ctx.chat.id,
        channelId,
        messageId
      );

      const media =
        forwarded.video ||
        forwarded.document ||
        forwarded.animation ||
        forwarded.audio ||
        forwarded.voice ||
        null;

      if (!media) return ctx.reply("This post has no video/file.");

      return;
    }

    // ----------------------------------------------------
    // حالت 2: گروه / تاپیک
    // forward_YouCantSeeThisLink_2_10
    // target = username
    // topicId = 2
    // messageId = 10
    // ----------------------------------------------------

    if (parts.length === 4) {
      const username = parts[1]; // نام گروه public
      const topicId = Number(parts[2]);
      const messageId = Number(parts[3]);

      if (!username || isNaN(topicId) || isNaN(messageId)) {
        return ctx.reply("Invalid topic link.");
      }

      const groupChat = `@${username}`;

      console.log(
        "Forwarding GROUP TOPIC →",
        groupChat,
        "topic:",
        topicId,
        "msg:",
        messageId
      );

      const forwarded = await ctx.telegram.forwardMessage(
        ctx.chat.id,
        groupChat,
        messageId,
        {
          message_thread_id: topicId,
        }
      );

      const media =
        forwarded.video ||
        forwarded.document ||
        forwarded.animation ||
        forwarded.audio ||
        forwarded.voice ||
        null;

      if (!media) return ctx.reply("This topic post has no video/file.");

      return;
    }

    return ctx.reply("Invalid movie code.");
  } catch (err) {
    console.error("Forward error:", err);
    return ctx.reply("Error forwarding the movie. Please try again.");
  }
});

// =======================================================================
// 4) Media ID Debug (Optional)
// =======================================================================

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

// =======================================================================
// 5) Message Log
// =======================================================================
bot.on("message", (ctx) => {
  console.log("chat id:", ctx.chat.id);
});

// =======================================================================
// 6) Launch bot
// =======================================================================
bot.launch().then(() => {
  console.log("FilmChiin Telegram Bot is running...");
});

// Handle VPS shutdown
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
