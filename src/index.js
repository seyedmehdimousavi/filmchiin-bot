// ===================================================
// FILMCHIIN BOT - Cloudflare Workers Edition
// معماری: Webhook (نه polling)
// حافظه موقت: KV برای session و cron cursor
// نوتیفیکیشن: Cron Trigger هر دقیقه یک‌بار
// ===================================================

import { createClient } from "@supabase/supabase-js";
import { createHmac } from "node:crypto";

// ===================================================
// ثابت‌های UI
// ===================================================
const BTN_ACCOUNT   = "👤 حساب کاربری";
const BTN_NEWEST    = "🆕 جدیدترین‌ها";
const BTN_POPULAR   = "🔥 پردانلودترین‌ها";
const BTN_GENRES    = "🎭 ژانر‌ها";
const BTN_FAVORITES = "❤️ فیلم‌های مورد علاقه";
const BTN_SUPPORT   = "📞 ارتباط با پشتیبانی";
const SUPPORT_ADMIN_URL = "https://t.me/seyedmahdimousavi";

const WELCOME_TEXT =
  "به فیلم‌چین خوش آمدید...\n" +
  "برای جست‌وجو نام فیلم را ارسال کنید یا از دکمه‌های زیر استفاده کنید";

const MAIN_MENU_REPLY_MARKUP = {
  keyboard: [
    [BTN_ACCOUNT],
    [BTN_NEWEST, BTN_POPULAR],
    [BTN_GENRES],
    [BTN_FAVORITES],
    [BTN_SUPPORT],
  ],
  resize_keyboard: true,
};

const LIST_PAGE_SIZE   = 10;
const POPULAR_LIST_LIMIT = 20;
const GENRE_LIST_LIMIT = 30;

// ===================================================
// کمک‌کننده‌های Telegram API
// ===================================================

async function tgCall(token, method, body) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

// ===================================================
// کمک‌کننده‌های عمومی
// ===================================================

function shortenText(text, max = 120) {
  if (!text) return "";
  if (text.length <= max) return text;
  return text.substring(0, max) + "…";
}

function normalizeCover(cover) {
  if (!cover || cover === "#") return undefined;
  return cover;
}

function isMissingTableError(err) {
  const message = err?.message || err?.details || "";
  return (
    /Could not find the table/i.test(message) ||
    /relation .* does not exist/i.test(message)
  );
}

function sanitize(value) {
  return value.replace(/,/g, "").replace(/\(/g, "").replace(/\)/g, "").trim();
}

function buildSearchConfig(query) {
  const isHashtag = query.startsWith("#");
  const cleanQuery = isHashtag ? query.substring(1).trim() : query.trim();
  return { isHashtag, value: sanitize(cleanQuery) };
}

function applySearch(builder, search) {
  const value = search.value;
  if (!value) return builder;
  const pattern = `%${value}%`;
  if (search.isHashtag) {
    return builder.or(`genre.ilike.${pattern},product.ilike.${pattern}`);
  }
  return builder.or(
    `title.ilike.${pattern},synopsis.ilike.${pattern},stars.ilike.${pattern},director.ilike.${pattern}`
  );
}

function isPersianToken(token) {
  const clean = token.startsWith("#") ? token.slice(1) : token;
  return clean.length > 0 && !/^[A-Za-z]/.test(clean);
}

// ===================================================
// Forward Payload
// ===================================================

function buildForwardPayloadFromChannelLink(rawLink) {
  const trimmed = (rawLink || "").trim();
  if (!trimmed || trimmed === "#") return null;
  let url;
  try { url = new URL(trimmed); } catch { return null; }
  const host = url.hostname.toLowerCase();
  if (host !== "t.me" && host !== "telegram.me") return null;
  const directStart = url.searchParams.get("start");
  if (directStart) return directStart;
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts[0] === "c" && parts.length >= 3) return `forward_${parts[1]}_${parts[2]}`;
  if (parts.length === 2) return `forward_${parts[0]}_${parts[1]}`;
  if (parts.length === 3) return `forward_${parts[0]}_${parts[2]}`;
  return null;
}

// ===================================================
// Secure token (با Web Crypto API سازگار با Workers)
// ===================================================

