// index.js
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
    if (/^-100\d+$/.test(s)) return s;
    const m1 = s.match(/tg:\/\/resolve\?domain=([A-Za-z0-9_]+)/i);
    if (m1) return "@" + m1[1];
    const m2 = s.match(/(?:https?:\/\/)?t\.me\/([A-Za-z0-9_]+)/i);
    if (m2) return "@" + m2[1];
    if (s.startsWith("@")) return s;
    return "";
}

function toLink(idOrUsername) {
    const s = String(idOrUsername);
    if (s.startsWith("@")) return `https://t.me/${s.slice(1)}`;
    return null; // private ID uchun invite link qo‘yish kerak
}

const CHANNELS = (process.env.CHANNELS || "")
    .split(",")
    .map((s) => normalizeChannel(s))
    .filter(Boolean);

async function isMember(ctx, chatId) {
    try {
        const m = await ctx.telegram.getChatMember(chatId, ctx.from.id);
        const ok = new Set(["creator", "administrator", "member"]);
        if (ok.has(m.status)) return true;
        if (m.status === "restricted" && m.is_member) return true;
        return false;
    } catch {
        return false;
    }
}

//
// ========== Bot ==========
//
const bot = new Telegraf(BOT_TOKEN);

bot.start(async (ctx) => {
    if (!CHANNELS.length) return ctx.reply("Assalom! Xush kelibsiz.");
    const text = [
        "👋 Assalomu alaykum!",
        "Quyidagi kanallarimizga a’zo bo‘ling va ✅ Tekshirish tugmasini bosing:",
        ...CHANNELS.map((c) => `• ${c}`)
    ].join("\n");

    const buttons = CHANNELS.map((c) => {
        const url = toLink(c);
        return url
            ? Markup.button.url(`➕ ${c}`, url)
            : Markup.button.url(`➕ ${c} (invite link qo‘ying)`, "https://t.me/");
    });

    await ctx.reply(text, Markup.inlineKeyboard([
        ...buttons.map((b) => [b]),
        [Markup.button.callback("✅ Tekshirish", "verify")]
    ]));
});

bot.action("verify", async (ctx) => {
    await ctx.answerCbQuery().catch(() => { });
    if (!CHANNELS.length) return ctx.reply("KANALLAR sozlanmagan.");

    const results = await Promise.all(CHANNELS.map((id) => isMember(ctx, id)));
    const notJoined = CHANNELS.filter((_, i) => !results[i]);

    if (notJoined.length === 0) {
        return ctx.reply("🎉 A’zo bo‘lish tasdiqlandi. Xush kelibsiz!");
    }
    return ctx.reply(
        ["❗️ Hali quyidagi kanallarga a’zo bo‘lmadingiz:", ...notJoined.map((c) => `• ${c}`)].join("\n"),
        Markup.inlineKeyboard([
            ...notJoined.map((c) => [Markup.button.url(`➕ ${c}`, toLink(c) || "https://t.me/")]),
            [Markup.button.callback("✅ Tekshirish", "verify")]
        ])
    );
});

//
// ========== Webhook + Polling fallback ==========
//
const app = express();
app.get("/", (req, res) => res.send("OK"));

const hookPath = `/${BOT_TOKEN}`;
app.use(hookPath, bot.webhookCallback(hookPath));

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
    const baseUrl =
        process.env.RENDER_EXTERNAL_URL?.replace(/\/+$/, "") ||
        process.env.WEBHOOK_BASE_URL?.replace(/\/+$/, "");

    if (baseUrl) {
        const url = `${baseUrl}${hookPath}`;
        await bot.telegram.setWebhook(url);
        console.log("✅ Webhook set:", url);
    } else {
        console.warn("⚠️ Webhook URL yo‘q. Polling rejimi ishga tushirildi.");
        await bot.telegram.deleteWebhook().catch(() => { });
        await bot.launch();
        console.log("✅ Bot polling rejimida ishlayapti (lokal).");
    }

    console.log(`HTTP server ${PORT} portda ishlayapti`);
});
