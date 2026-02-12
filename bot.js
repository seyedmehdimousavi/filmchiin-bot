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

function shortenText(text, max = 120) {
  if (!text) return "";
  if (text.length <= max) return text;
  return text.substring(0, max) + "…";
}

// جلوگیری از شکستن OR کوئری
function sanitize(value) {
  return value
    .replace(/,/g, "")
    .replace(/\(/g, "")
    .replace(/\)/g, "")
    .trim();
}

/*
  منطق جدید جستجو:
  #tag  → فقط genre و product
  عادی → title, synopsis, stars, director, genre, product
*/
function buildSearchConfig(query) {
  const isHashtag = query.startsWith("#");
  const cleanQuery = isHashtag
    ? query.substring(1).trim()
    : query.trim();

  return {
    isHashtag,
    value: sanitize(cleanQuery)
  };
}

function applySearch(builder, search) {

  const value = search.value;

  if (!value) return builder;

  const pattern = `%${value}%`;

  // حالت هشتگ → فقط ژانر و کشور
  if (search.isHashtag) {
    return builder.or(
      `genre.ilike.${pattern},product.ilike.${pattern}`
    );
  }

  // حالت متن عادی → فقط فیلدهای محتوایی
  const orQuery =
    `title.ilike.${pattern},` +
    `synopsis.ilike.${pattern},` +
    `stars.ilike.${pattern},` +
    `director.ilike.${pattern}`;

  return builder.or(orQuery);
}

// ===================================================
// Forward Payload
// ===================================================

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
// Secure token
// ===================================================

