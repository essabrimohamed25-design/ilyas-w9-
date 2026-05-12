const { Client, GatewayIntentBits, EmbedBuilder, Collection } = require('discord.js');
const sqlite3 = require('sqlite3').verbose();
const axios = require('axios');
require('dotenv').config();

// Database setup
const db = new sqlite3.Database('./database.sqlite');

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS servers (
        guild_id TEXT PRIMARY KEY,
        settings TEXT,
        created_at TEXT
    )`);
    
    db.run(`CREATE TABLE IF NOT EXISTS warnings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT,
        user_id TEXT,
        reason TEXT,
        moderator TEXT,
        time TEXT
    )`);
    
    db.run(`CREATE TABLE IF NOT EXISTS bypass_users (
        guild_id TEXT,
        user_id TEXT,
        PRIMARY KEY (guild_id, user_id)
    )`);
    
    db.run(`CREATE TABLE IF NOT EXISTS bad_words (
        guild_id TEXT,
        word TEXT,
        PRIMARY KEY (guild_id, word)
    )`);
    
    db.run(`CREATE TABLE IF NOT EXISTS logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        guild_id TEXT,
        action TEXT,
        details TEXT,
        time TEXT
    )`);
});

// Bot setup
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildModeration
    ]
});

// Collections
const settings = new Collection();
const messageTracker = new Collection();
const joinTracker = new Collection();

// Load settings from database
async function loadSettings(guildId) {
    return new Promise((resolve) => {
        db.get('SELECT settings FROM servers WHERE guild_id = ?', [guildId], (err, row) => {
            if (row) {
                resolve(JSON.parse(row.settings));
            } else {
                const defaultSettings = {
                    antiRaid: true,
                    antiSpam: true,
                    antiLink: true,
                    antiMention: true,
                    antiBadWords: true,
                    antiInvite: true,
                    raidJoinLimit: parseInt(process.env.RAID_JOIN_LIMIT) || 5,
                    raidJoinTime: parseInt(process.env.RAID_JOIN_TIME) || 10,
                    spamLimit: parseInt(process.env.SPAM_LIMIT) || 5,
                    spamTime: parseInt(process.env.SPAM_TIME) || 5,
                    massMentionLimit: parseInt(process.env.MASS_MENTION_LIMIT) || 5,
                    maxWarnings: parseInt(process.env.MAX_WARNINGS) || 5,
                    logChannel: null,
                    welcomeChannel: null,
                    autoRole: null
                };
                db.run('INSERT INTO servers (guild_id, settings, created_at) VALUES (?, ?, ?)', 
                    [guildId, JSON.stringify(defaultSettings), new Date().toISOString()]);
                resolve(defaultSettings);
            }
        });
    });
}

async function saveSettings(guildId, settingsData) {
    return new Promise((resolve) => {
        db.run('UPDATE servers SET settings = ? WHERE guild_id = ?', 
            [JSON.stringify(settingsData), guildId], () => resolve());
    });
}

async function addWarning(guildId, userId, reason, moderator) {
    return new Promise((resolve) => {
        db.run('INSERT INTO warnings (guild_id, user_id, reason, moderator, time) VALUES (?, ?, ?, ?, ?)',
            [guildId, userId, reason, moderator, new Date().toISOString()], () => resolve());
    });
}

async function getWarnings(guildId, userId) {
    return new Promise((resolve) => {
        db.all('SELECT * FROM warnings WHERE guild_id = ? AND user_id = ? ORDER BY time DESC',
            [guildId, userId], (err, rows) => resolve(rows || []));
    });
}

async function clearWarnings(guildId, userId) {
    return new Promise((resolve) => {
        db.run('DELETE FROM warnings WHERE guild_id = ? AND user_id = ?', [guildId, userId], () => resolve());
    });
}

async function isBypassed(guildId, userId) {
    return new Promise((resolve) => {
        db.get('SELECT * FROM bypass_users WHERE guild_id = ? AND user_id = ?', [guildId, userId], (err, row) => resolve(!!row));
    });
}

async function addBypass(guildId, userId) {
    return new Promise((resolve) => {
        db.run('INSERT OR IGNORE INTO bypass_users (guild_id, user_id) VALUES (?, ?)', [guildId, userId], () => resolve());
    });
}

async function removeBypass(guildId, userId) {
    return new Promise((resolve) => {
        db.run('DELETE FROM bypass_users WHERE guild_id = ? AND user_id = ?', [guildId, userId], () => resolve());
    });
}

async function getBadWords(guildId) {
    return new Promise((resolve) => {
        db.all('SELECT word FROM bad_words WHERE guild_id = ?', [guildId], (err, rows) => resolve(rows.map(r => r.word)));
    });
}

async function addBadWord(guildId, word) {
    return new Promise((resolve) => {
        db.run('INSERT OR IGNORE INTO bad_words (guild_id, word) VALUES (?, ?)', [guildId, word.toLowerCase()], () => resolve());
    });
}

async function removeBadWord(guildId, word) {
    return new Promise((resolve) => {
        db.run('DELETE FROM bad_words WHERE guild_id = ? AND word = ?', [guildId, word.toLowerCase()], () => resolve());
    });
}

// Helper functions
function containsLink(text) {
    const patterns = [
        /https?:\/\/[^\s]+/i,
        /www\.[^\s]+\.[a-z]{2,}/i,
        /discord\.gg\/[a-zA-Z0-9]+/i,
        /discord\.com\/invite\/[a-zA-Z0-9]+/i
    ];
    return patterns.some(p => p.test(text));
}

function containsInvite(text) {
    const patterns = [
        /discord\.gg\/[a-zA-Z0-9]+/i,
        /discord\.com\/invite\/[a-zA-Z0-9]+/i,
        /dsc\.gg\/[a-zA-Z0-9]+/i
    ];
    return patterns.some(p => p.test(text));
}

async function checkSpam(userId, guildId, cfg) {
    const now = Date.now();
    const key = `${guildId}_${userId}`;
    const userMessages = messageTracker.get(key) || [];
    const recent = userMessages.filter(t => now - t < cfg.spamTime * 1000);
    recent.push(now);
    messageTracker.set(key, recent);
    return recent.length >= cfg.spamLimit;
}

// Progressive punishment
async function punish(guild, member, reason, cfg) {
    const warnings = await getWarnings(guild.id, member.id);
    const warningCount = warnings.length;
    
    if (warningCount + 1 >= cfg.maxWarnings) {
        await guild.bans.create(member, { reason: `Reached max warnings: ${reason}` });
        await logAction(guild.id, 'PERMANENT_BAN', `${member.user.tag} banned: ${reason}`);
        return 'PERMANENT_BAN';
    } else if (warningCount + 1 >= cfg.maxWarnings - 1) {
        await member.kick(reason);
        await logAction(guild.id, 'KICK', `${member.user.tag} kicked: ${reason}`);
        return 'KICK';
    } else {
        await member.timeout(10 * 60 * 1000, reason);
        await logAction(guild.id, 'TIMEOUT', `${member.user.tag} timed out: ${reason}`);
        return 'TIMEOUT';
    }
}

async function logAction(guildId, action, details) {
    db.run('INSERT INTO logs (guild_id, action, details, time) VALUES (?, ?, ?, ?)',
        [guildId, action, details, new Date().toISOString()]);
    
    if (process.env.LOG_WEBHOOK_URL) {
        try {
            await axios.post(process.env.LOG_WEBHOOK_URL, {
                embeds: [{
                    title: `🛡️ ${action}`,
                    description: details,
                    color: 0xff0000,
                    timestamp: new Date().toISOString()
                }]
            });
        } catch (error) {}
    }
}

// Discord events
client.once('ready', async () => {
    console.log(`✅ Bot is online: ${client.user.tag}`);
    console.log(`📊 Protecting ${client.guilds.cache.size} servers`);
    
    for (const guild of client.guilds.cache.values()) {
        await loadSettings(guild.id);
    }
    
    client.user.setPresence({
        activities: [{ name: `${client.guilds.cache.size} servers | Dashboard`, type: 3 }],
        status: 'online'
    });
});

client.on('guildCreate', async (guild) => {
    await loadSettings(guild.id);
    console.log(`✅ Added to new server: ${guild.name}`);
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (!message.guild) return;
    
    const cfg = await loadSettings(message.guild.id);
    const bypassed = await isBypassed(message.guild.id, message.author.id);
    
    if (bypassed || message.author.id === process.env.OWNER_ID) return;
    
    // Anti-Spam
    if (cfg.antiSpam && await checkSpam(message.author.id, message.guild.id, cfg)) {
        await message.delete();
        await punish(message.guild, message.member, "Spamming messages", cfg);
        await addWarning(message.guild.id, message.author.id, "Spamming", "System");
        return;
    }
    
    // Anti-Link
    if (cfg.antiLink && containsLink(message.content)) {
        await message.delete();
        await punish(message.guild, message.member, "Sending prohibited links", cfg);
        await addWarning(message.guild.id, message.author.id, "Sending links", "System");
        return;
    }
    
    // Anti-Invite
    if (cfg.antiInvite && containsInvite(message.content)) {
        await message.delete();
        await punish(message.guild, message.member, "Sending Discord invites", cfg);
        await addWarning(message.guild.id, message.author.id, "Sending invites", "System");
        return;
    }
    
    // Anti-Bad Words
    if (cfg.antiBadWords) {
        const badWords = await getBadWords(message.guild.id);
        const hasBadWord = badWords.some(word => message.content.toLowerCase().includes(word));
        if (hasBadWord) {
            await message.delete();
            await punish(message.guild, message.member, "Using inappropriate language", cfg);
            await addWarning(message.guild.id, message.author.id, "Bad word usage", "System");
            return;
        }
    }
    
    // Anti-Mass Mention
    if (cfg.antiMention && message.mentions.users.size >= cfg.massMentionLimit) {
        await message.delete();
        await punish(message.guild, message.member, `Mass mention (${message.mentions.users.size} users)`, cfg);
        await addWarning(message.guild.id, message.author.id, "Mass mention", "System");
        return;
    }
});

client.on('guildMemberAdd', async (member) => {
    const cfg = await loadSettings(member.guild.id);
    
    if (cfg.antiRaid) {
        const now = Date.now();
        const joins = joinTracker.get(member.guild.id) || [];
        joins.push(now);
        joinTracker.set(member.guild.id, joins.filter(t => now - t < cfg.raidJoinTime * 1000));
        
        if (joins.length >= cfg.raidJoinLimit) {
            await member.guild.channels.cache.forEach(async channel => {
                try {
                    await channel.permissionOverwrites.edit(member.guild.id, { SendMessages: false });
                } catch (error) {}
            });
            await logAction(member.guild.id, 'RAID_DETECTED', `${joins.length} members joined in ${cfg.raidJoinTime}s`);
        }
    }
    
    if (cfg.autoRole) {
        const role = member.guild.roles.cache.get(cfg.autoRole);
        if (role) await member.roles.add(role);
    }
});

// Start bot
client.login(process.env.BOT_TOKEN);

module.exports = { client, db, settings, loadSettings, saveSettings, addWarning, getWarnings, clearWarnings, isBypassed, addBypass, removeBypass, getBadWords, addBadWord, removeBadWord, logAction };
