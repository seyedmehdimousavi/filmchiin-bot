require("dotenv").config();
const { Telegraf } = require("telegraf");
const { createClient } = require("@supabase/supabase-js");

// ===================================================
// Init bot
// ===================================================
const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  console.error("BOT_TOKEN missing");
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

// ===================================================
// Supabase (single instance)
// ===================================================
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY
);

// ===================================================
// Helpers
// ===================================================
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

/**
 * دقیقا همان منطق سایت:
 * buildTelegramBotUrlFromChannelLink
 * ولی اینجا payload را برمی‌گردانیم
 */
function buildForwardPayloadFromChannelLink(rawLink) {
  const trimmed = (rawLink || "").trim();
  if (!trimmed || trimmed === "#") return null;

  // اگر از قبل لینک بات باشد
  if (/^https?:\/\/t\.me\/Filmchinbot\?start=/i.test(trimmed)) {
    const u = new URL(trimmed);
    return u.searchParams.get("start");
  }

  let url;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  const host = url.hostname.toLowerCase();
  if (host !== "t.me" && host !== "telegram.me") {
    return null;
  }

  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length === 0) return null;

  // ---------------------------------------------
  // 1) کانال خصوصی: /c/2195618604/403
  // ---------------------------------------------
  if (parts[0] === "c" && parts.length >= 3) {
    const internalId = parts[1];
    const messageId = parts[2];

    if (/^[0-9]+$/.test(internalId) && /^[0-9]+$/.test(messageId)) {
      return `forward_${internalId}_${messageId}`;
    }
  }

  // ---------------------------------------------
  // 2) گروه / کانال عمومی: /username/403
  // ---------------------------------------------
  if (parts.length === 2) {
    const username = parts[0];
    const messageId = parts[1];

    if (/^[A-Za-z0-9_]+$/.test(username) && /^[0-9]+$/.test(messageId)) {
      return `forward_${username}_${messageId}`;
    }
  }

  // ---------------------------------------------
  // 3) گروه تاپیک‌دار: /username/topicId/messageId
  // topicId حذف می‌شود
  // ---------------------------------------------
  if (parts.length === 3) {
    const username = parts[0];
    const messageId = parts[2];

    if (/^[A-Za-z0-9_]+$/.test(username) && /^[0-9]+$/.test(messageId)) {
      return `forward_${username}_${messageId}`;
    }
  }

  return null;
}

// ===================================================
// /start handler (SUPPORTS OLD + MOVIE_)
// ===================================================
bot.start(async (ctx) => {
  const payload = ctx.startPayload || "";
  console.log("START payload:", payload);

  try {
    // =============================================
    // OLD SYSTEM — forward_...
    // =============================================
    if (payload.startsWith("forward_")) {
      const parts = payload.split("_");

      // private channel
      if (parts.length === 3 && /^[0-9]+$/.test(parts[1])) {
        const channelId = `-100${parts[1]}`;
        const messageId = Number(parts[2]);

        const forwarded = await ctx.telegram.forwardMessage(
          ctx.chat.id,
          channelId,
          messageId
        );

        if (!containsMedia(forwarded)) {
          return ctx.reply("This post has no media.");
        }
        return;
      }

      // public group
      if (parts.length === 3) {
        const chat = `@${parts[1]}`;
        const messageId = Number(parts[2]);

        const forwarded = await ctx.telegram.forwardMessage(
          ctx.chat.id,
          chat,
          messageId
        );

        if (!containsMedia(forwarded)) {
          return ctx.reply("This message has no media.");
        }
        return;
      }

      // topic
      if (parts.length === 4) {
        const chat = `@${parts[1]}`;
        const topicId = Number(parts[2]);
        const messageId = Number(parts[3]);

        const forwarded = await ctx.telegram.forwardMessage(
          ctx.chat.id,
          chat,
          messageId,
          { message_thread_id: topicId }
        );

        if (!containsMedia(forwarded)) {
          return ctx.reply("This topic message has no media.");
        }
        return;
      }

      return ctx.reply("Invalid movie link.");
    }

    // =============================================
    // NEW SYSTEM — MOVIE_<uuid>
    // =============================================
    if (payload.startsWith("MOVIE_")) {
      const movieId = payload.replace("MOVIE_", "").trim();

      const { data, error } = await supabase
        .from("movies")
        .select("link")
        .eq("id", movieId)
        .single();

      if (error || !data) {
        return ctx.reply("❌ فیلم پیدا نشد");
      }

      const forwardPayload = buildForwardPayloadFromChannelLink(data.link);
      if (!forwardPayload) {
        return ctx.reply("❌ لینک فایل نامعتبر است");
      }

      // بازگشت مجدد به منطق forward_
      ctx.startPayload = forwardPayload;
      return bot.handleUpdate({
        ...ctx.update,
        message: ctx.message,
      });
    }

    return ctx.reply("🎬 نام فیلم را ارسال کنید");
  } catch (err) {
    console.error("START ERROR:", err);
    ctx.reply("❌ خطا در دریافت فیلم");
  }
});

// ===================================================
// TEXT SEARCH (send movie name)
// ===================================================
bot.on("text", async (ctx) => {
  const text = ctx.message.text.trim();
  if (text.startsWith("/")) return;

  try {
    const { data, error } = await supabase
      .from("movies")
      .select("id, title, cover, link")
      .ilike("title", `%${text}%`)
      .limit(5);

    if (error || !data || data.length === 0) {
      return ctx.reply("❌ فیلمی پیدا نشد");
    }

    for (const movie of data) {
      const payload = buildForwardPayloadFromChannelLink(movie.link);
      if (!payload) continue;

      await ctx.replyWithPhoto(movie.cover, {
        caption: `🎬 ${movie.title}`,
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "▶️ Go to file",
                url: `https://t.me/${ctx.me}?start=${payload}`,
              },
            ],
          ],
        },
      });
    }
  } catch (err) {
    console.error("TEXT SEARCH ERROR:", err);
    ctx.reply("❌ خطای غیرمنتظره");
  }
});

// ===================================================
// INLINE QUERY
// ===================================================
bot.on("inline_query", async (ctx) => {
  try {
    const q = ctx.inlineQuery.query.trim();
    if (q.length < 2) {
      return ctx.answerInlineQuery([], { cache_time: 1 });
    }

    const { data } = await supabase
      .from("movies")
      .select("id, title, cover, link")
      .ilike("title", `%${q}%`)
      .limit(10);

    const results = (data || [])
      .map((m) => {
        const payload = buildForwardPayloadFromChannelLink(m.link);
        if (!payload) return null;

        return {
          type: "article",
          id: m.id,
          title: m.title,
          thumb_url: m.cover,
          input_message_content: {
            message_text: `🎬 ${m.title}`,
          },
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: "▶️ Go to file",
                  url: `https://t.me/${ctx.me}?start=${payload}`,
                },
              ],
            ],
          },
        };
      })
      .filter(Boolean);

    await ctx.answerInlineQuery(results, { cache_time: 1 });
  } catch (e) {
    console.error("INLINE ERROR:", e);
  }
});

// ===================================================
console.log("FILMCHIIN BOT IS RUNNING...");
bot.launch();

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));