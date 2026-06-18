require("dotenv").config();
const { Telegraf } = require("telegraf");
const { createClient } = require("@supabase/supabase-js");
const crypto = require("crypto");
const http = require("http");

// ===================================================
// Init bot
// ===================================================
const BOT_TOKEN = process.env.BOT_TOKEN;
const SEND_SECRET = process.env.SEND_SECRET;
const SUBSCRIBERS_TABLE = process.env.SUBSCRIBERS_TABLE || "telegram_subscribers";
const MOVIE_POLL_INTERVAL_MS = Number(process.env.MOVIE_POLL_INTERVAL_MS || 60000);
const BOT_USERNAME = process.env.BOT_USERNAME || "Filmchinbot";

if (!BOT_TOKEN) {
  console.error("BOT_TOKEN missing");
  process.exit(1);
}
if (!SEND_SECRET) {
  console.error("SEND_SECRET missing");
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

let isPolling = false;
let botUsername = BOT_USERNAME;
let lastMovieUpdatedAt = null;
let lastItemCreatedAt = null;

let subscribersTableAvailable = true;
let subscribersTableWarningShown = false;
const runtimeSubscribers = new Map();

// ===================================================
// دکمه‌های منوی اصلی (جدیدترین‌ها / پردانلودترین‌ها / ژانر‌ها)
// ===================================================
const BTN_NEWEST = "🆕 جدیدترین‌ها";
const BTN_POPULAR = "🔥 پردانلودترین‌ها";
const BTN_GENRES = "🎭 ژانر‌ها";

const WELCOME_TEXT =
  "به فیلم‌چین خوش آمدید...\n" +
  "برای جست‌وجو نام فیلم را ارسال کنید یا از دکمه‌های زیر استفاده کنید";

const MAIN_MENU_REPLY_MARKUP = {
  keyboard: [[BTN_NEWEST, BTN_POPULAR], [BTN_GENRES]],
  resize_keyboard: true,
};

const LIST_PAGE_SIZE = 10;
const POPULAR_LIST_LIMIT = 20;
const GENRE_LIST_LIMIT = 30;
const GENRE_CACHE_TTL_MS = 10 * 60 * 1000; // ۱۰ دقیقه کش لیست ژانرها

let genreListCache = [];
let genreListCacheAt = 0;

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

function normalizeCover(cover) {
  if (!cover || cover === "#") return undefined;
  return cover;
}

function isChatMigratedError(err) {
  const message = err?.response?.description || "";
  return err?.response?.error_code === 400 && /migrated/i.test(message);
}

function isMissingTableError(err) {
  const message = err?.message || err?.details || "";
  return /Could not find the table/i.test(message) || /relation .* does not exist/i.test(message);
}

function rememberRuntimeSubscriber(chat) {
  if (!chat?.id || !chat?.type) return;
  runtimeSubscribers.set(String(chat.id), {
    chat_id: String(chat.id),
    chat_type: chat.type,
    is_active: true,
  });
}

function forgetRuntimeSubscriber(chatId) {
  if (!chatId) return;
  runtimeSubscribers.delete(String(chatId));
}

function warnSubscribersFallbackOnce() {
  if (subscribersTableWarningShown) return;
  subscribersTableWarningShown = true;
  console.error(
    `SUBSCRIBERS TABLE NOT FOUND (${SUBSCRIBERS_TABLE}) -> using in-memory subscribers only.`
  );
}

async function upsertSubscriber(chat, source = "unknown") {
  if (!chat?.id || !chat?.type) return;

  rememberRuntimeSubscriber(chat);

  if (!subscribersTableAvailable) return;

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
    .from(SUBSCRIBERS_TABLE)
    .upsert(fullRow, { onConflict: "chat_id" });

  if (!error) return;

  // fallback for narrower subscriber schemas
  const minimalRow = {
    chat_id: String(chat.id),
    chat_type: chat.type,
    is_active: true,
  };

  const { error: minimalError } = await supabase
    .from(SUBSCRIBERS_TABLE)
    .upsert(minimalRow, { onConflict: "chat_id" });

  if (!minimalError) return;

  if (isMissingTableError(minimalError)) {
    subscribersTableAvailable = false;
    warnSubscribersFallbackOnce();
    return;
  }

  console.error("SUBSCRIBER UPSERT ERROR:", minimalError.message);
}

async function markSubscriberInactive(chatId) {
  if (!chatId) return;

  forgetRuntimeSubscriber(chatId);

  if (!subscribersTableAvailable) return;

  const { error } = await supabase
    .from(SUBSCRIBERS_TABLE)
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq("chat_id", String(chatId));

  if (!error) return;

  const { error: fallbackError } = await supabase
    .from(SUBSCRIBERS_TABLE)
    .update({ is_active: false })
    .eq("chat_id", String(chatId));

  if (fallbackError) {
    if (isMissingTableError(fallbackError)) {
      subscribersTableAvailable = false;
      warnSubscribersFallbackOnce();
      return;
    }

    console.error("SUBSCRIBER DEACTIVATE ERROR:", fallbackError.message);
  }
}

function buildNotificationPayload(movie, includeSend) {
  const payload = buildForwardPayloadFromChannelLink(movie.link);
  if (!payload) return null;

  const safeTitle = movie.title || "بدون عنوان";
  const captionLines = [`🎬 ${safeTitle}`];

  if (includeSend) {
    const token = encodeSendToken(payload);
    captionLines.push("", `/send_${token}`);
  }

  return {
    photo: normalizeCover(movie.cover),
    caption: captionLines.join("\n"),
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: "▶️ Go to file",
            url: `https://t.me/${botUsername}?start=${payload}`,
          },
        ],
      ],
    },
  };
}

