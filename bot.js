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

/*
  مطابق اسکیما:
  movies:
    title, stars, director, genre
  movie_items:
    title, stars, director, genre
*/
function buildSearchConfig(query) {
  const isHashtag = query.startsWith("#");
  const cleanQuery = isHashtag
    ? query.substring(1).trim()
    : query.trim();

  const safeQuery = cleanQuery.replace(/,/g, ""); // جلوگیری از خطای OR

  return {
    isHashtag,
    value: safeQuery
  };
}

function applySearch(builder, search) {
  if (search.isHashtag) {
    // فقط ژانر
    return builder.ilike("genre", `%${search.value}%`);
  }

  // جستجوی چندستونه صحیح (بدون % داخل متغیر)
  return builder.or(
    `title.ilike.%${search.value}%,
     stars.ilike.%${search.value}%,
     director.ilike.%${search.value}%,
     genre.ilike.%${search.value}%`
  );
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
// INLINE QUERY (اصلاح‌شده کامل)
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
        .select("id, title, cover, link, synopsis, stars, director, genre")
        .limit(5),
      search
    );

    const itemsQuery = applySearch(
      supabase
        .from("movie_items")
        .select("id, title, cover, link, synopsis, stars, director, genre")
        .limit(5),
      search
    );

    const { data: movies } = await moviesQuery;
    const { data: items } = await itemsQuery;

    const results = [];

    for (const m of [...(movies || []), ...(items || [])]) {
      const payload = buildForwardPayloadFromChannelLink(m.link);
      if (!payload) continue;

      results.push({
        type: "article",
        id: `res_${Math.random()}`,
        title: m.title,
        description: shortenText(
          m.synopsis ||
          `${m.genre || ""} | ${m.stars || ""} | ${m.director || ""}`
        ),
        thumb_url: m.cover,
        input_message_content: {
          message_text: `🎬 ${m.title}`,
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
          .select("title, cover, link, stars, director, genre")
          .limit(5),
        search
      );

      const itemsQuery = applySearch(
        supabase
          .from("movie_items")
          .select("title, cover, link, stars, director, genre")
          .limit(5),
        search
      );

      const { data: movies } = await moviesQuery;
      const { data: items } = await itemsQuery;

      const all = [...(movies || []), ...(items || [])];

      if (!all.length)
        return ctx.reply("❌ فیلمی پیدا نشد");

      for (const m of all) {
        const payload = buildForwardPayloadFromChannelLink(m.link);
        if (!payload) continue;

        await ctx.replyWithPhoto(m.cover || undefined, {
          caption: `🎬 ${m.title}`,
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

    if (!query)
      return ctx.reply("❌ نام فیلم را وارد کنید");

    try {
      const search = buildSearchConfig(query);

      const moviesQuery = applySearch(
        supabase
          .from("movies")
          .select("title, cover, link, stars, director, genre")
          .limit(5),
        search
      );

      const itemsQuery = applySearch(
        supabase
          .from("movie_items")
          .select("title, cover, link, stars, director, genre")
          .limit(5),
        search
      );

      const { data: movies } = await moviesQuery;
      const { data: items } = await itemsQuery;

      const all = [...(movies || []), ...(items || [])];

      if (!all.length)
        return ctx.reply("❌ چیزی پیدا نشد");

      for (const m of all) {
        const payload = buildForwardPayloadFromChannelLink(m.link);
        if (!payload) continue;

        const token = encodeSendToken(payload);

        await ctx.replyWithPhoto(m.cover || undefined, {
          caption: `🎬 ${m.title}\n\n/send_${token}`,
        });
      }

    } catch (err) {
      console.error("GROUP SEARCH ERROR:", err.message);
    }

    return;
  }

  // ===================================================
  // SEND
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

console.log("✅ FILMCHIIN BOT RUNNING (FULL SEARCH FIXED)");

bot.launch({ dropPendingUpdates: true });

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));