function safeBase64(str) {
  return btoa(str)
    .replace(/\+/g, "_")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function encodeSendToken(payload, secret) {
  const sig = createHmac("sha256", secret)
    .update(payload)
    .digest("hex")
    .substring(0, 12);
  const data = safeBase64(payload);
  return `${data}_${sig}`;
}

function decodeSendToken(token, secret) {
  if (!token || token.length < 20) return null;
  const parts = token.split("_");
  if (parts.length < 2) return null;
  const sig = parts.pop();
  const data = parts.join("_");
  let payload;
  try { payload = atob(data); } catch { return null; }
  const expected = encodeSendToken(payload, secret);
  if (!expected.endsWith(sig)) return null;
  return payload;
}

// ===================================================
// Supabase Subscribers
// ===================================================

async function upsertSubscriber(supabase, chat, subscribersTable, source = "unknown") {
  if (!chat?.id || !chat?.type) return;
  const fullRow = {
    chat_id: String(chat.id),
    chat_type: chat.type,
    title: chat.title || null,
    username: chat.username || null,
    first_name: chat.first_name || null,
    last_name: chat.last_name || null,
    is_active: true,
    source,
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase
    .from(subscribersTable)
    .upsert(fullRow, { onConflict: "chat_id" });
  if (!error) return;
  const minimalRow = { chat_id: String(chat.id), chat_type: chat.type, is_active: true };
  await supabase.from(subscribersTable).upsert(minimalRow, { onConflict: "chat_id" });
}

async function markSubscriberInactive(supabase, chatId, subscribersTable) {
  if (!chatId) return;
  const { error } = await supabase
    .from(subscribersTable)
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq("chat_id", String(chatId));
  if (error) {
    await supabase
      .from(subscribersTable)
      .update({ is_active: false })
      .eq("chat_id", String(chatId));
  }
}

// ===================================================
// Movie Fetchers
// ===================================================

async function fetchNewestMovies(supabase, limit = LIST_PAGE_SIZE) {
  const { data, error } = await supabase
    .from("movies")
    .select("id, title")
    .order("updated_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) { console.error("NEWEST MOVIES:", error.message); return []; }
  return data || [];
}

async function fetchPopularMoviesList(supabase, limit = POPULAR_LIST_LIMIT) {
  const { data, error } = await supabase
    .from("movies")
    .select("id, title")
    .eq("is_popular", true)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) { console.error("POPULAR MOVIES:", error.message); return []; }
  return data || [];
}

async function fetchMoviesByGenre(supabase, genreName, offset = 0, limit = LIST_PAGE_SIZE) {
  const pattern = `%${genreName}%`;
  const { data, error } = await supabase
    .from("movies")
    .select("id, title")
    .ilike("genre", pattern)
    .order("updated_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit);
  if (error) { console.error("GENRE MOVIES:", error.message); return { items: [], hasMore: false }; }
  const rows = data || [];
  return { items: rows.slice(0, limit), hasMore: rows.length > limit };
}

async function getGenreList(supabase, kv) {
  // کش در KV به مدت ۱۰ دقیقه
  if (kv) {
    const cached = await kv.get("genre_cache", "json");
    if (cached) return cached;
  }
  const { data, error } = await supabase.from("movies").select("genre");
  if (error) { console.error("GENRE LIST:", error.message); return []; }
  const counts = {};
  for (const row of data || []) {
    if (!row.genre) continue;
    for (const raw of row.genre.split(" ")) {
      const name = raw.trim();
      if (!name || !isPersianToken(name)) continue;
      counts[name] = (counts[name] || 0) + 1;
    }
  }
  const genres = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, GENRE_LIST_LIMIT)
    .map(([name, count]) => ({ name, count }));
  if (kv) await kv.put("genre_cache", JSON.stringify(genres), { expirationTtl: 600 });
  return genres;
}

// ===================================================
// Keyboard Builders
// ===================================================

function movieListKeyboard(movies) {
  const rows = [[{ text: "🔙 بازگشت", callback_data: "back:menu" }]];
  for (const m of movies) {
    rows.push([{ text: shortenText(m.title || "بدون عنوان", 60), callback_data: `m:${m.id}` }]);
  }
  return { inline_keyboard: rows };
}

async function buildGenresKeyboard(supabase, kv) {
  const genres = await getGenreList(supabase, kv);
  const rows = [[{ text: "🔙 بازگشت", callback_data: "back:menu" }]];
  for (let i = 0; i < genres.length; i += 2) {
    const row = [{ text: `${genres[i].name} (${genres[i].count})`, callback_data: `genre:${i}:0` }];
    if (genres[i + 1]) row.push({ text: `${genres[i + 1].name} (${genres[i + 1].count})`, callback_data: `genre:${i + 1}:0` });
    rows.push(row);
  }
  return { genres, keyboard: { inline_keyboard: rows } };
}

async function buildGenreMoviesView(supabase, kv, genreIndex, offset) {
  const genres = await getGenreList(supabase, kv);
  const genre = genres[genreIndex];
  if (!genre) return null;
  const { items, hasMore } = await fetchMoviesByGenre(supabase, genre.name, offset);
  const rows = [[{ text: "🔙 بازگشت", callback_data: "back:genres" }]];
  for (const m of items) {
    rows.push([{ text: shortenText(m.title || "بدون عنوان", 60), callback_data: `m:${m.id}` }]);
  }
  if (hasMore) {
    rows.push([{ text: "⏭ ۱۰ فیلم بعدی", callback_data: `genre:${genreIndex}:${offset + LIST_PAGE_SIZE}` }]);
  }
  const text = items.length ? `🎭 ژانر: ${genre.name}` : `🎭 ژانر: ${genre.name}\nفیلمی پیدا نشد`;
  return { text, keyboard: { inline_keyboard: rows } };
}

// ===================================================
// Notification (Cron)
// ===================================================

async function buildNotificationPayload(movie, botUsername, includeSend, secret) {
  const payload = buildForwardPayloadFromChannelLink(movie.link);
  if (!payload) return null;
  const safeTitle = movie.title || "بدون عنوان";
  const captionLines = [`🎬 ${safeTitle}`];
  if (includeSend) {
    const token = encodeSendToken(payload, secret);
    captionLines.push("", `/send_${token}`);
  }
  return {
    photo: normalizeCover(movie.cover),
    caption: captionLines.join("\n"),
    reply_markup: {
      inline_keyboard: [[{ text: "▶️ Go to file", url: `https://t.me/${botUsername}?start=${payload}` }]],
    },
  };
}

async function fetchNewRows(supabase, tableName, sinceIso, timestampColumn = "created_at") {
  let query = supabase
    .from(tableName)
    .select(timestampColumn === "updated_at" ? "id, title, cover, link, created_at, updated_at" : "id, title, cover, link, created_at")
    .order(timestampColumn, { ascending: true })
    .order("id", { ascending: true })
    .limit(20);
  if (sinceIso) query = query.gt(timestampColumn, sinceIso);
  const { data, error } = await query;
  if (error) { console.error(`${tableName} NEW ROWS:`, error.message); return []; }
  return data || [];
}

async function runCronNotification(env) {
  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY || env.SUPABASE_KEY);
  const kv = env.BOT_KV;
  const token = env.BOT_TOKEN;
  const secret = env.SEND_SECRET;
  const subscribersTable = env.SUBSCRIBERS_TABLE || "telegram_subscribers";
  const botUsername = env.BOT_USERNAME || "Filmchinbot";

  // خواندن cursor از KV
  const lastMovieUpdatedAt = await kv?.get("cursor_movie_updated_at") || null;
  const lastItemCreatedAt  = await kv?.get("cursor_item_created_at")  || null;

  // اگر cursor وجود نداشت → فقط cursor را مقداردهی کن، چیزی ارسال نکن
  if (!lastMovieUpdatedAt && !lastItemCreatedAt) {
    const { data: latestMovie } = await supabase
      .from("movies")
      .select("updated_at, created_at")
      .order("updated_at", { ascending: false, nullsFirst: false })
      .limit(1);
    const { data: latestItem } = await supabase
      .from("movie_items")
      .select("created_at")
      .order("created_at", { ascending: false, nullsFirst: false })
      .limit(1);
    const movieTs = latestMovie?.[0]?.updated_at || latestMovie?.[0]?.created_at || new Date().toISOString();
    const itemTs  = latestItem?.[0]?.created_at  || new Date().toISOString();
    await kv?.put("cursor_movie_updated_at", movieTs);
    await kv?.put("cursor_item_created_at",  itemTs);
    console.log("CRON: cursors initialized");
    return;
  }

  const newMovies = await fetchNewRows(supabase, "movies",       lastMovieUpdatedAt, "updated_at");
  const newItems  = await fetchNewRows(supabase, "movie_items",  lastItemCreatedAt,  "created_at");

  if (!newMovies.length && !newItems.length) return;

  // دریافت مشترکین فعال
  const { data: subscribers } = await supabase
    .from(subscribersTable)
    .select("chat_id, chat_type")
    .eq("is_active", true);

  const subs = subscribers || [];

  const allNew = [
    ...newMovies.map(m => ({ ...m, source: "movies" })),
    ...newItems.map(m => ({ ...m, source: "movie_items" })),
  ];

  for (const movie of allNew) {
    for (const sub of subs) {
      const includeSend = sub.chat_type === "group" || sub.chat_type === "supergroup";
      const msg = await buildNotificationPayload(movie, botUsername, includeSend, secret);
      if (!msg) continue;
      try {
        if (msg.photo) {
          await tgCall(token, "sendPhoto", {
            chat_id: sub.chat_id,
            photo: msg.photo,
            caption: msg.caption,
            reply_markup: msg.reply_markup,
          });
        } else {
          await tgCall(token, "sendMessage", {
            chat_id: sub.chat_id,
            text: msg.caption,
            reply_markup: msg.reply_markup,
          });
        }
      } catch (err) {
        console.error("NOTIFY ERROR:", err.message);
        await markSubscriberInactive(supabase, sub.chat_id, subscribersTable);
      }
    }
  }

  // به‌روزرسانی cursor
  if (newMovies.length) {
    const last = newMovies[newMovies.length - 1];
    await kv?.put("cursor_movie_updated_at", last.updated_at || last.created_at);
  }
  if (newItems.length) {
    await kv?.put("cursor_item_created_at", newItems[newItems.length - 1].created_at);
  }
}

// ===================================================
// Session Helpers (KV-based)
// ===================================================

async function getLoginState(kv, chatId) {
  if (!kv) return null;
  return kv.get(`login_state:${chatId}`, "json");
}
async function setLoginState(kv, chatId, state) {
  if (!kv) return;
  await kv.put(`login_state:${chatId}`, JSON.stringify(state), { expirationTtl: 300 });
}
async function deleteLoginState(kv, chatId) {
  if (!kv) return;
  await kv.delete(`login_state:${chatId}`);
}
async function getSession(kv, chatId) {
  if (!kv) return null;
  return kv.get(`session:${chatId}`, "json");
}
async function setSession(kv, chatId, session) {
  if (!kv) return;
  await kv.put(`session:${chatId}`, JSON.stringify(session), { expirationTtl: 86400 * 7 });
}

// ===================================================
// پردازش Webhook Update
// ===================================================

async function handleUpdate(update, env) {
  const BOT_TOKEN       = env.BOT_TOKEN;
  const SEND_SECRET     = env.SEND_SECRET;
  const BOT_USERNAME    = env.BOT_USERNAME || "Filmchinbot";
  const SUBSCRIBERS_TABLE = env.SUBSCRIBERS_TABLE || "telegram_subscribers";
  const kv = env.BOT_KV;

  const supabase = createClient(
    env.SUPABASE_URL,
    env.SUPABASE_SERVICE_KEY || env.SUPABASE_KEY
  );

  // shorthand برای ارسال پیام
  const send   = (chat_id, text, extra = {}) => tgCall(BOT_TOKEN, "sendMessage", { chat_id, text, ...extra });
  const answer = (callback_query_id, text = "") => tgCall(BOT_TOKEN, "answerCallbackQuery", { callback_query_id, text });
  const edit   = (chat_id, message_id, text, extra = {}) => tgCall(BOT_TOKEN, "editMessageText", { chat_id, message_id, text, ...extra });
  const del    = (chat_id, message_id) => tgCall(BOT_TOKEN, "deleteMessage", { chat_id, message_id });

  // ===================================================
  // Callback Query
  // ===================================================
  if (update.callback_query) {
    const cbq  = update.callback_query;
    const data = cbq.data || "";
    const chat = cbq.message?.chat;
    const msgId = cbq.message?.message_id;

    await answer(cbq.id);

    // m:<id>
    const mMatch = data.match(/^m:(\d+)$/);
    if (mMatch) {
      const id = Number(mMatch[1]);
      const { data: movie, error } = await supabase.from("movies").select("id, title, cover, link").eq("id", id).single();
      if (error || !movie) return send(chat.id, "❌ فیلم پیدا نشد");
      const payload = buildForwardPayloadFromChannelLink(movie.link);
      if (!payload) return send(chat.id, "❌ لینک این فیلم نامعتبر است");
      const cover = normalizeCover(movie.cover);
      if (cover) {
        return tgCall(BOT_TOKEN, "sendPhoto", {
          chat_id: chat.id,
          photo: cover,
          caption: `🎬 ${movie.title}`,
          reply_markup: { inline_keyboard: [[{ text: "▶️ Go to file", url: `https://t.me/${BOT_USERNAME}?start=${payload}` }]] },
        });
      }
      return send(chat.id, `🎬 ${movie.title}`, {
        reply_markup: { inline_keyboard: [[{ text: "▶️ Go to file", url: `https://t.me/${BOT_USERNAME}?start=${payload}` }]] },
      });
    }

    // back:menu
    if (data === "back:menu") {
      try { await del(chat.id, msgId); } catch {}
      return;
    }

    // back:genres
    if (data === "back:genres") {
      const { genres, keyboard } = await buildGenresKeyboard(supabase, kv);
      if (!genres.length) return send(chat.id, "❌ ژانری پیدا نشد");
      return edit(chat.id, msgId, "🎭 ژانر مورد نظر را انتخاب کنید:", { reply_markup: keyboard });
    }

    // genre:<index>:<offset>
    const genreMatch = data.match(/^genre:(\d+):(\d+)$/);
    if (genreMatch) {
      const genreIndex = Number(genreMatch[1]);
      const offset     = Number(genreMatch[2]);
      const view = await buildGenreMoviesView(supabase, kv, genreIndex, offset);
      if (!view) return send(chat.id, "❌ لطفاً دوباره روی «ژانر‌ها» بزنید");
      return edit(chat.id, msgId, view.text, { reply_markup: view.keyboard });
    }

    return;
  }

  // ===================================================
  // Inline Query
  // ===================================================
  if (update.inline_query) {
    const iq = update.inline_query;
    const q  = iq.query.trim();
    if (q.length < 2) return tgCall(BOT_TOKEN, "answerInlineQuery", { inline_query_id: iq.id, results: [], cache_time: 1 });

    const search = buildSearchConfig(q);
    const moviesQuery = applySearch(supabase.from("movies").select("id, title, cover, link, synopsis, stars, director, genre, product").limit(10), search);
    const itemsQuery  = applySearch(supabase.from("movie_items").select("id, title, cover, link, synopsis, stars, director, genre, product").limit(10), search);
    const [{ data: movies }, { data: items }] = await Promise.all([moviesQuery, itemsQuery]);

    const results = [];
    for (const m of [...(movies || []), ...(items || [])]) {
      const payload = buildForwardPayloadFromChannelLink(m.link);
      if (!payload) continue;
      results.push({
        type: "article",
        id: `res_${Math.random()}`,
        title: m.title,
        description: shortenText(m.synopsis || `${m.genre || ""} | ${m.product || ""} | ${m.stars || ""}`),
        thumb_url: m.cover,
        input_message_content: { message_text: `🎬 ${m.title}` },
        reply_markup: { inline_keyboard: [[{ text: "▶️ Go to file", url: `https://t.me/${BOT_USERNAME}?start=${payload}` }]] },
      });
    }
    return tgCall(BOT_TOKEN, "answerInlineQuery", { inline_query_id: iq.id, results, cache_time: 1 });
  }

  // ===================================================
  // Message
  // ===================================================
  if (!update.message) return;

  const msg    = update.message;
  const chat   = msg.chat;
  const chatId = String(chat.id);
  const text   = msg.text?.trim() || "";

  // ثبت مشترک
  await upsertSubscriber(supabase, chat, SUBSCRIBERS_TABLE, "message");

  // ===================================================
  // /start
  // ===================================================
  if (text.startsWith("/start")) {
    const payload = text.replace("/start", "").trim();

    if (payload.startsWith("forward_")) {
      const parts = payload.split("_");
      if (parts.length === 3 && /^\d+$/.test(parts[1])) {
        return tgCall(BOT_TOKEN, "forwardMessage", {
          chat_id: chat.id,
          from_chat_id: `-100${parts[1]}`,
          message_id: Number(parts[2]),
        });
      }
      if (parts.length === 3) {
        return tgCall(BOT_TOKEN, "forwardMessage", {
          chat_id: chat.id,
          from_chat_id: `@${parts[1]}`,
          message_id: Number(parts[2]),
        });
      }
      return send(chat.id, "Invalid movie link.");
    }

    return send(chat.id, WELCOME_TEXT, { reply_markup: MAIN_MENU_REPLY_MARKUP });
  }

  // ===================================================
  // Private chat handlers
  // ===================================================
  if (chat.type === "private") {

    if (text.startsWith("/")) return;

    // --- حساب کاربری ---
    if (text === BTN_ACCOUNT) {
      await setLoginState(kv, chatId, { step: "username" });
      return send(chat.id, "👤 لطفاً نام کاربری (ایمیل) خود را وارد کنید:");
    }

    // --- جدیدترین‌ها ---
    if (text === BTN_NEWEST) {
      const movies = await fetchNewestMovies(supabase);
      if (!movies.length) return send(chat.id, "❌ فیلمی پیدا نشد");
      return send(chat.id, "🆕 جدیدترین‌ها:", { reply_markup: movieListKeyboard(movies) });
    }

    // --- پردانلودترین‌ها ---
    if (text === BTN_POPULAR) {
      const movies = await fetchPopularMoviesList(supabase);
      if (!movies.length) return send(chat.id, "❌ فیلمی پیدا نشد");
      return send(chat.id, "🔥 پردانلودترین‌ها:", { reply_markup: movieListKeyboard(movies) });
    }

    // --- ژانر‌ها ---
    if (text === BTN_GENRES) {
      const { genres, keyboard } = await buildGenresKeyboard(supabase, kv);
      if (!genres.length) return send(chat.id, "❌ ژانری پیدا نشد");
      return send(chat.id, "🎭 ژانر مورد نظر را انتخاب کنید:", { reply_markup: keyboard });
    }

    // --- پشتیبانی ---
    if (text === BTN_SUPPORT) {
      return send(chat.id, "📞 جهت ارتباط با پشتیبانی با آیدی زیر در ارتباط باشید:", {
        reply_markup: { inline_keyboard: [[{ text: "💬 ارتباط با ادمین", url: SUPPORT_ADMIN_URL }]] },
      });
    }

    // --- علاقه‌مندی‌ها ---
    if (text === BTN_FAVORITES) {
      const session = await getSession(kv, chatId);
      if (!session) {
        return send(chat.id, "⚠️ برای مشاهده فیلم‌های مورد علاقه ابتدا وارد حساب کاربری خود شوید.\n\nروی دکمه «👤 حساب کاربری» بزنید.");
      }
      const { data: favs, error: favErr } = await supabase
        .from("favorites")
        .select("movie_id, created_at")
        .eq("user_id", session.userId)
        .order("created_at", { ascending: false });
      if (favErr || !favs?.length) return send(chat.id, "❤️ هنوز هیچ فیلمی به مورد علاقه‌ها اضافه نکرده‌اید.");
      const movieIds = favs.map(f => f.movie_id);
      const { data: movies, error: movErr } = await supabase.from("movies").select("id, title, cover, link").in("id", movieIds);
      if (movErr || !movies?.length) return send(chat.id, "❌ خطا در دریافت فیلم‌های مورد علاقه");
      const movieMap = new Map(movies.map(m => [String(m.id), m]));
      const ordered  = movieIds.map(id => movieMap.get(String(id))).filter(Boolean);
      await send(chat.id, `❤️ فیلم‌های مورد علاقه شما (${ordered.length} فیلم):`);
      for (const m of ordered) {
        const payload = buildForwardPayloadFromChannelLink(m.link);
        if (!payload) continue;
        const cover = normalizeCover(m.cover);
        const kb = { inline_keyboard: [[{ text: "📥 دریافت فایل", url: `https://t.me/${BOT_USERNAME}?start=${payload}` }]] };
        if (cover) {
          try {
            await tgCall(BOT_TOKEN, "sendPhoto", { chat_id: chat.id, photo: cover, caption: `🎬 ${m.title}`, reply_markup: kb });
            continue;
          } catch {}
        }
        await send(chat.id, `🎬 ${m.title}`, { reply_markup: kb });
      }
      return;
    }

    // --- مدیریت مرحله‌ای ورود ---
    const loginStep = await getLoginState(kv, chatId);
    if (loginStep) {
      if (loginStep.step === "username") {
        await setLoginState(kv, chatId, { step: "password", username: text });
        return send(chat.id, "🔑 رمز عبور خود را وارد کنید:");
      }
      if (loginStep.step === "password") {
        await deleteLoginState(kv, chatId);
        const email    = loginStep.username;
        const password = text;
        try {
          const { data: blocked } = await supabase.from("blocked_users").select("id").eq("email", email).maybeSingle();
          if (blocked) return send(chat.id, "🚫 این حساب کاربری مسدود شده است.");

          const authRes = await fetch(`${env.SUPABASE_URL}/auth/v1/token?grant_type=password`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "apikey": env.SUPABASE_SERVICE_KEY || env.SUPABASE_KEY,
            },
            body: JSON.stringify({ email, password }),
          });
          const authData = await authRes.json();
          if (!authRes.ok || !authData?.access_token) {
            return send(chat.id, "❌ نام کاربری یا رمز عبور اشتباه است. دوباره تلاش کنید.\n\nروی «👤 حساب کاربری» بزنید.");
          }
          const userId = authData?.user?.id;
          if (!userId) return send(chat.id, "❌ خطا در ورود. لطفاً دوباره تلاش کنید.");
          const { data: dbUser } = await supabase.from("users").select("username, email").eq("id", userId).maybeSingle();
          const username = dbUser?.username || email;
          await setSession(kv, chatId, { userId, username, email });
          return send(chat.id, `✅ ورود موفقیت‌آمیز!\n\n👤 خوش آمدید، ${username}\n\nاکنون می‌توانید از «❤️ فیلم‌های مورد علاقه» استفاده کنید.`);
        } catch (err) {
          console.error("LOGIN ERROR:", err.message);
          return send(chat.id, "❌ خطا در ورود. لطفاً دوباره تلاش کنید.");
        }
      }
    }

    // --- جست‌وجوی متنی (private) ---
    try {
      const search = buildSearchConfig(text);
      const [{ data: movies }, { data: items }] = await Promise.all([
        applySearch(supabase.from("movies").select("id, title, cover, link, synopsis, stars, director, genre, product").limit(10), search),
        applySearch(supabase.from("movie_items").select("id, title, cover, link, synopsis, stars, director, genre, product").limit(10), search),
      ]);
      const uniqueMap = new Map();
      for (const m of [...(movies || []), ...(items || [])]) {
        const key = `${m.title}_${m.link}`;
        if (!uniqueMap.has(key)) uniqueMap.set(key, m);
      }
      const results = Array.from(uniqueMap.values());
      if (!results.length) return send(chat.id, "❌ فیلمی پیدا نشد");
      for (const m of results) {
        const payload = buildForwardPayloadFromChannelLink(m.link);
        if (!payload) continue;
        const cover = normalizeCover(m.cover);
        const kb = { inline_keyboard: [[{ text: "▶️ Go to file", url: `https://t.me/${BOT_USERNAME}?start=${payload}` }]] };
        if (cover) {
          try { await tgCall(BOT_TOKEN, "sendPhoto", { chat_id: chat.id, photo: cover, caption: `🎬 ${m.title}`, reply_markup: kb }); continue; } catch {}
        }
        await send(chat.id, `🎬 ${m.title}`, { reply_markup: kb });
      }
    } catch (err) {
      console.error("PRIVATE SEARCH ERROR:", err.message);
    }
    return;
  }

  // ===================================================
  // Group handlers
  // ===================================================
  if (!["group", "supergroup"].includes(chat.type)) return;

  // /search
  if (/^\/search(@\w+)?/i.test(text)) {
    let query = text.replace(/^\/search(@\w+)?/i, "").trim();
    if (!query && msg.reply_to_message?.text) query = msg.reply_to_message.text.trim();
    if (!query) return send(chat.id, "❌ نام فیلم را وارد کنید");
    try {
      const search = buildSearchConfig(query);
      const [{ data: movies }, { data: items }] = await Promise.all([
        applySearch(supabase.from("movies").select("id, title, cover, link, synopsis, stars, director, genre, product").limit(10), search),
        applySearch(supabase.from("movie_items").select("id, title, cover, link, synopsis, stars, director, genre, product").limit(10), search),
      ]);
      const uniqueMap = new Map();
      for (const m of [...(movies || []), ...(items || [])]) {
        const key = `${m.title}_${m.link}`;
        if (!uniqueMap.has(key)) uniqueMap.set(key, m);
      }
      const results = Array.from(uniqueMap.values());
      if (!results.length) return send(chat.id, "❌ چیزی پیدا نشد");
      for (const m of results) {
        const payload = buildForwardPayloadFromChannelLink(m.link);
        if (!payload) continue;
        const token = encodeSendToken(payload, SEND_SECRET);
        const cover = normalizeCover(m.cover);
        const kb = { inline_keyboard: [[{ text: "▶️ Go to file", url: `https://t.me/${BOT_USERNAME}?start=${payload}` }]] };
        const caption = `🎬 ${m.title}\n\n/send_${token}`;
        if (cover) {
          try { await tgCall(BOT_TOKEN, "sendPhoto", { chat_id: chat.id, photo: cover, caption, reply_markup: kb }); continue; } catch {}
        }
        await send(chat.id, caption, { reply_markup: kb });
      }
    } catch (err) {
      console.error("GROUP SEARCH ERROR:", err.message);
    }
    return;
  }

  // /send_<token>
  if (/^\/send(@\w+)?_/i.test(text)) {
    const token   = text.replace(/^\/send(@\w+)?_/i, "").replace(/@\w+$/i, "").trim();
    const payload = decodeSendToken(token, SEND_SECRET);
    if (!payload || !payload.startsWith("forward_")) return send(chat.id, "❌ دستور نامعتبر");
    const parts = payload.split("_");
    try {
      if (parts.length === 3 && /^\d+$/.test(parts[1])) {
        return tgCall(BOT_TOKEN, "forwardMessage", { chat_id: chat.id, from_chat_id: `-100${parts[1]}`, message_id: Number(parts[2]) });
      }
      if (parts.length === 3) {
        return tgCall(BOT_TOKEN, "forwardMessage", { chat_id: chat.id, from_chat_id: `@${parts[1]}`, message_id: Number(parts[2]) });
      }
    } catch (err) {
      console.error("SEND ERROR:", err.message);
    }
  }
}