function safeBase64(str) {
  return Buffer.from(str)
    .toString("base64")
    .replace(/\+/g, "_")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function encodeSendToken(payload) {
  const sigRaw = crypto
    .createHmac("sha256", SEND_SECRET)
    .update(payload)
    .digest("hex")
    .substring(0, 12);

  const data = safeBase64(payload);
  return `${data}_${sigRaw}`;
}

function decodeSendToken(token) {
  if (!token || token.length < 20) return null;

  const parts = token.split("_");
  if (parts.length < 2) return null;

  const sig = parts.pop();
  const data = parts.join("_");

  let payload;
  try {
    payload = Buffer.from(data, "base64").toString();
  } catch {
    return null;
  }

  const expected = encodeSendToken(payload);
  if (!expected.endsWith(sig)) return null;

  return payload;
}

// ===================================================
// /start
// ===================================================

bot.start(async (ctx) => {
  const payload = ctx.startPayload || "";

  try {
    if (payload.startsWith("forward_")) {
      const parts = payload.split("_");

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

      return ctx.reply("Invalid movie link.");
    }

    ctx.reply("🎬 نام فیلم را ارسال کنید");

  } catch (e) {
    console.error("START ERROR:", e.message);
  }
});

// ===================================================
// INLINE QUERY (نسخه کاملاً اصلاح‌شده)
// ===================================================

bot.on("inline_query", async (ctx) => {

  try {

    const q = ctx.inlineQuery.query.trim();
    if (q.length < 2) {
      return ctx.answerInlineQuery([], { cache_time: 1 });
    }

    const search = buildSearchConfig(q);

    const moviesQuery = applySearch(
      supabase
        .from("movies")
        .select("id, title, cover, link, synopsis, stars, director, genre, product")
        .limit(10),
      search
    );

    const itemsQuery = applySearch(
      supabase
        .from("movie_items")
        .select("id, title, cover, link, synopsis, stars, director, genre, product")
        .limit(10),
      search
    );

    const { data: movies } = await moviesQuery;
    const { data: items } = await itemsQuery;

    const combined = [...(movies || []), ...(items || [])];

    const results = [];

    for (const m of combined) {

      const payload = buildForwardPayloadFromChannelLink(m.link);
      if (!payload) continue;

      results.push({
  type: "article",
  id: `res_${Math.random()}`,
  title: m.title,
  description: shortenText(
    m.synopsis ||
    `${m.genre || ""} | ${m.product || ""} | ${m.stars || ""}`
  ),
  thumb_url: m.cover,
  input_message_content: {
    message_text: `🎬 ${m.title}`,
  },
  reply_markup: {
    inline_keyboard: [
      [
        {
          text: "▶️ Go to file",
          url: `https://t.me/${ctx.botInfo.username}?start=${payload}`,
        },
      ],
    ],
  },
});
    }

    await ctx.answerInlineQuery(results, { cache_time: 1 });

  } catch (e) {
    console.error("INLINE ERROR:", e.message);
  }

});
// ===================================================
// TEXT HANDLER
// ===================================================

bot.on("text", async (ctx) => {

  const text = ctx.message.text.trim();

  // ===================================================
  // PRIVATE SEARCH
  // ===================================================
  if (ctx.chat.type === "private") {

    if (text.startsWith("/")) return;

    try {

      const search = buildSearchConfig(text);

      const moviesQuery = applySearch(
        supabase
          .from("movies")
          .select("id, title, cover, link, synopsis, stars, director, genre, product")
          .limit(10),
        search
      );

      const itemsQuery = applySearch(
        supabase
          .from("movie_items")
          .select("id, title, cover, link, synopsis, stars, director, genre, product")
          .limit(10),
        search
      );

      const { data: movies } = await moviesQuery;
      const { data: items } = await itemsQuery;

      let combined = [...(movies || []), ...(items || [])];

      if (!combined.length) {
        return ctx.reply("❌ فیلمی پیدا نشد");
      }

      // جلوگیری از تکراری‌ها (بر اساس title + link)
      const uniqueMap = new Map();
      for (const m of combined) {
        const key = `${m.title}_${m.link}`;
        if (!uniqueMap.has(key)) {
          uniqueMap.set(key, m);
        }
      }

      const uniqueResults = Array.from(uniqueMap.values());

      for (const m of uniqueResults) {

        const payload = buildForwardPayloadFromChannelLink(m.link);
        if (!payload) continue;

        await ctx.replyWithPhoto(m.cover || undefined, {
  caption: `🎬 ${m.title}`,
  reply_markup: {
    inline_keyboard: [
      [
        {
          text: "▶️ Go to file",
          url: `https://t.me/${ctx.botInfo.username}?start=${payload}`,
        },
      ],
    ],
  },
});

      }

    } catch (err) {
      console.error("PRIVATE SEARCH ERROR:", err.message);
    }

    return;
  }

  // ===================================================
  // GROUP SEARCH
  // ===================================================
  if (!["group", "supergroup"].includes(ctx.chat.type)) return;

  if (/^\/search(@\w+)?/i.test(text)) {

    let query = text.replace(/^\/search(@\w+)?/i, "").trim();

    if (!query && ctx.message.reply_to_message?.text) {
      query = ctx.message.reply_to_message.text.trim();
    }

    if (!query) {
      return ctx.reply("❌ نام فیلم را وارد کنید");
    }

    try {

      const search = buildSearchConfig(query);

      const moviesQuery = applySearch(
        supabase
          .from("movies")
          .select("id, title, cover, link, synopsis, stars, director, genre, product")
          .limit(10),
        search
      );

      const itemsQuery = applySearch(
        supabase
          .from("movie_items")
          .select("id, title, cover, link, synopsis, stars, director, genre, product")
          .limit(10),
        search
      );

      const { data: movies } = await moviesQuery;
      const { data: items } = await itemsQuery;

      let combined = [...(movies || []), ...(items || [])];

      if (!combined.length) {
        return ctx.reply("❌ چیزی پیدا نشد");
      }

      // حذف تکراری‌ها
      const uniqueMap = new Map();
      for (const m of combined) {
        const key = `${m.title}_${m.link}`;
        if (!uniqueMap.has(key)) {
          uniqueMap.set(key, m);
        }
      }

      const uniqueResults = Array.from(uniqueMap.values());

      for (const m of uniqueResults) {

        const payload = buildForwardPayloadFromChannelLink(m.link);
        if (!payload) continue;

        const token = encodeSendToken(payload);

        await ctx.replyWithPhoto(m.cover || undefined, {
  caption:
    `🎬 ${m.title}\n\n` +
    `/send_${token}`,
  reply_markup: {
    inline_keyboard: [
      [
        {
          text: "▶️ Go to file",
          url: `https://t.me/${ctx.botInfo.username}?start=${payload}`,
        },
      ],
    ],
  },
});

      }

    } catch (err) {
      console.error("GROUP SEARCH ERROR:", err.message);
    }

    return;
  }

  // ===================================================
  // SEND COMMAND
  // ===================================================
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

    } catch (err) {
      console.error("SEND ERROR:", err.message);
    }
  }

});

// ===================================================
// GLOBAL ERROR HANDLER
// ===================================================

bot.catch((err) => {
  if (err?.response?.error_code === 403) return;
  if (err?.code === "ETIMEDOUT") return;
  console.error("UNHANDLED ERROR:", err);
});

// ===================================================
// LAUNCH
// ===================================================

console.log("✅ FILMCHIIN BOT RUNNING (ADVANCED SEARCH ENABLED)");

bot.launch({ dropPendingUpdates: true });

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));