async function fetchLatestMovie(limit = 1) {
  const { data, error } = await supabase
    .from("movies")
    .select("id, title, cover, link, created_at, updated_at")
    .order("updated_at", { ascending: false, nullsFirst: false })
    .order("id", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("LATEST MOVIE FETCH ERROR:", error.message);
    return [];
  }

  return (data || []).map((m) => ({ ...m, source: "movies" }));
}

async function fetchLatestMovieItem(limit = 1) {
  const { data, error } = await supabase
    .from("movie_items")
    .select("id, title, cover, link, created_at")
    .order("created_at", { ascending: false, nullsFirst: false })
    .order("id", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("LATEST MOVIE ITEM FETCH ERROR:", error.message);
    return [];
  }

  return (data || []).map((m) => ({ ...m, source: "movie_items" }));
}

async function fetchNewRows(tableName, sinceIso, timestampColumn = "created_at") {
  let query = supabase
    .from(tableName)
    .select(
      timestampColumn === "updated_at"
        ? "id, title, cover, link, created_at, updated_at"
        : "id, title, cover, link, created_at"
    )
    .order(timestampColumn, { ascending: true })
    .order("id", { ascending: true })
    .limit(20);

  if (sinceIso) {
    query = query.gt(timestampColumn, sinceIso);
  }

  const { data, error } = await query;

  if (error) {
    console.error(`${tableName.toUpperCase()} NEW ROWS FETCH ERROR:`, error.message);
    return [];
  }

  return data || [];
}

async function fetchActiveSubscribers() {
  if (!subscribersTableAvailable) {
    return Array.from(runtimeSubscribers.values());
  }

  const { data, error } = await supabase
    .from(SUBSCRIBERS_TABLE)
    .select("chat_id, chat_type")
    .eq("is_active", true);

  if (!error) return data || [];

  const { data: fallbackData, error: fallbackError } = await supabase
    .from(SUBSCRIBERS_TABLE)
    .select("chat_id, chat_type");

  if (fallbackError) {
    if (isMissingTableError(fallbackError)) {
      subscribersTableAvailable = false;
      warnSubscribersFallbackOnce();
      return Array.from(runtimeSubscribers.values());
    }

    console.error("SUBSCRIBERS FETCH ERROR:", fallbackError.message);
    return [];
  }

  return fallbackData || [];
}

