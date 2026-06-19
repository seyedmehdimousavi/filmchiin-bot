// ===================================================
// FILMCHIIN BOT - Cloudflare Workers Edition
// معماری: Webhook (نه polling)
// حافظه موقت: KV برای session و cron cursor
// نوتیفیکیشن: Cron Trigger هر دقیقه یک‌بار
// ===================================================

import { createClient } from "@supabase/supabase-js";
import { createHmac } from "node:crypto";

// ===================================================
// سیستم i18n - ترجمه‌های دوزبانه
// ===================================================

const i18n = {
  fa: {
    BTN_ACCOUNT:   "👤 حساب کاربری",
    BTN_NEWEST:    "🆕 جدیدترین‌ها",
    BTN_POPULAR:   "🔥 پردانلودترین‌ها",
    BTN_GENRES:    "🎭 ژانر‌ها",
    BTN_FAVORITES: "❤️ فیلم‌های مورد علاقه",
    BTN_SUPPORT:   "📞 ارتباط با پشتیبانی",
    BTN_DONATE:    "💙 حمایت از ما",
    BTN_LANGUAGE:  "🌐 زبان / Language",

    WELCOME:
      "به فیلم‌چین خوش آمدید...\n" +
      "برای جست‌وجو نام فیلم را ارسال کنید یا از دکمه‌های زیر استفاده کنید",

    NEWEST_TITLE:   "🆕 جدیدترین‌ها:",
    POPULAR_TITLE:  "🔥 پردانلودترین‌ها:",
    GENRES_TITLE:   "🎭 ژانر مورد نظر را انتخاب کنید:",
    GENRE_LABEL:    "🎭 ژانر:",
    GENRE_EMPTY:    "فیلمی پیدا نشد",
    NEXT_PAGE:      "⏭ ۱۰ فیلم بعدی",
    BACK:           "🔙 بازگشت",
    NO_TITLE:       "بدون عنوان",

    NOT_FOUND:        "❌ فیلمی پیدا نشد",
    GENRE_NOT_FOUND:  "❌ ژانری پیدا نشد",
    INVALID_LINK:     "❌ لینک این فیلم نامعتبر است",
    MOVIE_NOT_FOUND:  "❌ فیلم پیدا نشد",
    TRY_GENRES_AGAIN: "❌ لطفاً دوباره روی «ژانر‌ها» بزنید",
    SEARCH_EMPTY:     "❌ چیزی پیدا نشد",
    INVALID_CMD:      "❌ دستور نامعتبر",
    ERROR_RETRY:      "❌ خطایی رخ داد. لطفاً دوباره تلاش کنید.",
    SEARCH_HINT:      "❌ نام فیلم را وارد کنید",

    SUPPORT_TEXT:
      "📞 جهت ارتباط با پشتیبانی با آیدی زیر در ارتباط باشید:",
    SUPPORT_BTN: "💬 ارتباط با ادمین",

    DONATE_MSG:
      "کمک‌های کوچک تغییرات بزرگ ایجاد می‌کنند\n\n" +
      "*GRAM (ex TON):*",
    DONATE_ADDR: "UQAqP9Q7Hv27xSFmxonhp9wbV6_vBzOwmMPahEqaz9omq1FT",

    LANG_CHANGED: "✅ زبان به فارسی تغییر کرد",

    ENTER_EMAIL:    "👤 لطفاً نام کاربری (ایمیل) خود را وارد کنید:",
    ENTER_PASSWORD: "🔑 رمز عبور خود را وارد کنید:",
    BLOCKED:        "🚫 این حساب کاربری مسدود شده است.",
    LOGIN_ERROR:    "❌ نام کاربری یا رمز عبور اشتباه است. دوباره تلاش کنید.\n\nروی «👤 حساب کاربری» بزنید.",
    LOGIN_ID_ERROR: "❌ خطا در ورود. لطفاً دوباره تلاش کنید.",
    LOGIN_OK:       (u) => `✅ ورود موفقیت‌آمیز!\n\n👤 خوش آمدید، ${u}\n\nاکنون می‌توانید از «❤️ فیلم‌های مورد علاقه» استفاده کنید.`,

    LOGIN_REQUIRED:
      "⚠️ برای مشاهده فیلم‌های مورد علاقه ابتدا وارد حساب کاربری خود شوید.\n\nروی دکمه «👤 حساب کاربری» بزنید.",
    FAVS_EMPTY:   "❤️ هنوز هیچ فیلمی به مورد علاقه‌ها اضافه نکرده‌اید.",
    FAVS_ERROR:   "❌ خطا در دریافت فیلم‌های مورد علاقه",
    FAVS_TITLE:   (n) => `❤️ فیلم‌های مورد علاقه شما (${n} فیلم):`,
    GET_FILE:     "📥 دریافت فایل",
    GO_TO_FILE:   "▶️ Go to file",
  },

  en: {
    BTN_ACCOUNT:   "👤 Account",
    BTN_NEWEST:    "🆕 Newest",
    BTN_POPULAR:   "🔥 Most Popular",
    BTN_GENRES:    "🎭 Genres",
    BTN_FAVORITES: "❤️ Favorites",
    BTN_SUPPORT:   "📞 Support",
    BTN_DONATE:    "💙 Support Us",
    BTN_LANGUAGE:  "🌐 زبان / Language",

    WELCOME:
      "Welcome to FilmChiin...\n" +
      "Send a movie name to search or use the buttons below",

    NEWEST_TITLE:   "🆕 Newest:",
    POPULAR_TITLE:  "🔥 Most Popular:",
    GENRES_TITLE:   "🎭 Choose a genre:",
    GENRE_LABEL:    "🎭 Genre:",
    GENRE_EMPTY:    "No movies found",
    NEXT_PAGE:      "⏭ Next 10 movies",
    BACK:           "🔙 Back",
    NO_TITLE:       "No title",

    NOT_FOUND:        "❌ No movies found",
    GENRE_NOT_FOUND:  "❌ No genres found",
    INVALID_LINK:     "❌ Invalid movie link",
    MOVIE_NOT_FOUND:  "❌ Movie not found",
    TRY_GENRES_AGAIN: "❌ Please tap «Genres» again",
    SEARCH_EMPTY:     "❌ Nothing found",
    INVALID_CMD:      "❌ Invalid command",
    ERROR_RETRY:      "❌ An error occurred. Please try again.",
    SEARCH_HINT:      "❌ Enter a movie name",

    SUPPORT_TEXT: "📞 Contact support via the ID below:",
    SUPPORT_BTN:  "💬 Contact Admin",

    DONATE_MSG:
      "Small contributions make big changes\n\n" +
      "*GRAM (ex TON):*",
    DONATE_ADDR: "UQAqP9Q7Hv27xSFmxonhp9wbV6_vBzOwmMPahEqaz9omq1FT",

    LANG_CHANGED: "✅ Language changed to English",

    ENTER_EMAIL:    "👤 Please enter your username (email):",
    ENTER_PASSWORD: "🔑 Enter your password:",
    BLOCKED:        "🚫 This account has been blocked.",
    LOGIN_ERROR:    "❌ Wrong username or password. Please try again.\n\nTap «👤 Account».",
    LOGIN_ID_ERROR: "❌ Login error. Please try again.",
    LOGIN_OK:       (u) => `✅ Login successful!\n\n👤 Welcome, ${u}\n\nYou can now use «❤️ Favorites».`,

    LOGIN_REQUIRED:
      "⚠️ Please log in first to view your favorites.\n\nTap the «👤 Account» button.",
    FAVS_EMPTY:   "❤️ You haven't added any favorites yet.",
    FAVS_ERROR:   "❌ Error fetching favorites",
    FAVS_TITLE:   (n) => `❤️ Your favorites (${n} movies):`,
    GET_FILE:     "📥 Get File",
    GO_TO_FILE:   "▶️ Go to file",
  },
};

