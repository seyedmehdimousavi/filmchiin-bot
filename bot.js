import { Telegraf } from "telegraf";
import { createClient } from "@supabase/supabase-js";

// ===================================================
// Worker entry
// ===================================================
export default {
  async fetch(request, env) {
    // فقط POST از تلگرام
    if (request.method !== "POST") {
      return new Response("OK");
    }

    // ===================================================
    // Init bot (PER REQUEST SAFE)
// ===================================================
    const bot = new Telegraf(env.BOT_TOKEN);

    const supabase = createClient(
      env.SUPABASE_URL,
      env.SUPABASE_SERVICE_KEY || env.SUPABASE_KEY
    );

    // ===================================================
    // Helpers
    // ===================================================
    function containsMedia(msg) {
      return (
        msg?.video ||
        msg?.document ||
        msg?.animation ||
        msg?.audio ||
        msg?.voice ||
        false
      );
    }

    /**
     * mirror دقیق منطق سایت
     * خروجی: forward_xxx_yyy
     */
    function buildForwardPayloadFromChannelLink(rawLink) {
      const trimmed = (rawLink || "").trim();
      if (!trimmed || trimmed === "#") return null;

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
      if (!parts.length) return null;

      // 1) private channel: /c/2195618604/403
      if (parts[0] === "c" && parts.length >= 3) {
        if (/^\d+$/.test(parts[1]) && /^\d+$/.test(parts[2])) {
          return `forward_${parts[1]}_${parts[2]}`;
        }
      }

      // 2) public: /username/403
      if (parts.length === 2) {
        if (/^[A-Za-z0-9_]+$/.test(parts[0]) && /^\d+$/.test(parts[1])) {
          return `forward_${parts[0]}_${parts[1]}`;
        }
      }

      // 3) topic: /username/topicId/messageId
      if (parts.length === 3) {
        if (/^[A-Za-z0-9_]+$/.test(parts[0]) && /^\d+$/.test(parts[2])) {
          return `forward_${parts[0]}_${parts[2]}`;
        }
      }

      return null;
    }

    // ===================================================
    // /start handler
    // ===================================================
    bot.start(async (ctx) => {
      const payload = ctx.startPayload || "";

      try {
        // ---------------- forward_ ----------------
        if (payload.startsWith("forward_")) {
          const parts = payload.split("_");

          // private channel
          if (parts.length === 3 && /^\d+$/.test(parts[1])) {
            const channelId = `-100${parts[1]}`;
            const messageId = Number(parts[2]);

            const fwd = await ctx.telegram.forwardMessage(
              ctx.chat.id,
              channelId,
              messageId
            );

            if (!containsMedia(fwd)) {
              return ctx.reply("This post has no media.");
            }
            return;
          }

          // public
          if (parts.length === 3) {
            const fwd = await ctx.telegram.forwardMessage(
              ctx.chat.id,
              `@${parts[1]}`,
              Number(parts[2])
            );

            if (!containsMedia(fwd)) {
              return ctx.reply("This message has no media.");
            }
            return;
          }

          return ctx.reply("Invalid movie link.");
        }

        // ---------------- MOVIE_ ----------------
        if (payload.startsWith("MOVIE_")) {
          const movieId = payload.replace("MOVIE_", "").trim();

          const { data } = await supabase
            .from("movies")
            .select("link")
            .eq("id", movieId)
            .single();

          const forwardPayload =
            buildForwardPayloadFromChannelLink(data?.link);

          if (!forwardPayload) {
            return ctx.reply("❌ لینک فایل نامعتبر است");
          }

          ctx.startPayload = forwardPayload;
          return bot.handleUpdate(ctx.update);
        }

        return ctx.reply("🎬 نام فیلم را ارسال کنید");
      } catch {
        return ctx.reply("❌ خطا در دریافت فیلم");
      }
    });

    // ===================================================
    // TEXT SEARCH (movies + movie_items)
    // ===================================================
    bot.on("text", async (ctx) => {
      const text = ctx.message.text.trim();
      if (text.startsWith("/")) return;

      const { data: movies } = await supabase
        .from("movies")
        .select("title, cover, link")
        .ilike("title", `%${text}%`)
        .limit(5);

      const { data: items } = await supabase
        .from("movie_items")
        .select("title, cover, link")
        .ilike("title", `%${text}%`)
        .limit(5);

      if (!movies?.length && !items?.length) {
        return ctx.reply("❌ فیلمی پیدا نشد");
      }

      const all = [...(movies || []), ...(items || [])];

      for (const m of all) {
        const payload = buildForwardPayloadFromChannelLink(m.link);
        if (!payload) continue;

        await ctx.replyWithPhoto(m.cover || undefined, {
          caption: `🎬 ${m.title}`,
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: "▶️ Go to file",
                  url: `https://t.me/Filmchinbot?start=${payload}`,
                },
              ],
            ],
          },
        });
      }
    });

    // ===================================================
    // INLINE QUERY
    // ===================================================
    bot.on("inline_query", async (ctx) => {
      const q = ctx.inlineQuery.query.trim();
      if (q.length < 2) {
        return ctx.answerInlineQuery([]);
      }

      const { data: movies } = await supabase
        .from("movies")
        .select("title, cover, link")
        .ilike("title", `%${q}%`)
        .limit(5);

      const { data: items } = await supabase
        .from("movie_items")
        .select("title, cover, link")
        .ilike("title", `%${q}%`)
        .limit(5);

      const results = [];

      for (const m of [...(movies || []), ...(items || [])]) {
        const payload = buildForwardPayloadFromChannelLink(m.link);
        if (!payload) continue;

        results.push({
          type: "article",
          id: payload,
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
                  url: `https://t.me/Filmchinbot?start=${payload}`,
                },
              ],
            ],
          },
        });
      }

      await ctx.answerInlineQuery(results, { cache_time: 1 });
    });

    // ===================================================
    // Handle update
    // ===================================================
    const update = await request.json();
    await bot.handleUpdate(update);

    return new Response("OK");
  },
};