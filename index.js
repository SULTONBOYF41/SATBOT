// index.js — Telegraf + Express (Webhook — Render, Polling — lokal)
// npm i telegraf express dotenv

require("dotenv").config();
const express = require("express");
const { Telegraf, Markup } = require("telegraf");
const crypto = require("crypto");

// === ENV ===
const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) throw new Error("BOT_TOKEN environment variablini qo‘ying.");
const RAW_CHANNELS = process.env.CHANNELS || ""; // @username yoki -100ID (vergul bilan)
const WEBHOOK_SECRET =
    process.env.WEBHOOK_SECRET ||
    crypto.createHash("sha256").update(BOT_TOKEN).digest("hex").slice(0, 32); // ixtiyoriy, lekin barqaror

// === Helpers ===
function normalizeChannel(input) {
    let s = String(input || "").trim();
    if (/^-100\d+$/.test(s)) return s;                // private ID
    const m1 = s.match(/tg:\/\/resolve\?domain=([A-Za-z0-9_]+)/i);
    if (m1) return "@" + m1[1];
    const m2 = s.match(/(?:https?:\/\/)?t\.me\/([A-Za-z0-9_]+)/i);
    if (m2) return "@" + m2[1];
    if (s.startsWith("@")) return s;                  // public username
    return "";
}

function toLink(idOrUsername) {
    const s = String(idOrUsername);
    if (s.startsWith("@")) return `https://t.me/${s.slice(1)}`;
    return null; // private ID — foydalanuvchiga invite link kerak
}

const CHANNELS = RAW_CHANNELS.split(",").map(normalizeChannel).filter(Boolean);

async function isMember(ctx, chatId) {
    try {
        const m = await ctx.telegram.getChatMember(chatId, ctx.from.id);
        const ok = new Set(["creator", "administrator", "member"]);
        if (ok.has(m.status)) return true;
        if (m.status === "restricted" && m.is_member) return true;
        return false;
    } catch (e) {
        console.error("getChatMember error:", e?.description || e?.message || e);
        return false;
    }
}

// === Bot ===
const bot = new Telegraf(BOT_TOKEN);

// Diagnostika
bot.use(async (ctx, next) => {
    console.log("update:", {
        type: ctx.updateType,
        from: ctx.from?.id,
        chat: ctx.chat?.id,
        data: ctx.callbackQuery?.data
    });
    return next();
});

bot.start(async (ctx) => {
    if (!CHANNELS.length) return ctx.reply("Assalom! Xush kelibsiz.");

    const text = [
        "👋 Assalomu alaykum!",
        "Quyidagi kanallarimizga a’zo bo‘ling va so‘ng “✅ Tekshirish”ni bosing:",
        ...CHANNELS.map((c) => `• ${c}`)
    ].join("\n");

    const joinButtons = CHANNELS.map((c) => {
        const url = toLink(c);
        return url
            ? Markup.button.url(`➕ ${c} ga a’zo bo‘lish`, url)
            : Markup.button.url(`➕ ${c} (invite link qo‘ying)`, "https://t.me/");
    });

    await ctx.reply(
        text,
        Markup.inlineKeyboard([
            ...joinButtons.map((b) => [b]),
            [Markup.button.callback("✅ Tekshirish", "verify")]
        ])
    );
});

bot.action("verify", async (ctx) => {
    await ctx.answerCbQuery().catch(() => { });
    if (!CHANNELS.length) return ctx.reply("KANALLAR sozlanmagan.");

    const results = await Promise.all(CHANNELS.map((id) => isMember(ctx, id)));
    const notJoined = CHANNELS.filter((_, i) => !results[i]);

    if (notJoined.length === 0) {
        return ctx.reply("🎉 A’zo bo‘lish tasdiqlandi. Xush kelibsiz!");
    }

    const msg = [
        "❗️ Hali quyidagi kanallarga a’zo bo‘lmadingiz:",
        ...notJoined.map((c) => `• ${c}`),
        "",
        "A’zo bo‘lib bo‘lgach, yana “✅ Tekshirish”ni bosing."
    ].join("\n");

    return ctx.reply(
        msg,
        Markup.inlineKeyboard([
            ...notJoined.map((c) => [Markup.button.url(`➕ ${c} ga a’zo bo‘lish`, toLink(c) || "https://t.me/")]),
            [Markup.button.callback("✅ Tekshirish", "verify")]
        ])
    );
});

bot.command("verify", async (ctx) => {
    if (!CHANNELS.length) return ctx.reply("KANALLAR sozlanmagan.");
    const results = await Promise.all(CHANNELS.map((id) => isMember(ctx, id)));
    const notJoined = CHANNELS.filter((_, i) => !results[i]);
    if (notJoined.length === 0) return ctx.reply("🎉 A’zo bo‘lish tasdiqlandi. Xush kelibsiz!");
    return ctx.reply(["❗️ Quyidagilarga a’zo bo‘ling:", ...notJoined.map((c) => `• ${c}`)].join("\n"));
});

bot.command("chanid", async (ctx) => {
    const [, handle] = (ctx.message.text || "").split(" ");
    if (!handle) return ctx.reply("Foydalanish: /chanid @kanal_username");
    try {
        const chat = await ctx.telegram.getChat(handle);
        return ctx.reply(`ID: ${chat.id}\nTitle: ${chat.title}`);
    } catch {
        return ctx.reply("Topilmadi. Bot kanalga admin qilinganmi va username to‘g‘rimi?");
    }
});

// === Express (Webhook + Health + Debug) ===
const app = express();

// Health check (Render Settings → Health Check Path = /healthz)
app.get("/healthz", (_req, res) => res.status(200).send("OK"));
app.get("/", (_req, res) => res.send("OK"));

// **MUHIM**: token o‘rniga oddiy secret path ishlatamiz — ":" yo‘q!
const hookPath = `/webhook/${WEBHOOK_SECRET}`;

// JSON parser qo‘ymaymiz
app.use(hookPath, bot.webhookCallback(hookPath));

// Webhook holati
app.get("/debug", async (_req, res) => {
    try {
        const info = await bot.telegram.getWebhookInfo();
        res.json(info);
    } catch (e) {
        res.status(500).json({ error: e?.message || String(e) });
    }
});

// === Start ===
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
    const baseUrl =
        process.env.RENDER_EXTERNAL_URL?.replace(/\/+$/, "") ||
        process.env.WEBHOOK_BASE_URL?.replace(/\/+$/, "");

    if (baseUrl) {
        const url = `${baseUrl}${hookPath}`;
        try {
            // avval eski webhookni tozalaymiz
            await bot.telegram.deleteWebhook().catch(() => { });
            await bot.telegram.setWebhook(url);
            console.log("✅ Webhook set:", url);
        } catch (e) {
            console.error("Webhook set xatosi:", e?.description || e?.message || e);
        }
    } else {
        console.warn("⚠️ Webhook URL yo‘q. Polling rejimi ishga tushirildi.");
        try {
            await bot.telegram.deleteWebhook().catch(() => { });
            await bot.launch();
            console.log("✅ Bot polling rejimida ishlayapti (lokal).");
        } catch (e) {
            console.error("Polling xatosi:", e?.description || e?.message || e);
        }
    }

    console.log(`HTTP server ${PORT} portda ishlayapti`);
});

// Graceful shutdown
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