// ===================================================
// تابع گرفتن ترجمه بر اساس زبان کاربر
// ===================================================

function t(lang, key, ...args) {
  const dict = i18n[lang] || i18n["fa"];
  const val  = dict[key];
  if (typeof val === "function") return val(...args);
  return val ?? key;
}

// ===================================================
// KV helpers برای زبان کاربر
// ===================================================

async function getUserLang(kv, chatId) {
  if (!kv) return "fa";
  try {
    const lang = await kv.get(`lang:${chatId}`);
    return lang === "en" ? "en" : "fa";
  } catch { return "fa"; }
}

async function setUserLang(kv, chatId, lang) {
  if (!kv) return;
  await kv.put(`lang:${chatId}`, lang, { expirationTtl: 86400 * 365 });
}

// ===================================================
// ساخت کیبورد اصلی بر اساس زبان
// ===================================================

function buildMainMenuMarkup(lang) {
  return {
    keyboard: [
      [t(lang, "BTN_ACCOUNT")],
      [t(lang, "BTN_NEWEST"), t(lang, "BTN_POPULAR")],
      [t(lang, "BTN_GENRES")],
      [t(lang, "BTN_FAVORITES")],
      [t(lang, "BTN_SUPPORT"), t(lang, "BTN_DONATE")],
      [t(lang, "BTN_LANGUAGE")],
    ],
    resize_keyboard: true,
  };
}

