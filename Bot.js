require("dotenv").config();
const { Telegraf } = require("telegraf");
const { createClient } = require("@supabase/supabase-js");
const crypto = require("crypto");

// ===================================================
// Init bot
// ===================================================
const BOT_TOKEN = process.env.BOT_TOKEN;
const SEND_SECRET = process.env.SEND_SECRET;

if (!BOT_TOKEN) {
  console.error("BOT_TOKEN missing");
  process.exit(1);
}
if (!SEND_SECRET) {
  console.error("SEND_SECRET missing");
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

// ===================================================
// Supabase
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
    msg?.video ||
    msg?.document ||
    msg?.animation ||
    msg?.audio ||
    msg?.voice ||
    false
  );
}

// حذف - و . و فقط استفاده از حروف + عدد + _
function cleanBase64(str) {
  return str.replace(/-/g, "").replace(/\./g, "").replace(/=/g, "");
}

function encodeSendToken(payload) {
  const data = cleanBase64(
    Buffer.from(payload).toString("base64url")
  );

  const sig = cleanBase64(
    crypto
      .createHmac("sha256", SEND_SECRET)
      .update(payload)
      .digest("base64url")
      .slice(0, 10)
  );

  return `${data}_${sig}`;
}

function decodeSendToken(token) {
  if (!token || !token.includes("_")) return null;

  const [data, sig] = token.split("_");
  if (!data || !sig) return null;

  let payload;
  try {
    payload = Buffer.from(data, "base64url").toString();
  } catch {
    return null;
  }

  const expected = encodeSendToken(payload);
  if (!expected.endsWith(sig)) return null;

  return payload;
}

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

  if (parts[0] === "c" && parts.length >= 3) {
    return `forward_${parts[1]}_${parts[2]}`;
  }

  if (parts.length === 2) {
    return `forward_${parts[0]}_${parts[1]}`;
  }

  if (parts.length === 3) {
    return `forward_${parts[0]}_${parts[2]}`;
  }

  return null;
}

// ===================================================
// /start (PRIVATE)
// ===================================================
bot.start(async (ctx) => {
  const payload = ctx.startPayload || "";

  try {
    if (payload.startsWith("forward_")) {
      const parts = payload.split("_");

      if (parts.length === 3 && /^\d+$/.test(parts[1])) {
        const fwd = await ctx.telegram.forwardMessage(
          ctx.chat.id,
          `-100${parts[1]}`,
          Number(parts[2])
        );
        if (!containsMedia(fwd)) ctx.reply("This post has no media.");
        return;
      }

      if (parts.length === 3) {
        const fwd = await ctx.telegram.forwardMessage(
          ctx.chat.id,
          `@${parts[1]}`,
          Number(parts[2])
        );
        if (!containsMedia(fwd)) ctx.reply("This message has no media.");
        return;
      }

      return ctx.reply("Invalid movie link.");
    }

    ctx.reply("🎬 نام فیلم را ارسال کنید");
  } catch (e) {
    console.error("START ERROR:", e);
    ctx.reply("❌ خطا در دریافت فیلم");
  }
});

// ===================================================
// INLINE SEARCH (WITH SYNOPSIS)
// ===================================================
bot.on("inline_query", async (ctx) => {
  const q = ctx.inlineQuery.query.trim();
  if (q.length < 2) return ctx.answerInlineQuery([], { cache_time: 1 });

  const { data: movies } = await supabase
    .from("movies")
    .select("id, title, cover, link, synopsis")
    .ilike("title", `%${q}%`)
    .limit(5);

  const { data: items } = await supabase
    .from("movie_items")
    .select("id, title, cover, link, synopsis")
    .ilike("title", `%${q}%`)
    .limit(5);

  const results = [];

  for (const m of [...(movies || []), ...(items || [])]) {
    const payload = buildForwardPayloadFromChannelLink(m.link);
    if (!payload) continue;

    results.push({
      type: "article",
      id: `${m.id}_${Math.random()}`,
      title: m.title,
      description: m.synopsis || "خلاصه موجود نیست",
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

  await ctx.answerInlineQuery(results, { cache_time: 1 });
});

// ===================================================
// TEXT HANDLER
// ===================================================
bot.on("text", async (ctx) => {
  const text = ctx.message.text.trim();

  // =========================
  // PRIVATE SEARCH
  // =========================
  if (ctx.chat.type === "private") {
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

    const all = [...(movies || []), ...(items || [])];
    if (!all.length) return ctx.reply("❌ فیلمی پیدا نشد");

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
                url: `https://t.me/${ctx.me}?start=${payload}`,
              },
            ],
          ],
        },
      });
    }
    return;
  }

  // =========================
  // GROUP / SUPERGROUP
  // =========================
  if (!["group", "supergroup"].includes(ctx.chat.type)) return;

  // ---------- /search ----------
  if (/^\/search(@\w+)?/i.test(text)) {
    let query = text.replace(/^\/search(@\w+)?/i, "").trim();

    if (!query && ctx.message.reply_to_message?.text) {
      query = ctx.message.reply_to_message.text.trim();
    }

    if (!query) {
      return ctx.reply("❌ بعد از /search نام فیلم را بنویس یا روی پیام ریپلای کن");
    }

    const { data: movies } = await supabase
      .from("movies")
      .select("title, cover, link")
      .ilike("title", `%${query}%`)
      .limit(5);

    const { data: items } = await supabase
      .from("movie_items")
      .select("title, cover, link")
      .ilike("title", `%${query}%`)
      .limit(5);

    const all = [...(movies || []), ...(items || [])];
    if (!all.length) return ctx.reply("❌ چیزی پیدا نشد");

    for (const m of all) {
      const payload = buildForwardPayloadFromChannelLink(m.link);
      if (!payload) continue;

      const token = encodeSendToken(payload);

      await ctx.replyWithPhoto(m.cover || undefined, {
        caption: `🎬 ${m.title}\n\n/send_${token}`,
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
    return;
  }

  // ---------- /send ----------
  if (/^\/send(@\w+)?_/i.test(text)) {
    const token = text
      .replace(/^\/send(@\w+)?_/i, "")
      .replace(/@\w+$/i, "")
      .trim();

    const payload = decodeSendToken(token);

    if (!payload || !payload.startsWith("forward_")) {
      return ctx.reply("❌ دستور نامعتبر");
    }

    const parts = payload.split("_");

    try {
      if (parts.length === 3 && /^\d+$/.test(parts[1])) {
        await ctx.telegram.forwardMessage(
          ctx.chat.id,
          `-100${parts[1]}`,
          Number(parts[2])
        );
        return;
      }

      if (parts.length === 3) {
        await ctx.telegram.forwardMessage(
          ctx.chat.id,
          `@${parts[1]}`,
          Number(parts[2])
        );
        return;
      }

      ctx.reply("❌ خطا در ارسال");
    } catch (e) {
      console.error("SEND ERROR:", e);
      ctx.reply("❌ ارسال فایل ناموفق بود");
    }
  }
});

// ===================================================
console.log("✅ FILMCHIIN BOT RUNNING (FULL INLINE SYNOPSIS + SAFE TOKEN)");
bot.launch();

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));