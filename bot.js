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
 * mirror منطق سایت:
 * buildTelegramBotUrlFromChannelLink
 * خروجی: payload مثل forward_xxx_yyy
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
  if (host !== "t.me" && host !== "telegram.me") return null;

  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length === 0) return null;

  // 1) private channel: /c/2195618604/403
  if (parts[0] === "c" && parts.length >= 3) {
    if (/^\d+$/.test(parts[1]) && /^\d+$/.test(parts[2])) {
      return `forward_${parts[1]}_${parts[2]}`;
    }
  }

  // 2) public group/channel: /username/403
  if (parts.length === 2) {
    if (/^[A-Za-z0-9_]+$/.test(parts[0]) && /^\d+$/.test(parts[1])) {
      return `forward_${parts[0]}_${parts[1]}`;
    }
  }

  // 3) topic group: /username/topicId/messageId
  if (parts.length === 3) {
    if (/^[A-Za-z0-9_]+$/.test(parts[0]) && /^\d+$/.test(parts[2])) {
      return `forward_${parts[0]}_${parts[2]}`;
    }
  }

  return null;
}

// ===================================================
// /start handler (forward_ + MOVIE_)
// ===================================================
bot.start(async (ctx) => {
  const payload = ctx.startPayload || "";
  console.log("START payload:", payload);

  try {
    // ---------------------------------------------
    // forward_...
    // ---------------------------------------------
    if (payload.startsWith("forward_")) {
      const parts = payload.split("_");

      // private channel
      if (parts.length === 3 && /^\d+$/.test(parts[1])) {
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

    // ---------------------------------------------
    // MOVIE_<uuid>
    // ---------------------------------------------
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
// TEXT SEARCH (movies + movie_items)
// ===================================================
bot.on("text", async (ctx) => {
  const text = ctx.message.text.trim();
  if (text.startsWith("/")) return;

  try {
    // -------- movies --------
    const { data: movies } = await supabase
      .from("movies")
      .select("id, title, cover, link")
      .ilike("title", `%${text}%`)
      .limit(5);

    // -------- movie_items --------
    const { data: items } = await supabase
      .from("movie_items")
      .select("id, title, cover, link, movie_id")
      .ilike("title", `%${text}%`)
      .limit(5);

    if ((!movies || movies.length === 0) && (!items || items.length === 0)) {
      return ctx.reply("❌ فیلمی پیدا نشد");
    }

    // نتایج movies
    for (const m of movies || []) {
      const payload = buildForwardPayloadFromChannelLink(m.link);
      if (!payload) continue;

      await ctx.replyWithPhoto(m.cover, {
        caption: `🎬 ${m.title}`,
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

    // نتایج movie_items
    for (const it of items || []) {
      if (!it.link) continue;

      const payload = buildForwardPayloadFromChannelLink(it.link);
      if (!payload) continue;

      await ctx.replyWithPhoto(it.cover || undefined, {
        caption: `🎬 ${it.title}`,
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
// INLINE QUERY (movies + movie_items)
// ===================================================
bot.on("inline_query", async (ctx) => {
  try {
    const q = ctx.inlineQuery.query.trim();
    if (q.length < 2) {
      return ctx.answerInlineQuery([], { cache_time: 1 });
    }

    const { data: movies } = await supabase
      .from("movies")
      .select("id, title, cover, link")
      .ilike("title", `%${q}%`)
      .limit(5);

    const { data: items } = await supabase
      .from("movie_items")
      .select("id, title, cover, link")
      .ilike("title", `%${q}%`)
      .limit(5);

    const results = [];

    for (const m of movies || []) {
      const payload = buildForwardPayloadFromChannelLink(m.link);
      if (!payload) continue;

      results.push({
        type: "article",
        id: `movie_${m.id}`,
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
      });
    }

    for (const it of items || []) {
      if (!it.link) continue;

      const payload = buildForwardPayloadFromChannelLink(it.link);
      if (!payload) continue;

      results.push({
        type: "article",
        id: `item_${it.id}`,
        title: it.title,
        thumb_url: it.cover,
        input_message_content: {
          message_text: `🎬 ${it.title}`,
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
      });
    }

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