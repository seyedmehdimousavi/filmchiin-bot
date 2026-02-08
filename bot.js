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
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY,
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

// ===================================================
// /start handler (SUPPORTS BOTH OLD + NEW)
// ===================================================
bot.start(async (ctx) => {
  const payload = ctx.startPayload || "";
  console.log("START payload:", payload);

  try {
    // =================================================
    // OLD SYSTEM — forward_...
    // =================================================
    if (payload.startsWith("forward_")) {
      const parts = payload.split("_");

      // private channel
      if (parts.length === 3 && /^[0-9]+$/.test(parts[1])) {
        const channelId = `-100${parts[1]}`;
        const messageId = Number(parts[2]);

        const forwarded = await ctx.telegram.forwardMessage(
          ctx.chat.id,
          channelId,
          messageId,
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
          messageId,
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
          { message_thread_id: topicId },
        );

        if (!containsMedia(forwarded)) {
          return ctx.reply("This topic message has no media.");
        }
        return;
      }

      return ctx.reply("Invalid movie link.");
    }

    // =================================================
    // NEW SYSTEM — MOVIE_<uuid>
    // =================================================
    if (payload.startsWith("MOVIE_")) {
      const movieId = payload.replace("MOVIE_", "").trim();

      const { data, error } = await supabase
        .from("movies")
        .select("title, cover, link")
        .eq("id", movieId)
        .single();

      if (error || !data) {
        console.error("MOVIE LOAD ERROR:", error);
        return ctx.reply("❌ فیلم پیدا نشد");
      }

      return ctx.replyWithPhoto(data.cover, {
        caption: `🎬 ${data.title}`,
        reply_markup: {
          inline_keyboard: [[{ text: "▶️ Go to file", url: data.link }]],
        },
      });
    }

    // =================================================
    // NO PAYLOAD
    // =================================================
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
      .select("id, title, cover")
      .ilike("title", `%${text}%`)
      .limit(5);

    if (error) {
      console.error("TEXT SEARCH DB ERROR:", error);
      return ctx.reply("❌ خطا در جستجو");
    }

    if (!data || data.length === 0) {
      return ctx.reply("❌ فیلمی پیدا نشد");
    }

    for (const movie of data) {
      await ctx.replyWithPhoto(movie.cover, {
        caption: `🎬 ${movie.title}`,
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "▶️ Go to file",
                url: `https://t.me/${ctx.me}?start=MOVIE_${movie.id}`,
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
// INLINE QUERY (kept for later)
// ===================================================
bot.on("inline_query", async (ctx) => {
  try {
    const q = ctx.inlineQuery.query.trim();
    if (q.length < 2) {
      return ctx.answerInlineQuery([], { cache_time: 1 });
    }

    const { data } = await supabase
      .from("movies")
      .select("id, title, cover")
      .ilike("title", `%${q}%`)
      .limit(10);

    const results = (data || []).map((m) => ({
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
              url: `https://t.me/${ctx.me}?start=MOVIE_${m.id}`,
            },
          ],
        ],
      },
    }));

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