async function notifySubscribersAboutMovie(movie) {
  const subscribers = await fetchActiveSubscribers();
  if (!subscribers.length) return;

  for (const sub of subscribers) {
    const includeSend = sub.chat_type === "group" || sub.chat_type === "supergroup";
    const message = buildNotificationPayload(movie, includeSend);
    if (!message) continue;

    try {
      if (message.photo) {
        await bot.telegram.sendPhoto(sub.chat_id, message.photo, {
          caption: message.caption,
          reply_markup: message.reply_markup,
        });
      } else {
        await bot.telegram.sendMessage(sub.chat_id, message.caption, {
          reply_markup: message.reply_markup,
        });
      }
    } catch (err) {
      if (err?.response?.error_code === 403 || err?.response?.error_code === 400) {
        await markSubscriberInactive(sub.chat_id);
        continue;
      }

      if (isChatMigratedError(err)) {
        await markSubscriberInactive(sub.chat_id);
        continue;
      }

      console.error("NOTIFY ERROR:", err.message);
    }
  }
}

async function bootstrapNotificationCursor() {
  const [latestMovie] = await fetchLatestMovie(1);
  const [latestItem] = await fetchLatestMovieItem(1);

  lastMovieUpdatedAt = latestMovie?.updated_at || latestMovie?.created_at || null;
  lastItemCreatedAt = latestItem?.created_at || null;
}

async function checkAndNotifyNewMovie() {
  if (isPolling) return;
  isPolling = true;

  try {
    const newMovies = await fetchNewRows("movies", lastMovieUpdatedAt, "updated_at");
    const newItems = await fetchNewRows("movie_items", lastItemCreatedAt);

    for (const movie of newMovies) {
      await notifySubscribersAboutMovie({ ...movie, source: "movies" });
    }

    for (const item of newItems) {
      await notifySubscribersAboutMovie({ ...item, source: "movie_items" });
    }

    if (newMovies.length) {
      const lastMovie = newMovies[newMovies.length - 1];
      lastMovieUpdatedAt = lastMovie.updated_at || lastMovie.created_at;
    }

    if (newItems.length) {
      lastItemCreatedAt = newItems[newItems.length - 1].created_at;
    }
  } finally {
    isPolling = false;
  }
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

  let url;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  const host = url.hostname.toLowerCase();
  if (host !== "t.me" && host !== "telegram.me") return null;

  const directStart = url.searchParams.get("start");
  if (directStart) {
    return directStart;
  }

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
// منوی فیلم‌ها (جدیدترین‌ها / پردانلودترین‌ها / ژانر‌ها)
// ===================================================

function isPersianToken(token) {
  const clean = token.startsWith("#") ? token.slice(1) : token;
  return clean.length > 0 && !/^[A-Za-z]/.test(clean);
}

async function getGenreList() {
  const now = Date.now();
  if (genreListCache.length && now - genreListCacheAt < GENRE_CACHE_TTL_MS) {
    return genreListCache;
  }

  const { data, error } = await supabase.from("movies").select("genre");

  if (error) {
    console.error("GENRE LIST FETCH ERROR:", error.message);
    return genreListCache;
  }

  const counts = {};
  for (const row of data || []) {
    if (!row.genre) continue;
    for (const raw of row.genre.split(" ")) {
      const name = raw.trim();
      if (!name || !isPersianToken(name)) continue;
      counts[name] = (counts[name] || 0) + 1;
    }
  }

  genreListCache = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, GENRE_LIST_LIMIT)
    .map(([name, count]) => ({ name, count }));
  genreListCacheAt = now;

  return genreListCache;
}

async function fetchNewestMovies(limit = LIST_PAGE_SIZE) {
  const { data, error } = await supabase
    .from("movies")
    .select("id, title")
    .order("updated_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("NEWEST MOVIES FETCH ERROR:", error.message);
    return [];
  }

  return data || [];
}

async function fetchPopularMoviesList(limit = POPULAR_LIST_LIMIT) {
  const { data, error } = await supabase
    .from("movies")
    .select("id, title")
    .eq("is_popular", true)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("POPULAR MOVIES FETCH ERROR:", error.message);
    return [];
  }

  return data || [];
}

