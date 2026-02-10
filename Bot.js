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
// Secure token (NO DOT)
// ===================================================
function encodeSendToken(payload) {
  const sig = crypto
    .createHmac("sha256", SEND_SECRET)
    .update(payload)
    .digest("base64url")
    .slice(0, 12);

  const data = Buffer.from(payload).toString("base64url");
  return `${data}${sig}`;
}

function decodeSendToken(token) {
  if (!token || token.length < 20) return null;

  const sig = token.slice(-12);
  const data = token.slice(0, -12);

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

    // 🔁 اگر متن نداشت، از ریپلای بخوان
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

  // ---------- /send_<token> ----------
  if (text.startsWith("/send_")) {
    const token = text.replace("/send_", "").trim();
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
console.log("✅ FILMCHIIN BOT RUNNING (SMART SEARCH + REPLY SUPPORT)");
bot.launch();

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));