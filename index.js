// index.js — Telegraf + Express (Render webhook)
// npm i telegraf express dotenv

require("dotenv").config();
const express = require("express");
const { Telegraf, Markup } = require("telegraf");

const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
    throw new Error("BOT_TOKEN environment variablini qo‘ying.");
}

//
// ========== Helpers ==========
//

function normalizeChannel(input) {
    let s = String(input || "").trim();

    // -100... ko‘rinishidagi private ID bo‘lsa
    if (/^-100\d+$/.test(s)) return s;

    // tg://resolve?domain=username
    const m1 = s.match(/tg:\/\/resolve\?domain=([A-Za-z0-9_]+)/i);
    if (m1) return "@" + m1[1];

    // https://t.me/username yoki t.me/username
    const m2 = s.match(/(?:https?:\/\/)?t\.me\/([A-Za-z0-9_]+)/i);
    if (m2) return "@" + m2[1];

    // @username bo‘lsa
    if (s.startsWith("@")) return s;

    // Aks holda noto‘g‘ri
    return "";
}

function toLink(idOrUsername) {
    const s = String(idOrUsername);
    if (s.startsWith("@")) return `https://t.me/${s.slice(1)}`;
    // private ID bo‘lsa foydalanuvchiga invite-link qo‘yish kerak
    return null;
}

const CHANNELS = (process.env.CHANNELS || "")
    .split(",")
    .map(s => normalizeChannel(s))
    .filter(Boolean);

if (!CHANNELS.length) {
    console.warn("⚠️ CHANNELS bo‘sh. /start salom beradi, lekin tekshirish bo‘lmaydi.");
}

async function isMember(ctx, chatId) {
    try {
        const m = await ctx.telegram.getChatMember(chatId, ctx.from.id);
        const ok = new Set(["creator", "administrator", "member"]);
        if (ok.has(m.status)) return true;
        if (m.status === "restricted" && m.is_member) return true;
        return false;
    } catch (e) {
        console.error("getChatMember error:", e?.description || e);
        return false;
    }
}

//
// ========== Bot ==========
//

const bot = new Telegraf(BOT_TOKEN);

bot.start(async (ctx) => {
    if (!CHANNELS.length) {
        return ctx.reply("Assalom! Xush kelibsiz. (KANALLAR sozlanmagan)");
    }

    const lines = [
        "👋 Assalomu alaykum!",
        "Botdan foydalanish uchun quyidagi kanallarimizga a’zo bo‘ling, so‘ng ✅ Tekshirish tugmasini bosing:",
        "",
        ...CHANNELS.map((c) => `• ${c}`)
    ].join("\n");

    const joinBtns = CHANNELS.map((c) => {
        const url = toLink(c);
        return url
            ? Markup.button.url(`➕ ${c} ga a’zo bo‘lish`, url)
            : Markup.button.url(`➕ ${c} (invite link qo‘ying)`, "https://t.me/");
    });

    const keyboard = Markup.inlineKeyboard([
        ...joinBtns.map((b) => [b]),
        [Markup.button.callback("✅ Tekshirish", "verify")],
    ]);

    await ctx.reply(lines, keyboard);
});

bot.action("verify", async (ctx) => {
    await ctx.answerCbQuery().catch(() => { });
    if (!CHANNELS.length) {
        return ctx.reply("KANALLAR sozlanmagan. Admin, iltimos CHANNELS ni to‘ldiring.");
    }

    const results = await Promise.all(CHANNELS.map((id) => isMember(ctx, id)));
    const notJoined = CHANNELS.filter((_, i) => !results[i]);

    if (notJoined.length === 0) {
        return ctx.reply("🎉 A’zo bo‘lish tasdiqlandi. Assalom, xush kelibsiz!");
    }

    const msg = [
        "❗️ Hali quyidagi kanallarga a’zo bo‘lmadingiz:",
        ...notJoined.map((c) => `• ${c}`),
        "",
        "A’zo bo‘lib bo‘lgach, yana “✅ Tekshirish”ni bosing."
    ].join("\n");

    const btns = notJoined.map((c) => [
        Markup.button.url(`➕ ${c} ga a’zo bo‘lish`, toLink(c) || "https://t.me/"),
    ]);

    return ctx.reply(msg, Markup.inlineKeyboard([...btns, [Markup.button.callback("✅ Tekshirish", "verify")]]));
});

// Foydali komandalar
bot.command("verify", async (ctx) => {
    if (!CHANNELS.length) return ctx.reply("KANALLAR sozlanmagan.");
    const results = await Promise.all(CHANNELS.map((id) => isMember(ctx, id)));
    const notJoined = CHANNELS.filter((_, i) => !results[i]);
    if (notJoined.length === 0) {
        return ctx.reply("🎉 A’zo bo‘lish tasdiqlandi. Assalom, xush kelibsiz!");
    }
    return ctx.reply(
        ["❗️ Hali quyidagi kanallar:", ...notJoined.map((c) => `• ${c}`), "", "A’zo bo‘ling va /verify ni bosing."].join("\n")
    );
});

bot.command("chanid", async (ctx) => {
    const [, handle] = (ctx.message.text || "").split(" ");
    if (!handle) return ctx.reply("Foydalanish: /chanid @kanal_username");
    try {
        const chat = await ctx.telegram.getChat(handle);
        return ctx.reply(`ID: ${chat.id}\nTitle: ${chat.title}`);
    } catch (e) {
        return ctx.reply("Topilmadi. Bot kanalga admin qilinganmi va username to‘g‘rimi?");
    }
});

//
// ========== Express + Webhook (Render) ==========
//

const app = express();
app.use(express.json());

// Sog‘liq tekshirish
app.get("/", (req, res) => res.send("OK"));

// Webhook path — xavfsizligi uchun token bilan
const hookPath = `/${BOT_TOKEN}`;

// Telegraf webhook callback
app.use(hookPath, bot.webhookCallback(hookPath));

// Serverni ko‘taramiz va webhook URL ni o‘rnatamiz
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
    try {
        // Render avtomatik env: RENDER_EXTERNAL_URL
        const baseUrl =
            process.env.RENDER_EXTERNAL_URL?.replace(/\/+$/, "") ||
            process.env.WEBHOOK_BASE_URL?.replace(/\/+$/, "");

        if (!baseUrl) {
            console.warn("⚠️ RENDER_EXTERNAL_URL yoki WEBHOOK_BASE_URL topilmadi. Webhook URL qo‘yilmadi.");
            console.warn("   Render’da odatda RENDER_EXTERNAL_URL avtomatik bo‘ladi.");
        } else {
            const url = `${baseUrl}${hookPath}`;
            await bot.telegram.setWebhook(url);
            console.log("✅ Webhook set:", url);
        }
    } catch (e) {
        console.error("Webhook o‘rnatishda xatolik:", e?.description || e);
    }
    console.log(`HTTP server ${PORT} portda ishlayapti`);
});