async function fetchMoviesByGenre(genreName, offset = 0, limit = LIST_PAGE_SIZE) {
  const pattern = `%${genreName}%`;

  const { data, error } = await supabase
    .from("movies")
    .select("id, title")
    .ilike("genre", pattern)
    .order("updated_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .range(offset, offset + limit); // یکی بیشتر می‌گیریم تا بفهمیم ادامه دارد یا نه

  if (error) {
    console.error("GENRE MOVIES FETCH ERROR:", error.message);
    return { items: [], hasMore: false };
  }

  const rows = data || [];
  const hasMore = rows.length > limit;
  return { items: rows.slice(0, limit), hasMore };
}

function movieListKeyboard(movies) {
  const rows = [[{ text: "🔙 بازگشت", callback_data: "back:menu" }]];
  for (const m of movies) {
    rows.push([
      { text: shortenText(m.title || "بدون عنوان", 60), callback_data: `m:${m.id}` },
    ]);
  }
  return { inline_keyboard: rows };
}

async function buildGenresKeyboard() {
  const genres = await getGenreList();
  const rows = [[{ text: "🔙 بازگشت", callback_data: "back:menu" }]];

  for (let i = 0; i < genres.length; i += 2) {
    const row = [];
    row.push({
      text: `${genres[i].name} (${genres[i].count})`,
      callback_data: `genre:${i}:0`,
    });
    if (genres[i + 1]) {
      row.push({
        text: `${genres[i + 1].name} (${genres[i + 1].count})`,
        callback_data: `genre:${i + 1}:0`,
      });
    }
    rows.push(row);
  }

  return { genres, keyboard: { inline_keyboard: rows } };
}

async function buildGenreMoviesView(genreIndex, offset) {
  const genres = await getGenreList();
  const genre = genres[genreIndex];
  if (!genre) return null;

  const { items, hasMore } = await fetchMoviesByGenre(genre.name, offset);

  const rows = [[{ text: "🔙 بازگشت", callback_data: "back:genres" }]];
  for (const m of items) {
    rows.push([
      { text: shortenText(m.title || "بدون عنوان", 60), callback_data: `m:${m.id}` },
    ]);
  }
  if (hasMore) {
    rows.push([
      {
        text: "⏭ ۱۰ فیلم بعدی",
        callback_data: `genre:${genreIndex}:${offset + LIST_PAGE_SIZE}`,
      },
    ]);
  }

  const text = items.length
    ? `🎭 ژانر: ${genre.name}`
    : `🎭 ژانر: ${genre.name}\nفیلمی پیدا نشد`;

  return { text, keyboard: { inline_keyboard: rows } };
}

// ===================================================
// /start
// ===================================================

bot.start(async (ctx) => {
  const payload = ctx.startPayload || "";

  try {
    await upsertSubscriber(ctx.chat, "start");

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

    ctx.reply(WELCOME_TEXT, { reply_markup: MAIN_MENU_REPLY_MARKUP });

  } catch (e) {
    console.error("START ERROR:", e.message);
  }
});

// ===================================================
// دکمه‌های منوی اصلی (متن‌های ثابت روی کیبورد پایین چت)
// ===================================================

bot.hears(BTN_NEWEST, async (ctx) => {
  if (ctx.chat.type !== "private") return;

  try {
    await upsertSubscriber(ctx.chat, "menu_newest");

    const movies = await fetchNewestMovies();
    if (!movies.length) {
      return ctx.reply("❌ فیلمی پیدا نشد");
    }

    await ctx.reply("🆕 جدیدترین‌ها:", {
      reply_markup: movieListKeyboard(movies),
    });
  } catch (err) {
    console.error("NEWEST MENU ERROR:", err.message);
  }
});

bot.hears(BTN_POPULAR, async (ctx) => {
  if (ctx.chat.type !== "private") return;

  try {
    await upsertSubscriber(ctx.chat, "menu_popular");

    const movies = await fetchPopularMoviesList();
    if (!movies.length) {
      return ctx.reply("❌ فیلمی پیدا نشد");
    }

    await ctx.reply("🔥 پردانلودترین‌ها:", {
      reply_markup: movieListKeyboard(movies),
    });
  } catch (err) {
    console.error("POPULAR MENU ERROR:", err.message);
  }
});

bot.hears(BTN_GENRES, async (ctx) => {
  if (ctx.chat.type !== "private") return;

  try {
    await upsertSubscriber(ctx.chat, "menu_genres");

    const { genres, keyboard } = await buildGenresKeyboard();
    if (!genres.length) {
      return ctx.reply("❌ ژانری پیدا نشد");
    }

    await ctx.reply("🎭 ژانر مورد نظر را انتخاب کنید:", {
      reply_markup: keyboard,
    });
  } catch (err) {
    console.error("GENRES MENU ERROR:", err.message);
  }
});

// ===================================================
// دکمه‌های شیشه‌ای (callback_query) لیست‌های فیلم و ژانر
// ===================================================

bot.action(/^m:(\d+)$/, async (ctx) => {
  try {
    const id = Number(ctx.match[1]);

    const { data: movie, error } = await supabase
      .from("movies")
      .select("id, title, cover, link")
      .eq("id", id)
      .single();

    await ctx.answerCbQuery();

    if (error || !movie) {
      return ctx.reply("❌ فیلم پیدا نشد");
    }

    const payload = buildForwardPayloadFromChannelLink(movie.link);
    if (!payload) {
      return ctx.reply("❌ لینک این فیلم نامعتبر است");
    }

    await ctx.replyWithPhoto(movie.cover || undefined, {
      caption: `🎬 ${movie.title}`,
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
  } catch (err) {
    console.error("MOVIE BUTTON ERROR:", err.message);
  }
});

bot.action("back:menu", async (ctx) => {
  try {
    await ctx.answerCbQuery();
    await ctx.deleteMessage();
  } catch (err) {
    // پیام قدیمی‌تر از حد مجاز حذف ممکن است شکست بخورد؛ مشکلی نیست
  }
});

bot.action("back:genres", async (ctx) => {
  try {
    await ctx.answerCbQuery();

    const { genres, keyboard } = await buildGenresKeyboard();
    if (!genres.length) {
      return ctx.reply("❌ ژانری پیدا نشد");
    }

    await ctx.editMessageText("🎭 ژانر مورد نظر را انتخاب کنید:", {
      reply_markup: keyboard,
    });
  } catch (err) {
    console.error("BACK GENRES ERROR:", err.message);
  }
});

bot.action(/^genre:(\d+):(\d+)$/, async (ctx) => {
  try {
    await ctx.answerCbQuery();

    const genreIndex = Number(ctx.match[1]);
    const offset = Number(ctx.match[2]);

    const view = await buildGenreMoviesView(genreIndex, offset);
    if (!view) {
      return ctx.reply("❌ لطفاً دوباره روی «ژانر‌ها» بزنید");
    }

    await ctx.editMessageText(view.text, { reply_markup: view.keyboard });
  } catch (err) {
    console.error("GENRE PAGE ERROR:", err.message);
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

  await upsertSubscriber(ctx.chat, "text");

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

bot.on("my_chat_member", async (ctx) => {
  try {
    await upsertSubscriber(ctx.chat, "my_chat_member");
  } catch (err) {
    console.error("MY_CHAT_MEMBER ERROR:", err.message);
  }
});

bot.on("message", async (ctx, next) => {
  if (!ctx.message) return next();

  if (["group", "supergroup", "private"].includes(ctx.chat?.type)) {
    await upsertSubscriber(ctx.chat, "message");
  }

  return next();
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

bot.telegram
  .getMe()
  .then(async (me) => {
    botUsername = me?.username || BOT_USERNAME;
    await bootstrapNotificationCursor();
    setInterval(checkAndNotifyNewMovie, MOVIE_POLL_INTERVAL_MS);
  })
  .catch((err) => {
    console.error("BOT INIT ERROR:", err.message);
  });


const port = Number(process.env.PORT || 0);
if (port > 0) {
  http
    .createServer((req, res) => {
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
      res.end("filmchiin-bot alive");
    })
    .listen(port, () => {
      console.log(`HTTP KEEPALIVE LISTENING ON ${port}`);
    });
}

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
