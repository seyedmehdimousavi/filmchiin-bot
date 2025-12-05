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

const bot = new Telegraf(BOT_TOKEN);
console.log("Bot starting...");

// =======================================================================
// /start handler — supports 3 payload formats:
// 1) forward_<internalId>_<messageId>
// 2) forward_<username>_<messageId>
// 3) forward_<username>_<topicId>_<messageId>
// =======================================================================

bot.start(async (ctx) => {
  const payload = ctx.startPayload || "";
  console.log("START from", ctx.from.id, "payload:", payload);

  if (!payload.startsWith("forward_")) {
    return ctx.reply("Invalid movie link.");
  }

  const parts = payload.split("_");

  try {
    // ----------------------------------------------------
    // 1) PRIVATE CHANNEL
    // forward_2195618604_403
    // ----------------------------------------------------
    if (parts.length === 3 && /^[0-9]+$/.test(parts[1])) {
      const internalId = parts[1];
      const messageId = Number(parts[2]);

      const channelId = `-100${internalId}`;
      console.log("Forward PRIVATE CHANNEL:", channelId, "msg:", messageId);

      const forwarded = await ctx.telegram.forwardMessage(
        ctx.chat.id,
        channelId,
        messageId
      );

      if (!containsMedia(forwarded))
        return ctx.reply("This post has no video/file.");

      return;
    }

    // ----------------------------------------------------
    // 2) PUBLIC GROUP — normal message
    // forward_YouCantSeeThisLink_215
    // ----------------------------------------------------
    if (parts.length === 3 && !/^[0-9]+$/.test(parts[1])) {
      const username = parts[1];
      const messageId = Number(parts[2]);

      const chat = `@${username}`;
      console.log("Forward GROUP:", chat, "msg:", messageId);

      const forwarded = await ctx.telegram.forwardMessage(
        ctx.chat.id,
        chat,
        messageId
      );

      if (!containsMedia(forwarded))
        return ctx.reply("This group message has no video/file.");

      return;
    }

    // ----------------------------------------------------
    // 3) PUBLIC GROUP — topic message
    // forward_YouCantSeeThisLink_2_10
    // ----------------------------------------------------
    if (parts.length === 4) {
      const username = parts[1];
      const topicId = Number(parts[2]);
      const messageId = Number(parts[3]);

      const chat = `@${username}`;
      console.log(
        "Forward GROUP TOPIC:",
        chat,
        "topic:",
        topicId,
        "msg:",
        messageId
      );

      const forwarded = await ctx.telegram.forwardMessage(
        ctx.chat.id,
        chat,
        messageId,
        {
          message_thread_id: topicId,
        }
      );

      if (!containsMedia(forwarded))
        return ctx.reply("This topic message has no video/file.");

      return;
    }

    return ctx.reply("Invalid movie link format.");
  } catch (err) {
    console.error("Forward error:", err);
    return ctx.reply("Error forwarding the movie. Please try again.");
  }
});

// =======================================================
// Media detector
// =======================================================
function containsMedia(msg) {
  return (
    msg.video ||
    msg.document ||
    msg.animation ||
    msg.audio ||
    msg.voice ||
    false
  );
}

// Debug logs
bot.on("message", (ctx) => {
  console.log("chat id:", ctx.chat.id);
});

bot.launch().then(() => {
  console.log("FilmChiin Telegram Bot is running...");
});

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));