// ===================================================
// ثابت‌های غیر UI
// ===================================================

const SUPPORT_ADMIN_URL  = "https://t.me/seyedmahdimousavi";
const LIST_PAGE_SIZE     = 10;
const POPULAR_LIST_LIMIT = 20;
const GENRE_LIST_LIMIT   = 30;

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

function sanitize(value) {
  return value.replace(/,/g, "").replace(/\(/g, "").replace(/\)/g, "").trim();
}

function buildSearchConfig(query) {
  const isHashtag  = query.startsWith("#");
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
  const sig  = parts.pop();
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
// Keyboard Builders (با پشتیبانی زبان)
// ===================================================

function movieListKeyboard(movies, lang) {
  const rows = [[{ text: t(lang, "BACK"), callback_data: "back:menu" }]];
  for (const m of movies) {
    rows.push([{ text: shortenText(m.title || t(lang, "NO_TITLE"), 60), callback_data: `m:${m.id}` }]);
  }
  return { inline_keyboard: rows };
}

async function buildGenresKeyboard(supabase, kv, lang) {
  const genres = await getGenreList(supabase, kv);
  const rows   = [[{ text: t(lang, "BACK"), callback_data: "back:menu" }]];
  for (let i = 0; i < genres.length; i += 2) {
    const row = [{ text: `${genres[i].name} (${genres[i].count})`, callback_data: `genre:${i}:0` }];
    if (genres[i + 1]) row.push({ text: `${genres[i + 1].name} (${genres[i + 1].count})`, callback_data: `genre:${i + 1}:0` });
    rows.push(row);
  }
  return { genres, keyboard: { inline_keyboard: rows } };
}

async function buildGenreMoviesView(supabase, kv, genreIndex, offset, lang) {
  const genres = await getGenreList(supabase, kv);
  const genre  = genres[genreIndex];
  if (!genre) return null;
  const { items, hasMore } = await fetchMoviesByGenre(supabase, genre.name, offset);
  const rows = [[{ text: t(lang, "BACK"), callback_data: "back:genres" }]];
  for (const m of items) {
    rows.push([{ text: shortenText(m.title || t(lang, "NO_TITLE"), 60), callback_data: `m:${m.id}` }]);
  }
  if (hasMore) {
    rows.push([{ text: t(lang, "NEXT_PAGE"), callback_data: `genre:${genreIndex}:${offset + LIST_PAGE_SIZE}` }]);
  }
  const label = t(lang, "GENRE_LABEL");
  const empty = t(lang, "GENRE_EMPTY");
  const text  = items.length ? `${label} ${genre.name}` : `${label} ${genre.name}\n${empty}`;
  return { text, keyboard: { inline_keyboard: rows } };
}

// ===================================================
// Notification (Cron)
// ===================================================

async function buildNotificationPayload(movie, botUsername, includeSend, secret) {
  const payload = buildForwardPayloadFromChannelLink(movie.link);
  if (!payload) return null;
  const safeTitle    = movie.title || "بدون عنوان";
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
  const supabase        = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY || env.SUPABASE_KEY);
  const kv              = env.BOT_KV;
  const token           = env.BOT_TOKEN;
  const secret          = env.SEND_SECRET;
  const subscribersTable = env.SUBSCRIBERS_TABLE || "telegram_subscribers";
  const botUsername     = env.BOT_USERNAME || "Filmchinbot";

  const lastMovieUpdatedAt = await kv?.get("cursor_movie_updated_at") || null;
  const lastItemCreatedAt  = await kv?.get("cursor_item_created_at")  || null;

  if (!lastMovieUpdatedAt && !lastItemCreatedAt) {
    const { data: latestMovie } = await supabase.from("movies").select("updated_at, created_at").order("updated_at", { ascending: false, nullsFirst: false }).limit(1);
    const { data: latestItem  } = await supabase.from("movie_items").select("created_at").order("created_at", { ascending: false, nullsFirst: false }).limit(1);
    const movieTs = latestMovie?.[0]?.updated_at || latestMovie?.[0]?.created_at || new Date().toISOString();
    const itemTs  = latestItem?.[0]?.created_at  || new Date().toISOString();
    await kv?.put("cursor_movie_updated_at", movieTs);
    await kv?.put("cursor_item_created_at",  itemTs);
    console.log("CRON: cursors initialized");
    return;
  }

  const newMovies = await fetchNewRows(supabase, "movies",      lastMovieUpdatedAt, "updated_at");
  const newItems  = await fetchNewRows(supabase, "movie_items", lastItemCreatedAt,  "created_at");

  if (!newMovies.length && !newItems.length) return;

  const { data: subscribers } = await supabase
    .from(subscribersTable)
    .select("chat_id, chat_type")
    .eq("is_active", true);

  const subs   = subscribers || [];
  const allNew = [
    ...newMovies.map(m => ({ ...m, source: "movies" })),
    ...newItems.map(m  => ({ ...m, source: "movie_items" })),
  ];

  for (const movie of allNew) {
    for (const sub of subs) {
      const includeSend = sub.chat_type === "group" || sub.chat_type === "supergroup";
      const msg = await buildNotificationPayload(movie, botUsername, includeSend, secret);
      if (!msg) continue;
      try {
        if (msg.photo) {
          await tgCall(token, "sendPhoto", { chat_id: sub.chat_id, photo: msg.photo, caption: msg.caption, reply_markup: msg.reply_markup });
        } else {
          await tgCall(token, "sendMessage", { chat_id: sub.chat_id, text: msg.caption, reply_markup: msg.reply_markup });
        }
      } catch (err) {
        console.error("NOTIFY ERROR:", err.message);
        await markSubscriberInactive(supabase, sub.chat_id, subscribersTable);
      }
    }
  }

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
  const BOT_TOKEN        = env.BOT_TOKEN;
  const SEND_SECRET      = env.SEND_SECRET;
  const BOT_USERNAME     = env.BOT_USERNAME || "Filmchinbot";
  const SUBSCRIBERS_TABLE = env.SUBSCRIBERS_TABLE || "telegram_subscribers";
  const kv               = env.BOT_KV;

  const supabase = createClient(
    env.SUPABASE_URL,
    env.SUPABASE_SERVICE_KEY || env.SUPABASE_KEY
  );

  const send   = (chat_id, text, extra = {}) => tgCall(BOT_TOKEN, "sendMessage", { chat_id, text, ...extra });
  const answer = (callback_query_id, text = "") => tgCall(BOT_TOKEN, "answerCallbackQuery", { callback_query_id, text });
  const edit   = (chat_id, message_id, text, extra = {}) => tgCall(BOT_TOKEN, "editMessageText", { chat_id, message_id, text, ...extra });
  const del    = (chat_id, message_id) => tgCall(BOT_TOKEN, "deleteMessage", { chat_id, message_id });

  // ===================================================
  // Callback Query
  // ===================================================
  if (update.callback_query) {
    const cbq    = update.callback_query;
    const data   = cbq.data || "";
    const chat   = cbq.message?.chat;
    const msgId  = cbq.message?.message_id;
    const chatId = String(chat?.id);
    const lang   = await getUserLang(kv, chatId);

    await answer(cbq.id);

    // m:<id>
    const mMatch = data.match(/^m:(\d+)$/);
    if (mMatch) {
      const id = Number(mMatch[1]);
      const { data: movie, error } = await supabase.from("movies").select("id, title, cover, link").eq("id", id).single();
      if (error || !movie) return send(chat.id, t(lang, "MOVIE_NOT_FOUND"));
      const payload = buildForwardPayloadFromChannelLink(movie.link);
      if (!payload) return send(chat.id, t(lang, "INVALID_LINK"));
      const cover = normalizeCover(movie.cover);
      const kb    = { inline_keyboard: [[{ text: t(lang, "GO_TO_FILE"), url: `https://t.me/${BOT_USERNAME}?start=${payload}` }]] };
      if (cover) {
        return tgCall(BOT_TOKEN, "sendPhoto", { chat_id: chat.id, photo: cover, caption: `🎬 ${movie.title}`, reply_markup: kb });
      }
      return send(chat.id, `🎬 ${movie.title}`, { reply_markup: kb });
    }

    // back:menu
    if (data === "back:menu") {
      try { await del(chat.id, msgId); } catch {}
      return;
    }

    // back:genres
    if (data === "back:genres") {
      const { genres, keyboard } = await buildGenresKeyboard(supabase, kv, lang);
      if (!genres.length) return send(chat.id, t(lang, "GENRE_NOT_FOUND"));
      return edit(chat.id, msgId, t(lang, "GENRES_TITLE"), { reply_markup: keyboard });
    }

    // genre:<index>:<offset>
    const genreMatch = data.match(/^genre:(\d+):(\d+)$/);
    if (genreMatch) {
      const genreIndex = Number(genreMatch[1]);
      const offset     = Number(genreMatch[2]);
      const view = await buildGenreMoviesView(supabase, kv, genreIndex, offset, lang);
      if (!view) return send(chat.id, t(lang, "TRY_GENRES_AGAIN"));
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
  const lang   = await getUserLang(kv, chatId);

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

    return send(chat.id, t(lang, "WELCOME"), { reply_markup: buildMainMenuMarkup(lang) });
  }

  // ===================================================
  // Private chat handlers
  // ===================================================
  if (chat.type === "private") {

    if (text.startsWith("/")) return;

    // --- دکمه زبان ---
    if (text === i18n.fa.BTN_LANGUAGE || text === i18n.en.BTN_LANGUAGE) {
      const newLang = lang === "fa" ? "en" : "fa";
      await setUserLang(kv, chatId, newLang);
      return send(chat.id, t(newLang, "LANG_CHANGED"), {
        reply_markup: buildMainMenuMarkup(newLang),
      });
    }

    // --- حساب کاربری ---
    if (text === t(lang, "BTN_ACCOUNT")) {
      await setLoginState(kv, chatId, { step: "username" });
      return send(chat.id, t(lang, "ENTER_EMAIL"));
    }

    // --- جدیدترین‌ها ---
    if (text === t(lang, "BTN_NEWEST")) {
      const movies = await fetchNewestMovies(supabase);
      if (!movies.length) return send(chat.id, t(lang, "NOT_FOUND"));
      return send(chat.id, t(lang, "NEWEST_TITLE"), { reply_markup: movieListKeyboard(movies, lang) });
    }

    // --- پردانلودترین‌ها ---
    if (text === t(lang, "BTN_POPULAR")) {
      const movies = await fetchPopularMoviesList(supabase);
      if (!movies.length) return send(chat.id, t(lang, "NOT_FOUND"));
      return send(chat.id, t(lang, "POPULAR_TITLE"), { reply_markup: movieListKeyboard(movies, lang) });
    }

    // --- ژانر‌ها ---
    if (text === t(lang, "BTN_GENRES")) {
      const { genres, keyboard } = await buildGenresKeyboard(supabase, kv, lang);
      if (!genres.length) return send(chat.id, t(lang, "GENRE_NOT_FOUND"));
      return send(chat.id, t(lang, "GENRES_TITLE"), { reply_markup: keyboard });
    }

    // --- پشتیبانی ---
    if (text === t(lang, "BTN_SUPPORT")) {
      return send(chat.id, t(lang, "SUPPORT_TEXT"), {
        reply_markup: { inline_keyboard: [[{ text: t(lang, "SUPPORT_BTN"), url: SUPPORT_ADMIN_URL }]] },
      });
    }

    // --- حمایت از ما ---
    if (text === t(lang, "BTN_DONATE")) {
      const donateMsg  = t(lang, "DONATE_MSG");
      const donateAddr = t(lang, "DONATE_ADDR");
      // ارسال پیام اصلی با Bold
      await send(chat.id, donateMsg, { parse_mode: "Markdown" });
      // ارسال آدرس به صورت Mono (قابل کپی در تلگرام)
      return send(chat.id, `\`${donateAddr}\``, { parse_mode: "Markdown" });
    }

    // --- علاقه‌مندی‌ها ---
    if (text === t(lang, "BTN_FAVORITES")) {
      const session = await getSession(kv, chatId);
      if (!session) {
        return send(chat.id, t(lang, "LOGIN_REQUIRED"));
      }
      const { data: favs, error: favErr } = await supabase
        .from("favorites")
        .select("movie_id, created_at")
        .eq("user_id", session.userId)
        .order("created_at", { ascending: false });
      if (favErr || !favs?.length) return send(chat.id, t(lang, "FAVS_EMPTY"));
      const movieIds = favs.map(f => f.movie_id);
      const { data: movies, error: movErr } = await supabase.from("movies").select("id, title, cover, link").in("id", movieIds);
      if (movErr || !movies?.length) return send(chat.id, t(lang, "FAVS_ERROR"));
      const movieMap = new Map(movies.map(m => [String(m.id), m]));
      const ordered  = movieIds.map(id => movieMap.get(String(id))).filter(Boolean);
      await send(chat.id, t(lang, "FAVS_TITLE", ordered.length));
      for (const m of ordered) {
        const payload = buildForwardPayloadFromChannelLink(m.link);
        if (!payload) continue;
        const cover = normalizeCover(m.cover);
        const kb    = { inline_keyboard: [[{ text: t(lang, "GET_FILE"), url: `https://t.me/${BOT_USERNAME}?start=${payload}` }]] };
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
        return send(chat.id, t(lang, "ENTER_PASSWORD"));
      }
      if (loginStep.step === "password") {
        await deleteLoginState(kv, chatId);
        const email    = loginStep.username;
        const password = text;
        try {
          const { data: blocked } = await supabase.from("blocked_users").select("id").eq("email", email).maybeSingle();
          if (blocked) return send(chat.id, t(lang, "BLOCKED"));

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
            return send(chat.id, t(lang, "LOGIN_ERROR"));
          }
          const userId = authData?.user?.id;
          if (!userId) return send(chat.id, t(lang, "LOGIN_ID_ERROR"));
          const { data: dbUser } = await supabase.from("users").select("username, email").eq("id", userId).maybeSingle();
          const username = dbUser?.username || email;
          await setSession(kv, chatId, { userId, username, email });
          return send(chat.id, t(lang, "LOGIN_OK", username));
        } catch (err) {
          console.error("LOGIN ERROR:", err.message);
          return send(chat.id, t(lang, "LOGIN_ID_ERROR"));
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
      if (!results.length) return send(chat.id, t(lang, "NOT_FOUND"));
      for (const m of results) {
        const payload = buildForwardPayloadFromChannelLink(m.link);
        if (!payload) continue;
        const cover = normalizeCover(m.cover);
        const kb    = { inline_keyboard: [[{ text: t(lang, "GO_TO_FILE"), url: `https://t.me/${BOT_USERNAME}?start=${payload}` }]] };
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
    if (!query) return send(chat.id, t(lang, "SEARCH_HINT"));
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
      if (!results.length) return send(chat.id, t(lang, "SEARCH_EMPTY"));
      for (const m of results) {
        const payload = buildForwardPayloadFromChannelLink(m.link);
        if (!payload) continue;
        const token   = encodeSendToken(payload, SEND_SECRET);
        const cover   = normalizeCover(m.cover);
        const kb      = { inline_keyboard: [[{ text: t(lang, "GO_TO_FILE"), url: `https://t.me/${BOT_USERNAME}?start=${payload}` }]] };
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
    if (!payload || !payload.startsWith("forward_")) return send(chat.id, t(lang, "INVALID_CMD"));
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
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/debug") {
      return new Response(
        JSON.stringify({ envKeys: Object.keys(env), botTokenExists: !!env.BOT_TOKEN, sendSecretExists: !!env.SEND_SECRET, kvExists: !!env.BOT_KV }, null, 2),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    if (url.pathname === "/setup" && request.method === "GET") {
      const webhookUrl = `${url.origin}/webhook`;
      const res = await tgCall(env.BOT_TOKEN, "setWebhook", {
        url: webhookUrl,
        drop_pending_updates: true,
        allowed_updates: ["message", "callback_query", "inline_query", "my_chat_member"],
      });
      return new Response(JSON.stringify(res, null, 2), { headers: { "Content-Type": "application/json" } });
    }

    if (url.pathname === "/webhook" && request.method === "POST") {
      try {
        const update = await request.json();
        console.log("UPDATE:", JSON.stringify(update));
        await handleUpdate(update, env);
        console.log("HANDLE UPDATE OK");
      } catch (err) {
        console.error("WEBHOOK ERROR", err?.message, err?.stack, JSON.stringify(err));
      }
      return new Response("ok");
    }

    return new Response("filmchiin-bot alive");
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runCronNotification(env));
  },
};