// ===================================================
// Worker Entry Point
// ===================================================

export default {
  // درخواست‌های HTTP (Webhook از تلگرام)
  async fetch(request, env) {
    const url = new URL(request.url);

if (url.pathname === "/debug") {
  return new Response(
    JSON.stringify(
      {
        envKeys: Object.keys(env),
        botTokenExists: !!env.BOT_TOKEN,
        sendSecretExists: !!env.SEND_SECRET,
        kvExists: !!env.BOT_KV,
      },
      null,
      2
    ),
    {
      headers: { "Content-Type": "application/json" },
    }
  );
}

    // endpoint ثبت webhook (یک‌بار اجرا کن)
    // endpoint تست
if (url.pathname === "/setup" && request.method === "GET") {
  const webhookUrl = `${url.origin}/webhook`;

  return new Response(
    JSON.stringify(
      {
        webhookUrl,
        botTokenExists: !!env.BOT_TOKEN,
        botUsername: env.BOT_USERNAME,
        sendSecretExists: !!env.SEND_SECRET,
        kvExists: !!env.BOT_KV,
      },
      null,
      2
    ),
    {
      headers: {
        "Content-Type": "application/json",
      },
    }
  );
}


    // دریافت update از تلگرام
    if (url.pathname === "/webhook" && request.method === "POST") {
      try {
        const update = await request.json();
        await handleUpdate(update, env);
      } catch (err) {
        console.error("WEBHOOK ERROR:", err.message);
      }
      return new Response("ok");
    }

    return new Response("filmchiin-bot alive");
  },

  // Cron Trigger برای نوتیفیکیشن فیلم‌های جدید
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runCronNotification(env));
  },
};