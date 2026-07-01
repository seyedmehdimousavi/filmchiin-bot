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
    BTN_HELP:      "🆘 راهنما",

    WELCOME:
      "🎬 به فیلم‌چین خوش آمدید! 🍿\n" +
      "🔍 برای جست‌وجو، نام فیلم را ارسال کنید یا از دکمه‌های زیر استفاده کنید 👇",

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
    DONATE_OPEN_TONKEEPER_BTN: "🔓 باز کردن در تون‌کیپر",

    LANG_CHANGED: "✅ زبان به فارسی تغییر کرد",

    ENTER_EMAIL:    "👤 لطفاً نام کاربری (ایمیل) خود را وارد کنید:",
    ENTER_PASSWORD: "🔑 رمز عبور خود را وارد کنید:",
    BLOCKED:        "🚫 این حساب کاربری مسدود شده است.",
    LOGIN_ERROR:    "❌ نام کاربری یا رمز عبور اشتباه است. دوباره تلاش کنید.\n\nروی «👤 حساب کاربری» بزنید.",
    LOGIN_ID_ERROR: "❌ خطا در ورود. لطفاً دوباره تلاش کنید.",
    LOGIN_OK:       (u) => `✅ ورود موفقیت‌آمیز!\n\n👤 خوش آمدید، ${u}\n\nاکنون می‌توانید از «❤️ فیلم‌های مورد علاقه» استفاده کنید.`,
    ACCOUNT_INFO:   (u) => `**نام کاربری:**\n${u}\n\n\nجهت خروج از حساب کاربری روی\n/logout\nکلیک کنید.`,
    LOGOUT_OK:      "✅ با موفقیت از حساب کاربری خارج شدید.",
    BTN_ACCOUNT_LOGGED: (u) => `👤 حساب کاربری ✅ (${u})`,
    CHANNEL_BTN:    "📢 Channel",

    LOGIN_REQUIRED:
      "⚠️ برای مشاهده فیلم‌های مورد علاقه ابتدا وارد حساب کاربری خود شوید.\n\nروی دکمه «👤 حساب کاربری» بزنید.",
    FAVS_EMPTY:   "❤️ هنوز هیچ فیلمی به مورد علاقه‌ها اضافه نکرده‌اید.",
    FAVS_ERROR:   "❌ خطا در دریافت فیلم‌های مورد علاقه",
    FAVS_TITLE:   (n) => `❤️ فیلم‌های مورد علاقه شما (${n} فیلم):`,
    GET_FILE:     "📥 دریافت فایل",
    GO_TO_FILE:   "▶️ Go to file",
    GET_ALL_EPISODES: "📥 دریافت همه اپیزودها",
    EPISODES_TITLE: (title) => `📺 اپیزودهای ${title}:`,
    EPISODE_LABEL: (n, title) => `قسمت ${n}: ${title}`,
    NO_EPISODES: "❌ اپیزودی پیدا نشد",
    ADMIN_ONLY_LANGUAGE: "⛔ فقط ادمین گروه می‌تواند زبان ربات را تغییر دهد.",

    HELP_TEXT: (botUsername) =>
      "🆘 *راهنمای فیلم‌چین*\n\n" +
      "می‌تونی از دکمه‌های کیبورد پایین صفحه استفاده کنی یا همون کار رو با دستورات زیر انجام بدی 👇\n\n" +
      "👤 /Account — مشاهده یا ورود به حساب کاربری\n" +
      "🚪 /logout — خروج از حساب کاربری\n" +
      "🎭 /Genres — مرور فیلم‌ها بر اساس ژانر\n" +
      "🆕 /Newest — جدیدترین فیلم‌ها و سریال‌ها\n" +
      "🔥 /Popular — پردانلودترین‌ها\n" +
      "❤️ /Favorites — فیلم‌های مورد علاقه‌ات (نیاز به ورود به حساب)\n" +
      "📞 /contact — ارتباط با پشتیبانی\n" +
      "💙 /donate — حمایت از فیلم‌چین\n" +
      "🌐 /language — تغییر زبان ربات (فارسی/English)\n" +
      "🔄 /start — شروع دوباره ربات\n" +
      "🆘 /help — نمایش همین راهنما\n\n" +
      "🔎 *جست‌وجوی مستقیم*\n" +
      "کافیه اسم فیلم یا سریال مورد نظرت رو، نام بازیگر یا بخشی از توضیحات فیلم رو مستقیم ارسال کنی تا داخل دیتابیس جست‌وجو کنم.\n\n" +
      "⚡️ *جست‌وجوی اینلاین (داخل هر چت)*\n" +
      `توی هر چتی (حتی توی چت با دوستات) بنویس\n\`@${botUsername} نام فیلم\`\nو چند لحظه صبر کن؛ یه لیست از نتایج بهت نشون داده می‌شه و با زدن روی هر نتیجه، اون فیلم با دکمه‌ی دریافت فایل، برای همه قابل مشاهده و دریافت خواهد بود. (حداقل ۲ حرف وارد کن)\n\n` +
      "👥 *کار کردن داخل گروه*\n" +
      "اگه ربات رو به یه گروه اضافه کنی، داخل گروه کیبورد دکمه‌ای نشون داده نمی‌شه و فقط با دستورات «/» کار می‌کنی:\n" +
      "🔸 با دستور\n`/search نام فیلم`\nیا با ارسال\n`/search`\nدر ریپلای روی پیامی (که اسم فیلم توشه)، داخل گروه جست‌وجو کن.\n" +
      "🔸 دستورات /Genres، /Newest، /Popular، /contact، /donate و /help هم داخل گروه دقیقاً همون پاسخ چت خصوصی رو می‌دن.\n" +
      "🔸 تغییر زبان (/language) داخل گروه فقط در اختیار ادمین‌های گروهه.\n\n" +
      "برای هر نتیجه‌ی جست‌وجو یه عکس کاور + دکمه‌ی «دریافت این قسمت» فرستاده می‌شه؛ با زدن روی دکمه، فایل همون لحظه داخل خود گروه برای همه ارسال می‌شه (بدون نیاز به رفتن به چت خصوصی ربات). اگر نتیجه یک کالکشن یا سریال باشه، دکمه‌ی «📥 دریافت همه اپیزودها» هم زیرش نشون داده می‌شه که اون هم مستقیم داخل گروه فایل‌ها رو می‌فرسته.",
  },

  en: {
    BTN_ACCOUNT:   "👤 Account",
    BTN_NEWEST:    "🆕 Newest",
    BTN_POPULAR:   "🔥 Most Popular",
    BTN_GENRES:    "🎭 Genres",
    BTN_FAVORITES: "❤️ Favorites",
    BTN_SUPPORT:   "📞 contact us",
    BTN_DONATE:    "💙 Support Us",
    BTN_LANGUAGE:  "🌐 زبان / Language",
    BTN_HELP:      "🆘 Help",

    WELCOME:
      "🎬 Welcome to FilmChiin! 🍿\n" +
      "🔍 Send a movie name to search, or use the buttons below 👇",

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

    SUPPORT_TEXT: "📞 Contact us via the ID below:",
    SUPPORT_BTN:  "💬 Contact Admin",

    DONATE_MSG:
      "Small contributions make big changes\n\n" +
      "*GRAM (ex TON):*",
    DONATE_ADDR: "UQAqP9Q7Hv27xSFmxonhp9wbV6_vBzOwmMPahEqaz9omq1FT",
    DONATE_OPEN_TONKEEPER_BTN: "🔓 Open in Tonkeeper",

    LANG_CHANGED: "✅ Language changed to English",

    ENTER_EMAIL:    "👤 Please enter your username (email):",
    ENTER_PASSWORD: "🔑 Enter your password:",
    BLOCKED:        "🚫 This account has been blocked.",
    LOGIN_ERROR:    "❌ Wrong username or password. Please try again.\n\nTap «👤 Account».",
    LOGIN_ID_ERROR: "❌ Login error. Please try again.",
    LOGIN_OK:       (u) => `✅ Login successful!\n\n👤 Welcome, ${u}\n\nYou can now use «❤️ Favorites».`,
    ACCOUNT_INFO:   (u) => `**Username:**\n${u}\n\n\nTo log out, tap\n/logout`,
    LOGOUT_OK:      "✅ You have been successfully logged out.",
    BTN_ACCOUNT_LOGGED: (u) => `👤 Account ✅ (${u})`,
    CHANNEL_BTN:    "📢 Channel",

    LOGIN_REQUIRED:
      "⚠️ Please log in first to view your favorites.\n\nTap the «👤 Account» button.",
    FAVS_EMPTY:   "❤️ You haven't added any favorites yet.",
    FAVS_ERROR:   "❌ Error fetching favorites",
    FAVS_TITLE:   (n) => `❤️ Your favorites (${n} movies):`,
    GET_FILE:     "📥 Get File",
    GO_TO_FILE:   "▶️ Go to file",
    GET_ALL_EPISODES: "📥 Get all episodes",
    EPISODES_TITLE: (title) => `📺 ${title} episodes:`,
    EPISODE_LABEL: (n, title) => `Episode ${n}: ${title}`,
    NO_EPISODES: "❌ No episodes found",
    ADMIN_ONLY_LANGUAGE: "⛔ Only a group admin can change the bot's language.",

    HELP_TEXT: (botUsername) =>
      "🆘 *FilmChiin Help*\n\n" +
      "You can use the keyboard buttons below, or do the exact same thing with these commands 👇\n\n" +
      "👤 /Account — view or log in to your account\n" +
      "🚪 /logout — log out of your account\n" +
      "🎭 /Genres — browse movies by genre\n" +
      "🆕 /Newest — newest movies and series\n" +
      "🔥 /Popular — most downloaded\n" +
      "❤️ /Favorites — your favorite movies (login required)\n" +
      "📞 /contact — contact support\n" +
      "💙 /donate — support FilmChiin\n" +
      "🌐 /language — switch bot language (فارسی/English)\n" +
      "🔄 /start — restart the bot\n" +
      "🆘 /help — show this help message\n\n" +
      "🔎 *Direct search*\n" +
      "Just send the movie/series name, an actor's name, or part of a movie's description, and I'll search the database for it.\n\n" +
      "⚡️ *Inline search (in any chat)*\n" +
      `In any chat (even with friends), type\n\`@${botUsername} movie name\`\nand wait a moment; a list of results will show up, and tapping any result sends that movie with a download button, visible and downloadable by everyone in the chat. (minimum 2 characters)\n\n` +
      "👥 *Using the bot in a group*\n" +
      "If you add the bot to a group, no keyboard buttons are shown there — everything works only through «/» commands:\n" +
      "🔸 Use\n`/search movie name`\nor send\n`/search`\nas a reply to a message containing the movie name, to search inside the group.\n" +
      "🔸 /Genres, /Newest, /Popular, /contact, /donate and /help also give the exact same answer inside the group as in private chat.\n" +
      "🔸 Changing the language (/language) inside a group is only available to group admins.\n\n" +
      "Each search result is sent with a cover photo and a “Get this episode” button; tapping the button sends the file right there in the group instantly (no need to open the bot's private chat). If the result is a collection or series, a “📥 Get all episodes” button is shown too, which also sends the files directly inside the group.",
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

function buildMainMenuMarkup(lang, session) {
  const accountBtn = session
    ? t(lang, "BTN_ACCOUNT_LOGGED", session.username)
    : t(lang, "BTN_ACCOUNT");

  return {
    keyboard: [
      [accountBtn],
      [t(lang, "BTN_GENRES"), t(lang, "BTN_NEWEST"), t(lang, "BTN_POPULAR")],
      [t(lang, "BTN_FAVORITES")],
      [t(lang, "BTN_SUPPORT"), t(lang, "BTN_DONATE")],
      [t(lang, "BTN_LANGUAGE"), t(lang, "BTN_HELP")],
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

function isEnglishToken(token) {
  const clean = token.startsWith("#") ? token.slice(1) : token;
  return clean.length > 1 && /^[A-Za-z]/.test(clean);
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


function parseForwardPayload(payload) {
  const parts = (payload || "").split("_");
  if (parts.length !== 3 || parts[0] !== "forward") return null;
  return {
    from_chat_id: /^\d+$/.test(parts[1]) ? `-100${parts[1]}` : `@${parts[1]}`,
    message_id: Number(parts[2]),
  };
}

async function copyPayloadMessage(token, chatId, payload) {
  const parsed = parseForwardPayload(payload);
  if (!parsed) return null;
  return tgCall(token, "copyMessage", {
    chat_id: chatId,
    from_chat_id: parsed.from_chat_id,
    message_id: parsed.message_id,
  });
}

function normalizeMovieType(row) {
  const raw = String(row?.type || row?.movie_type || row?.content_type || "").toLowerCase().trim();
  if (/collection|کالکشن|مجموعه/.test(raw)) return "collection";
  if (/serial|series|سریال/.test(raw)) return "series";
  return "movie";
}

function movieTitleWithType(row, lang) {
  const title = shortenText(row?.title || t(lang, "NO_TITLE"), 56);
  const type = normalizeMovieType(row);
  if (type === "collection") return `${title} 🔹`;
  if (type === "series") return `${title} 🔸`;
  return title;
}

async function selectMovies(supabase, configure, limit = LIST_PAGE_SIZE) {
  const selects = [
    "id, title, link, type, movie_type, content_type, product",
    "id, title, link, type, product",
    "id, title, link, product",
    "id, title, link",
  ];
  for (const columns of selects) {
    const query = configure(supabase.from("movies").select(columns)).limit(limit);
    const { data, error } = await query;
    if (!error) return { data: (data || []).map(m => ({ ...m, _src: "movies" })), error: null };
    if (!/column|schema cache|Could not find/i.test(error.message || "")) return { data: [], error };
  }
  return { data: [], error: new Error("Unable to select movies") };
}

async function fetchMovieById(supabase, id) {
  const { data } = await selectMovies(supabase, q => q.eq("id", id), 1);
  return data?.[0] || null;
}

async function fetchMoviesByIds(supabase, ids) {
  if (!ids.length) return [];
  const { data, error } = await selectMovies(supabase, q => q.in("id", ids), Math.max(ids.length, 1));
  if (error) { console.error("MOVIES BY IDS:", error.message); return []; }
  return data || [];
}

async function fetchMovieEpisodes(supabase, movieId) {
  const movie = await fetchMovieById(supabase, movieId);
  if (!movie) return [];
  const episodes = [{ ...movie, _episodeIndex: 1, _src: "movies" }];
  // واکشی اپیزودهای بعدی از movie_items
  const { data, error } = await supabase
    .from("movie_items")
    .select("id, title, link, movie_id, created_at")
    .eq("movie_id", String(movieId))
    .order("id", { ascending: true });
  if (!error && data?.length) {
    return episodes.concat(data.map((item, index) => ({ ...item, _episodeIndex: index + 2, _src: "movie_items" })));
  }
  // fallback: تلاش با ستون‌های دیگر
  const relationColumns = ["movie_id", "movieId", "parent_id", "parentId"];
  const itemSelects = [
    "id, title, link, movie_id, created_at, episode_number",
    "id, title, link, movie_id, created_at",
    "id, title, link, created_at",
  ];
  for (const rel of relationColumns) {
    if (rel === "movie_id") continue; // قبلاً امتحان شد
    for (const columns of itemSelects) {
      const { data: d2, error: e2 } = await supabase
        .from("movie_items")
        .select(columns)
        .eq(rel, String(movieId))
        .order("created_at", { ascending: true, nullsFirst: false });
      if (!e2) {
        return episodes.concat((d2 || []).map((item, index) => ({ ...item, _episodeIndex: index + 2, _src: "movie_items" })));
      }
      if (!/column|schema cache|Could not find/i.test(e2.message || "")) break;
    }
  }
  return episodes;
}

function episodeKeyboard(episodes, movieId, lang, botUsername, isGroup = false) {
  const rows = [[{ text: t(lang, "BACK"), callback_data: "back:menu" }]];
  for (const episode of episodes) {
    const payload = buildForwardPayloadFromChannelLink(episode.link);
    if (!payload) continue;
    let label;
    if (episode._episodeIndex === 1) {
      // دکمه اول: اسم خود کالکشن/سریال
      label = shortenText(episode.title || t(lang, "NO_TITLE"), 56);
    } else {
      label = t(lang, "EPISODE_LABEL", episode._episodeIndex, shortenText(episode.title || t(lang, "NO_TITLE"), 40));
    }
    if (isGroup) {
      // داخل گروه: دکمه مستقیم فایل رو همونجا می‌فرسته (بدون رفتن به PV ربات)
      const prefix = episode._src === "movie_items" ? "mi" : "m";
      rows.push([{ text: label, callback_data: `${prefix}:${episode.id}` }]);
    } else {
      rows.push([{ text: label, url: `https://t.me/${botUsername}?start=${payload}` }]);
    }
  }
  rows.push([{ text: t(lang, "GET_ALL_EPISODES"), callback_data: `all:m:${movieId}` }]);
  return { inline_keyboard: rows };
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
  const { data, error } = await selectMovies(supabase, q => q.order("updated_at", { ascending: false, nullsFirst: false }).order("created_at", { ascending: false }), limit);
  if (error) { console.error("NEWEST MOVIES:", error.message); return []; }
  return data || [];
}

async function fetchPopularMoviesList(supabase, limit = POPULAR_LIST_LIMIT) {
  const { data, error } = await selectMovies(supabase, q => q.eq("is_popular", true).order("created_at", { ascending: false }), limit);
  if (error) { console.error("POPULAR MOVIES:", error.message); return []; }
  return data || [];
}

async function fetchMoviesByGenre(supabase, genreName, offset = 0, limit = LIST_PAGE_SIZE) {
  const pattern = `%${genreName}%`;
  const { data, error } = await selectMovies(supabase, q => q.ilike("genre", pattern).order("updated_at", { ascending: false, nullsFirst: false }).order("created_at", { ascending: false }).range(offset, offset + limit), limit + 1);
  if (error) { console.error("GENRE MOVIES:", error.message); return { items: [], hasMore: false }; }
  const rows = data || [];
  return { items: rows.slice(0, limit), hasMore: rows.length > limit };
}

async function getGenreList(supabase, kv, lang) {
  const cacheKey = `genre_cache_${lang || "fa"}`;
  if (kv) {
    try {
      const cached = await kv.get(cacheKey, "json");
      if (cached) return cached;
    } catch {}
  }
  const { data, error } = await supabase.from("movies").select("genre");
  if (error) { console.error("GENRE LIST:", error.message); return []; }
  const counts = {};
  const isTarget = lang === "en" ? isEnglishToken : isPersianToken;
  for (const row of data || []) {
    if (!row.genre) continue;
    for (const raw of row.genre.split(" ")) {
      const name = raw.trim();
      if (!name || !isTarget(name)) continue;
      counts[name] = (counts[name] || 0) + 1;
    }
  }
  const genres = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, GENRE_LIST_LIMIT)
    .map(([name, count]) => ({ name, count }));
  if (kv) {
    try { await kv.put(cacheKey, JSON.stringify(genres), { expirationTtl: 600 }); } catch {}
  }
  return genres;
}

// ===================================================
// Keyboard Builders (با پشتیبانی زبان)
// ===================================================

function movieListKeyboard(movies, lang, botUsername = "Filmchinbot", isGroup = false) {
  const rows = [[{ text: t(lang, "BACK"), callback_data: "back:menu" }]];
  for (const m of movies) {
    const text = movieTitleWithType(m, lang);
    const movieType = normalizeMovieType(m);
    if (movieType === "collection" || movieType === "series") {
      rows.push([{ text, callback_data: `eps:m:${m.id}` }]);
      continue;
    }
    if (isGroup) {
      rows.push([{ text, callback_data: `m:${m.id}` }]);
      continue;
    }
    const payload = buildForwardPayloadFromChannelLink(m.link);
    if (payload) rows.push([{ text, url: `https://t.me/${botUsername}?start=${payload}` }]);
  }
  return { inline_keyboard: rows };
}

async function buildGenresKeyboard(supabase, kv, lang) {
  const genres = await getGenreList(supabase, kv, lang);
  const rows   = [[{ text: t(lang, "BACK"), callback_data: "back:menu" }]];
  for (let i = 0; i < genres.length; i += 2) {
    const row = [{ text: `${genres[i].name} (${genres[i].count})`, callback_data: `genre:${i}:0` }];
    if (genres[i + 1]) row.push({ text: `${genres[i + 1].name} (${genres[i + 1].count})`, callback_data: `genre:${i + 1}:0` });
    rows.push(row);
  }
  return { genres, keyboard: { inline_keyboard: rows } };
}

async function buildGenreMoviesView(supabase, kv, genreIndex, offset, lang, envBotUsername = "Filmchinbot", isGroup = false) {
  const genres = await getGenreList(supabase, kv, lang);
  const genre  = genres[genreIndex];
  if (!genre) return null;
  const { items, hasMore } = await fetchMoviesByGenre(supabase, genre.name, offset);
  const rows = [[{ text: t(lang, "BACK"), callback_data: "back:genres" }]];
  for (const m of items) {
    const text = movieTitleWithType(m, lang);
    const movieType = normalizeMovieType(m);
    if (movieType === "collection" || movieType === "series") {
      rows.push([{ text, callback_data: `eps:m:${m.id}` }]);
      continue;
    }
    if (isGroup) {
      rows.push([{ text, callback_data: `m:${m.id}` }]);
      continue;
    }
    const payload = buildForwardPayloadFromChannelLink(m.link);
    if (payload) rows.push([{ text, url: `https://t.me/${envBotUsername || "Filmchinbot"}?start=${payload}` }]);
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
// جستجوی یکپارچه - مشترک بین هر سه روش سرچ
// هر آیتمی که match بشه (چه movies چه movie_items) مستقیم برگردونده می‌شه
// عین رفتار inline query
// ===================================================

async function searchAllSources(supabase, queryText, limit = 15) {
  const search = buildSearchConfig(queryText);
  const [moviesRes, itemsRes] = await Promise.all([
    applySearch(
      supabase.from("movies").select("id, title, cover, link, synopsis, stars, director, genre, product, type").limit(limit),
      search
    ),
    applySearch(
      supabase.from("movie_items").select("id, title, cover, link, synopsis, stars, director, genre, product, movie_id").limit(limit),
      search
    ),
  ]);

  if (moviesRes.error) console.error("SEARCH movies error:", moviesRes.error.message);
  if (itemsRes.error) console.error("SEARCH movie_items error:", itemsRes.error.message);

  const moviesRaw = moviesRes.data || [];
  const itemsRaw  = itemsRes.data  || [];

  console.log(`SEARCH "${queryText}": movies=${moviesRaw.length}, items=${itemsRaw.length}`);

  // ترکیب و dedup با کلید title+link (عین inline)
  const seenKey = new Set();
  const results = [];
  for (const m of [...moviesRaw, ...itemsRaw]) {
    const key = `${m.title}||${m.link}`;
    if (!seenKey.has(key)) {
      seenKey.add(key);
      results.push(m);
    }
  }
  return results;
}

// کم کردن حجم کاور از طریق wsrv.nl (رایگان، بدون نیاز به پلن خاص)
// عرض 400px و فرمت webp → معمولاً زیر 50KB
function resizeCoverUrl(url) {
  if (!url || url === "#") return null;
  // اگه data: URL یا فایل local بود دست نزن
  if (url.startsWith("data:") || url.startsWith("/")) return url;
  try {
    // wsrv.nl: CDN رایگان برای resize تصویر
    return `https://wsrv.nl/?url=${encodeURIComponent(url)}&w=400&output=webp&q=75`;
  } catch {
    return url;
  }
}

// ساخت caption نتیجه‌ی جستجو برای گروه: عنوان + خلاصه داستان (بدون لینک دستوری؛
// دکمه‌های زیر پیام مستقیماً فایل رو همونجا می‌فرستن)
function buildGroupResultCaption(title, synopsis) {
  let caption = `🎬 ${title}`;
  const shortSynopsis = shortenText(synopsis, 600);
  if (shortSynopsis) caption += `\n\n${shortSynopsis}`;
  return caption;
}

// ارسال یک نتیجه جستجو به صورت پیام - منطق عین inline query
// isGroup: اگه true باشه caption شامل خلاصه داستان هم می‌شه و دکمه‌های فایل/همه‌اپیزودها
// به‌جای لینک رفتن به PV ربات، با callback_data مستقیم همون‌جا تو گروه فایل رو می‌فرستن
async function sendSearchResult(token, chatId, m, lang, botUsername, sendSecret, isGroup) {
  const coverRaw    = normalizeCover(m.cover);
  const coverSmall  = resizeCoverUrl(coverRaw);

  // helper: sendPhoto که اگه Telegram خطا برگردوند throw کنه
  // اول با کاور کوچک‌شده تلاش می‌کنه، اگه fail شد با URL اصلی
  async function tryPhoto(body) {
    if (coverSmall && coverSmall !== coverRaw) {
      const r1 = await tgCall(token, "sendPhoto", { ...body, photo: coverSmall });
      if (r1?.ok) return;
    }
    const r2 = await tgCall(token, "sendPhoto", { ...body, photo: coverRaw });
    if (!r2?.ok) throw new Error(r2?.description || "sendPhoto failed");
  }

  async function deliver(caption, kb) {
    if (coverRaw) {
      try { await tryPhoto({ chat_id: chatId, caption, reply_markup: kb }); return; } catch {}
    }
    await tgCall(token, "sendMessage", { chat_id: chatId, text: caption, reply_markup: kb });
  }

  // آیتمی که از movie_items آمده (اپیزود یک کالکشن/سریال)
  if (m.movie_id) {
    const payload = buildForwardPayloadFromChannelLink(m.link);
    if (!payload) return;
    const fileBtn = isGroup
      ? { text: lang === "en" ? "▶️ Get this episode" : "▶️ دریافت این قسمت", callback_data: `mi:${m.id}` }
      : { text: lang === "en" ? "▶️ Get this episode" : "▶️ دریافت این قسمت", url: `https://t.me/${botUsername}?start=${payload}` };
    const kb = {
      inline_keyboard: [
        [fileBtn],
        [{ text: lang === "en" ? "📺 Other episodes" : "📺 بقیه قسمت‌های این کالکشن", callback_data: `eps:m:${m.movie_id}` }],
      ],
    };
    if (!isGroup) return deliver(`🎬 ${m.title}`, kb);
    return deliver(buildGroupResultCaption(m.title, m.synopsis), kb);
  }

  // آیتم از movies - ممکنه تک‌فیلم، کالکشن، یا سریال باشه
  const movieType = normalizeMovieType(m);

  if (movieType === "collection") {
    // کالکشن: دکمه دریافت اپیزود اول + دکمه مشاهده همه اپیزودها (+ داخل گروه: دکمه دریافت همه)
    const payload = buildForwardPayloadFromChannelLink(m.link);
    const rows = [];
    if (payload) {
      const fileBtn = isGroup
        ? { text: lang === "en" ? "▶️ Get this episode" : "▶️ دریافت این قسمت", callback_data: `m:${m.id}` }
        : { text: lang === "en" ? "▶️ Get this episode" : "▶️ دریافت این قسمت", url: `https://t.me/${botUsername}?start=${payload}` };
      rows.push([fileBtn]);
    }
    rows.push([{ text: lang === "en" ? "📺 View Episodes" : "📺 مشاهده اپیزودها", callback_data: `eps:m:${m.id}` }]);
    if (isGroup) rows.push([{ text: t(lang, "GET_ALL_EPISODES"), callback_data: `all:m:${m.id}` }]);
    const kb = { inline_keyboard: rows };
    if (!isGroup) return deliver(`🎬 ${m.title}`, kb);
    return deliver(buildGroupResultCaption(m.title, m.synopsis), kb);
  }

  if (movieType === "series") {
    // سریال: دکمه مشاهده اپیزودها (+ داخل گروه: دکمه دریافت همه)
    const rows = [[
      { text: lang === "en" ? "📺 View Episodes" : "📺 مشاهده اپیزودها", callback_data: `eps:m:${m.id}` },
    ]];
    if (isGroup) rows.push([{ text: t(lang, "GET_ALL_EPISODES"), callback_data: `all:m:${m.id}` }]);
    const kb = { inline_keyboard: rows };
    if (!isGroup) return deliver(`🎬 ${m.title}`, kb);
    return deliver(buildGroupResultCaption(m.title, m.synopsis), kb);
  }

  // تک‌فیلم معمولی
  const payload = buildForwardPayloadFromChannelLink(m.link);
  if (!payload) return;
  const goBtn = isGroup
    ? { text: "▶️ Go to file", callback_data: `m:${m.id}` }
    : { text: "▶️ Go to file", url: `https://t.me/${botUsername}?start=${payload}` };
  const kb = { inline_keyboard: [[goBtn]] };
  if (!isGroup) return deliver(`🎬 ${m.title}`, kb);
  return deliver(buildGroupResultCaption(m.title, m.synopsis), kb);
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
    const isGroupCb = ["group", "supergroup"].includes(chat?.type);

    await answer(cbq.id);

    const epsMatch = data.match(/^eps:m:(\S+)$/);
    if (epsMatch) {
      const movieId = epsMatch[1];
      const movie = await fetchMovieById(supabase, movieId);
      if (!movie) return send(chat.id, t(lang, "MOVIE_NOT_FOUND"));
      const episodes = await fetchMovieEpisodes(supabase, movieId);
      const kb = episodeKeyboard(episodes, movieId, lang, BOT_USERNAME, isGroupCb);
      const titleText = t(lang, "EPISODES_TITLE", movie.title || t(lang, "NO_TITLE"));
      const coverRaw   = normalizeCover(movie.cover);
      const coverSmall = resizeCoverUrl(coverRaw);

      // اگه پیام قبلی photo داشت، caption رو ویرایش کن
      const prevMsg = cbq.message;
      if (prevMsg?.photo?.length) {
        try {
          return await tgCall(BOT_TOKEN, "editMessageCaption", {
            chat_id: chat.id,
            message_id: msgId,
            caption: titleText,
            reply_markup: kb,
          });
        } catch {}
      }

      // اگه پیام قبلی text بود ولی کاور داریم، پیام قدیمی رو حذف و پیام جدید با عکس بفرست
      if (coverRaw) {
        try { await tgCall(BOT_TOKEN, "deleteMessage", { chat_id: chat.id, message_id: msgId }); } catch {}
        // اول resize شده، بعد اصلی
        for (const photo of [coverSmall, coverRaw].filter(Boolean)) {
          const r = await tgCall(BOT_TOKEN, "sendPhoto", { chat_id: chat.id, photo, caption: titleText, reply_markup: kb });
          if (r?.ok) return;
        }
      }

      // fallback: ویرایش متنی
      return edit(chat.id, msgId, titleText, { reply_markup: kb });
    }

    const allMatch = data.match(/^all:m:(\S+)$/);
    if (allMatch) {
      const movieId = allMatch[1];
      const episodes = await fetchMovieEpisodes(supabase, movieId);
      if (!episodes.length) return send(chat.id, t(lang, "NO_EPISODES"));
      let sentCount = 0;
      for (const episode of episodes) {
        const payload = buildForwardPayloadFromChannelLink(episode.link);
        if (!payload) {
          console.warn(`ALL_EPISODES: no payload for episode idx=${episode._episodeIndex} src=${episode._src} id=${episode.id} link=${episode.link}`);
          continue;
        }
        const result = await copyPayloadMessage(BOT_TOKEN, chat.id, payload);
        if (result?.ok) sentCount++;
        else console.error(`ALL_EPISODES: copyMessage failed for episode idx=${episode._episodeIndex}`, result?.description);
        // تاخیر کوتاه بین ارسال‌ها تا flood control تلگرام
        await new Promise(r => setTimeout(r, 300));
      }
      if (sentCount === 0) return send(chat.id, t(lang, "NO_EPISODES"));
      return;
    }

    // m:<id>  یا  mi:<id> (movie_items)
    // توجه: movies از UUID استفاده می‌کنه (مثل df663fdd-...) و movie_items از عدد صحیح
    const mMatch = data.match(/^(m|mi):([\w-]+)$/);
    if (mMatch) {
      const table = mMatch[1] === "mi" ? "movie_items" : "movies";
      const id    = mMatch[2]; // نگه‌داشتن به‌عنوان string؛ Supabase coercion رو خودش مدیریت می‌کنه
      let movie = null;
      // اول جدول مشخص‌شده رو چک کن
      const { data: row1 } = await supabase.from(table).select("id, title, cover, link").eq("id", id).maybeSingle();
      if (row1) movie = row1;
      // اگه پیدا نشد جدول دیگه رو هم بگرد
      if (!movie) {
        const otherTable = table === "movies" ? "movie_items" : "movies";
        const { data: row2 } = await supabase.from(otherTable).select("id, title, cover, link").eq("id", id).maybeSingle();
        if (row2) movie = row2;
      }
      if (!movie) return send(chat.id, t(lang, "MOVIE_NOT_FOUND"));
      const payload = buildForwardPayloadFromChannelLink(movie.link);
      if (!payload) return send(chat.id, t(lang, "INVALID_LINK"));
      return copyPayloadMessage(BOT_TOKEN, chat.id, payload);
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
      const view = await buildGenreMoviesView(supabase, kv, genreIndex, offset, lang, BOT_USERNAME, isGroupCb);
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

    const allResults = await searchAllSources(supabase, q);
    const results = [];

    for (const m of allResults) {
      const movieType  = normalizeMovieType(m);
      const thumbUrl   = resizeCoverUrl(normalizeCover(m.cover)) || m.cover;

      // کالکشن/سریال که در movies هست
      if ((movieType === "collection" || movieType === "series") && m.id && !m.movie_id) {
        const payload = buildForwardPayloadFromChannelLink(m.link);
        const rows = [];
        if (payload) rows.push([{ text: "▶️ Go to file", url: `https://t.me/${BOT_USERNAME}?start=${payload}` }]);
        rows.push([{ text: "📺 مشاهده اپیزودها", url: `https://t.me/${BOT_USERNAME}?start=eps_${m.id}` }]);
        rows.push([{ text: t("fa", "GET_ALL_EPISODES"), url: `https://t.me/${BOT_USERNAME}?start=all_${m.id}` }]);
        results.push({
          type: "article",
          id: `res_${Math.random()}`,
          title: `${movieTitleWithType(m, "fa")}`,
          description: shortenText(m.synopsis || `${m.genre || ""} | ${m.product || ""} | ${m.stars || ""}`),
          thumb_url: thumbUrl,
          input_message_content: { message_text: `🎬 ${m.title}` },
          reply_markup: { inline_keyboard: rows },
        });
        continue;
      }

      // اپیزود از movie_items
      if (m.movie_id) {
        const payload = buildForwardPayloadFromChannelLink(m.link);
        if (!payload) continue;
        results.push({
          type: "article",
          id: `res_${Math.random()}`,
          title: m.title || t("fa", "NO_TITLE"),
          description: shortenText(m.synopsis || `${m.genre || ""} | ${m.product || ""} | ${m.stars || ""}`),
          thumb_url: thumbUrl,
          input_message_content: { message_text: `🎬 ${m.title}` },
          reply_markup: {
            inline_keyboard: [
              [{ text: "▶️ دریافت این قسمت", url: `https://t.me/${BOT_USERNAME}?start=${payload}` }],
              [{ text: "📺 بقیه قسمت‌های این کالکشن", url: `https://t.me/${BOT_USERNAME}?start=eps_${m.movie_id}` }],
              [{ text: t("fa", "GET_ALL_EPISODES"), url: `https://t.me/${BOT_USERNAME}?start=all_${m.movie_id}` }],
            ],
          },
        });
        continue;
      }

      // تک‌فیلم معمولی
      const payload = buildForwardPayloadFromChannelLink(m.link);
      if (!payload) continue;
      results.push({
        type: "article",
        id: `res_${Math.random()}`,
        title: m.title,
        description: shortenText(m.synopsis || `${m.genre || ""} | ${m.product || ""} | ${m.stars || ""}`),
        thumb_url: thumbUrl,
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
  let text     = msg.text?.trim() || "";
  const lang   = await getUserLang(kv, chatId);
  const isPrivate = chat.type === "private";

  // ===================================================
  // /start
  // ===================================================
  if (text.startsWith("/start")) {
    const payload = text.replace("/start", "").trim();

    if (payload.startsWith("forward_")) {
      const parts = payload.split("_");
      if (parseForwardPayload(payload)) {
        return copyPayloadMessage(BOT_TOKEN, chat.id, payload);
      }
      return send(chat.id, "Invalid movie link.");
    }

    // دریافت همه اپیزودهای یک کالکشن/سریال از طریق دکمه «دریافت همه اپیزودها» در سایت
    // لینک سایت به شکل: https://t.me/<bot>?start=all_<movieId> است
    if (payload.startsWith("all_")) {
      const movieId = payload.slice(4);
      const episodes = await fetchMovieEpisodes(supabase, movieId);
      if (!episodes.length) return send(chat.id, t(lang, "NO_EPISODES"));
      for (const episode of episodes) {
        const epPayload = buildForwardPayloadFromChannelLink(episode.link);
        if (epPayload) {
          await copyPayloadMessage(BOT_TOKEN, chat.id, epPayload);
          // تاخیر کوتاه بین ارسال‌ها تا flood control تلگرام
          await new Promise(r => setTimeout(r, 300));
        }
      }
      return;
    }

    // نمایش لیست اپیزودهای یک کالکشن/سریال - از نتیجه‌ی اینلاین (لینک دیپ‌لینک «مشاهده اپیزودها»)
    // لینک به شکل: https://t.me/<bot>?start=eps_<movieId> است
    if (payload.startsWith("eps_")) {
      const movieId = payload.slice(4);
      const movie = await fetchMovieById(supabase, movieId);
      if (!movie) return send(chat.id, t(lang, "MOVIE_NOT_FOUND"));
      const episodes = await fetchMovieEpisodes(supabase, movieId);
      const kb = episodeKeyboard(episodes, movieId, lang, BOT_USERNAME, false);
      const titleText  = t(lang, "EPISODES_TITLE", movie.title || t(lang, "NO_TITLE"));
      const coverRaw   = normalizeCover(movie.cover);
      if (coverRaw) {
        const coverSmall = resizeCoverUrl(coverRaw);
        for (const photo of [coverSmall, coverRaw].filter(Boolean)) {
          const r = await tgCall(BOT_TOKEN, "sendPhoto", { chat_id: chat.id, photo, caption: titleText, reply_markup: kb });
          if (r?.ok) return;
        }
      }
      return send(chat.id, titleText, { reply_markup: kb });
    }

    // داخل گروه دکمه‌ی کیبورد دائمی نشون داده نمی‌شه؛ فقط دستورات «/» کار می‌کنن
    return send(chat.id, t(lang, "WELCOME"), {
      reply_markup: isPrivate ? buildMainMenuMarkup(lang, await getSession(kv, chatId)) : { remove_keyboard: true },
    });
  }

  // ===================================================
  // Private / Group chat handlers
  // ===================================================
  let isSharedMenuCommand = false;

  if (text.startsWith("/")) {
    const cmdMatch = text.match(/^\/([a-zA-Z_]+)(@\w+)?/);
    const cmdName  = cmdMatch ? cmdMatch[1].toLowerCase() : "";

    // /logout (فقط در چت خصوصی معنی داره)
    if (isPrivate && cmdName === "logout") {
      const session = await getSession(kv, chatId);
      if (session) {
        await kv?.delete(`session:${chatId}`);
      }
      return send(chat.id, t(lang, "LOGOUT_OK"), { reply_markup: buildMainMenuMarkup(lang, null) });
    }

    // /help — هم در خصوصی و هم در گروه با همون پاسخ
    if (cmdName === "help") {
      return send(chat.id, t(lang, "HELP_TEXT", BOT_USERNAME), {
        parse_mode: "Markdown",
        reply_markup: isPrivate ? buildMainMenuMarkup(lang, await getSession(kv, chatId)) : undefined,
      });
    }

    // دستوراتی که هم در چت خصوصی و هم در گروه با همون پاسخ کار می‌کنن
    const COMMAND_TO_BUTTON_SHARED = {
      genres:   "BTN_GENRES",
      newest:   "BTN_NEWEST",
      popular:  "BTN_POPULAR",
      contact:  "BTN_SUPPORT",
      donate:   "BTN_DONATE",
      language: "BTN_LANGUAGE",
    };
    // دستوراتی که فقط در چت خصوصی معنی دارن (نیاز به ورود به حساب کاربری)
    const COMMAND_TO_BUTTON_PRIVATE_ONLY = {
      account:   "BTN_ACCOUNT",
      favorites: "BTN_FAVORITES",
    };

    if (COMMAND_TO_BUTTON_SHARED[cmdName]) {
      // متن پیام را با متن همان دکمه جایگزین می‌کنیم تا دقیقاً مسیر همان دکمه اجرا شود
      text = t(lang, COMMAND_TO_BUTTON_SHARED[cmdName]);
      isSharedMenuCommand = true;
    } else if (isPrivate && COMMAND_TO_BUTTON_PRIVATE_ONLY[cmdName]) {
      text = t(lang, COMMAND_TO_BUTTON_PRIVATE_ONLY[cmdName]);
    } else if (!isPrivate) {
      // دستور ناشناخته داخل گروه (مثلاً /search یا /send_...) — بدون return
      // تا اجرا به بخش «Group handlers» در پایین فایل برسه
    } else {
      return;
    }
  }

  if (isPrivate || isSharedMenuCommand) {

    // --- دکمه زبان (داخل گروه فقط ادمین می‌تونه تغییرش بده) ---
    if (text === i18n.fa.BTN_LANGUAGE || text === i18n.en.BTN_LANGUAGE) {
      if (!isPrivate) {
        try {
          const member = await tgCall(BOT_TOKEN, "getChatMember", { chat_id: chat.id, user_id: msg.from.id });
          const status = member?.result?.status;
          if (!["administrator", "creator"].includes(status)) {
            return send(chat.id, t(lang, "ADMIN_ONLY_LANGUAGE"));
          }
        } catch (e) {
          console.error("ADMIN CHECK ERROR:", e.message);
          return send(chat.id, t(lang, "ADMIN_ONLY_LANGUAGE"));
        }
      }
      const newLang = lang === "fa" ? "en" : "fa";
      await setUserLang(kv, chatId, newLang);
      const newSession = isPrivate ? await getSession(kv, chatId) : null;
      return send(chat.id, t(newLang, "LANG_CHANGED"), {
        reply_markup: isPrivate ? buildMainMenuMarkup(newLang, newSession) : undefined,
      });
    }

    const session  = isPrivate ? await getSession(kv, chatId) : null;
    const mainMenu = isPrivate ? buildMainMenuMarkup(lang, session) : undefined;

    // --- دکمه راهنما (فقط چت خصوصی؛ همون پاسخ /help) ---
    if (isPrivate && text === t(lang, "BTN_HELP")) {
      return send(chat.id, t(lang, "HELP_TEXT", BOT_USERNAME), {
        parse_mode: "Markdown",
        reply_markup: mainMenu,
      });
    }

    // --- حساب کاربری (فقط چت خصوصی) ---
    if (
      isPrivate &&
      (text === t(lang, "BTN_ACCOUNT") ||
      (session && text === t(lang, "BTN_ACCOUNT_LOGGED", session.username)))
    ) {
      if (session) {
        return send(chat.id, t(lang, "ACCOUNT_INFO", session.username), { parse_mode: "Markdown" });
      }
      await setLoginState(kv, chatId, { step: "username" });
      return send(chat.id, t(lang, "ENTER_EMAIL"));
    }

    // --- جدیدترین‌ها ---
    if (text === t(lang, "BTN_NEWEST")) {
      const movies = await fetchNewestMovies(supabase);
      if (!movies.length) return send(chat.id, t(lang, "NOT_FOUND"), { reply_markup: mainMenu });
      return send(chat.id, t(lang, "NEWEST_TITLE"), { reply_markup: movieListKeyboard(movies, lang, BOT_USERNAME, !isPrivate) });
    }

    // --- پردانلودترین‌ها ---
    if (text === t(lang, "BTN_POPULAR")) {
      const movies = await fetchPopularMoviesList(supabase);
      if (!movies.length) return send(chat.id, t(lang, "NOT_FOUND"), { reply_markup: mainMenu });
      return send(chat.id, t(lang, "POPULAR_TITLE"), { reply_markup: movieListKeyboard(movies, lang, BOT_USERNAME, !isPrivate) });
    }

    // --- ژانر‌ها ---
    if (text === t(lang, "BTN_GENRES")) {
      const { genres, keyboard } = await buildGenresKeyboard(supabase, kv, lang);
      if (!genres.length) return send(chat.id, t(lang, "GENRE_NOT_FOUND"), { reply_markup: mainMenu });
      return send(chat.id, t(lang, "GENRES_TITLE"), { reply_markup: keyboard });
    }

    // --- پشتیبانی ---
    if (text === t(lang, "BTN_SUPPORT")) {
      return send(chat.id, t(lang, "SUPPORT_TEXT"), {
        reply_markup: {
          inline_keyboard: [[
            { text: t(lang, "SUPPORT_BTN"), url: SUPPORT_ADMIN_URL },
            { text: t(lang, "CHANNEL_BTN"), url: "https://t.me/filmchiin" },
          ]],
        },
      });
    }

    // --- حمایت از ما ---
    if (text === t(lang, "BTN_DONATE")) {
      const donateMsg  = t(lang, "DONATE_MSG");
      const donateAddr = t(lang, "DONATE_ADDR");
      return send(chat.id, `${donateMsg}\n\`${donateAddr}\``, {
        parse_mode: "Markdown",
        reply_markup: {
          inline_keyboard: [[
            {
              text: t(lang, "DONATE_OPEN_TONKEEPER_BTN"),
              url: `https://app.tonkeeper.com/transfer/${donateAddr}`,
            },
          ]],
        },
      });
    }

    // --- علاقه‌مندی‌ها (فقط چت خصوصی) ---
    if (isPrivate && text === t(lang, "BTN_FAVORITES")) {
      if (!session) {
        return send(chat.id, t(lang, "LOGIN_REQUIRED"), { reply_markup: mainMenu });
      }
      const { data: favs, error: favErr } = await supabase
        .from("favorites")
        .select("movie_id, created_at")
        .eq("user_id", session.userId)
        .order("created_at", { ascending: false });
      if (favErr || !favs?.length) return send(chat.id, t(lang, "FAVS_EMPTY"));
      const movieIds = favs.map(f => f.movie_id);
      const movies = await fetchMoviesByIds(supabase, movieIds);
      if (!movies?.length) return send(chat.id, t(lang, "FAVS_ERROR"));
      const movieMap = new Map(movies.map(m => [String(m.id), m]));
      const ordered  = movieIds.map(id => movieMap.get(String(id))).filter(Boolean);
      return send(chat.id, t(lang, "FAVS_TITLE", ordered.length), { reply_markup: movieListKeyboard(ordered, lang, BOT_USERNAME) });
    }

    if (isPrivate) {
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
            return send(chat.id, t(lang, "LOGIN_OK", username), { reply_markup: buildMainMenuMarkup(lang, { username }) });
          } catch (err) {
            console.error("LOGIN ERROR:", err.message);
            return send(chat.id, t(lang, "LOGIN_ID_ERROR"));
          }
        }
      }

      // --- جست‌وجوی متنی (private) ---
      try {
        const results = await searchAllSources(supabase, text);
        if (!results.length) return send(chat.id, t(lang, "NOT_FOUND"), { reply_markup: mainMenu });
        for (const m of results) {
          try {
            await sendSearchResult(BOT_TOKEN, chat.id, m, lang, BOT_USERNAME, SEND_SECRET, false);
          } catch (e) {
            console.error("PRIVATE SEARCH ITEM ERROR:", e.message, JSON.stringify(m));
          }
        }
        await send(chat.id, "─────────────", { reply_markup: mainMenu });
      } catch (err) {
        console.error("PRIVATE SEARCH ERROR:", err.message);
        await send(chat.id, t(lang, "ERROR_RETRY"), { reply_markup: mainMenu });
      }
      return;
    }
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
      const results = await searchAllSources(supabase, query);
      if (!results.length) return send(chat.id, t(lang, "SEARCH_EMPTY"));
      for (const m of results) {
        try {
          await sendSearchResult(BOT_TOKEN, chat.id, m, lang, BOT_USERNAME, SEND_SECRET, true);
        } catch (e) {
          console.error("GROUP SEARCH ITEM ERROR:", e.message, JSON.stringify(m));
        }
      }
    } catch (err) {
      console.error("GROUP SEARCH ERROR:", err.message);
    }
    return;
  }

  // /send_all_<token> - ارسال همه‌ی اپیزودهای یک کالکشن/سریال داخل گروه
  if (/^\/send(@\w+)?_all_/i.test(text)) {
    const token   = text.replace(/^\/send(@\w+)?_all_/i, "").replace(/@\w+$/i, "").trim();
    const payload = decodeSendToken(token, SEND_SECRET);
    if (!payload || !payload.startsWith("all_")) return send(chat.id, t(lang, "INVALID_CMD"));
    const movieId = payload.slice(4);
    try {
      const episodes = await fetchMovieEpisodes(supabase, movieId);
      if (!episodes.length) return send(chat.id, t(lang, "NO_EPISODES"));
      for (const episode of episodes) {
        const epPayload = buildForwardPayloadFromChannelLink(episode.link);
        if (epPayload) {
          await copyPayloadMessage(BOT_TOKEN, chat.id, epPayload);
          // تاخیر کوتاه بین ارسال‌ها تا flood control تلگرام
          await new Promise(r => setTimeout(r, 300));
        }
      }
    } catch (err) {
      console.error("SEND ALL ERROR:", err.message);
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
        return copyPayloadMessage(BOT_TOKEN, chat.id, payload);
      }
      if (parts.length === 3) {
        return copyPayloadMessage(BOT_TOKEN, chat.id, payload);
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
