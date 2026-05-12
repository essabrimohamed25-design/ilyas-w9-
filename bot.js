const { Client, GatewayIntentBits, EmbedBuilder, PermissionsBitField, Collection, Events } = require('discord.js');
const axios = require('axios');
const config = require('./config');

// ============================================
// BOT SETUP
// ============================================

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildModeration,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildPresences,
        GatewayIntentBits.GuildWebhooks
    ]
});

// Collections for data storage
const joinTracker = new Collection();
const messageTracker = new Collection();
const channelCreateTracker = new Collection();
const channelDeleteTracker = new Collection();
const roleCreateTracker = new Collection();
const roleDeleteTracker = new Collection();
const webhookCreateTracker = new Collection();
const userWarnings = new Collection();
const bypassUsers = new Set();
const lockedChannels = new Set();
let lockedServer = false;

// Protection status
const protectionStatus = {
    antiRaid: true,
    antiSpam: true,
    antiLink: true,
    antiMention: true,
    antiChannelCreate: true,
    antiChannelDelete: true,
    antiRoleCreate: true,
    antiRoleDelete: true,
    antiWebhook: true,
    antiBadWords: true,
    antiInvite: true,
    antiScam: true,
    autoMod: true
};

// ============================================
// HELPER FUNCTIONS
// ============================================

async function sendLog(guild, title, description, color = 0xff0000, fields = []) {
    if (!config.logWebhookUrl) return;
    
    try {
        const embed = new EmbedBuilder()
            .setTitle(`🛡️ ${title}`)
            .setDescription(description)
            .setColor(color)
            .setTimestamp()
            .setFooter({ text: `Server: ${guild.name} | ID: ${guild.id}` });
        
        for (const field of fields) {
            embed.addFields({ name: field.name, value: field.value, inline: field.inline });
        }
        
        await axios.post(config.logWebhookUrl, {
            embeds: [embed.toJSON()]
        });
    } catch (error) {
        console.error('Log error:', error.message);
    }
}

function isOwner(userId) {
    return userId === config.ownerId;
}

function isAdmin(member) {
    return member.permissions.has(PermissionsBitField.Flags.Administrator) || isOwner(member.id);
}

async function progressivePunishment(guild, member, reason, ctx = null) {
    const warnings = userWarnings.get(member.id) || [];
    const warningCount = warnings.length;
    
    const embed = new EmbedBuilder()
        .setTitle('⚠️ Violation Detected')
        .setColor(0xffaa00)
        .setTimestamp()
        .addFields(
            { name: 'Member', value: member.toString(), inline: true },
            { name: 'Reason', value: reason, inline: true },
            { name: 'Warnings', value: `${warningCount + 1}/${config.maxWarnings}`, inline: true }
        );
    
    let action = 'Warning';
    let color = 0xffcc00;
    
    if (warningCount + 1 >= config.maxWarnings) {
        await guild.bans.create(member, { reason: `Reached max warnings: ${reason}` });
        action = 'Permanent Ban';
        color = 0xff0000;
    } else if (warningCount + 1 >= config.maxWarnings - 1) {
        await member.kick(`Final warning: ${reason}`);
        action = 'Kick';
        color = 0xff6600;
    } else if (warningCount + 1 >= config.maxWarnings - 2) {
        await member.timeout(30 * 60 * 1000, reason);
        action = '30 Minute Timeout';
        color = 0xffaa00;
    } else if (warningCount + 1 >= config.maxWarnings - 3) {
        await member.timeout(10 * 60 * 1000, reason);
        action = '10 Minute Timeout';
        color = 0xffaa00;
    } else {
        action = `Warning ${warningCount + 1}/${config.maxWarnings}`;
        color = 0xffcc00;
    }
    
    embed.setTitle(`🛡️ ${action}`).setColor(color);
    embed.setDescription(`${member.toString()} has been punished!`);
    
    if (ctx) {
        await ctx.reply({ embeds: [embed], ephemeral: true });
    }
    
    userWarnings.set(member.id, [...warnings, {
        reason,
        time: new Date().toISOString(),
        moderator: ctx ? ctx.author.tag : 'System',
        action
    }]);
    
    await sendLog(guild, action, `**Member:** ${member.toString()}\n**Reason:** ${reason}\n**Moderator:** ${ctx ? ctx.author.tag : 'System'}`, color);
}

function checkRaid(guildId) {
    if (!joinTracker.has(guildId)) return false;
    
    const now = Date.now();
    const recentJoins = joinTracker.get(guildId).filter(time => now - time < config.raidJoinTime * 1000);
    
    if (recentJoins.length >= config.raidJoinLimit) {
        joinTracker.set(guildId, recentJoins);
        return true;
    }
    return false;
}

function containsLink(text) {
    const urlMatch = config.urlPattern.test(text);
    
    for (const pattern of config.invitePatterns) {
        if (pattern.test(text)) return true;
    }
    
    if (!config.blockAllLinks) {
        for (const domain of config.allowedDomains) {
            if (text.toLowerCase().includes(domain.toLowerCase())) return false;
        }
    }
    
    for (const domain of config.blockedDomains) {
        if (text.toLowerCase().includes(domain.toLowerCase())) return true;
    }
    
    return urlMatch;
}

function containsBadWord(text) {
    if (!config.filterBadWords) return false;
    const lowerText = text.toLowerCase();
    return config.badWords.some(word => lowerText.includes(word));
}

function containsScam(text) {
    if (!config.filterScamLinks) return false;
    return config.scamPatterns.some(pattern => pattern.test(text));
}

function containsInvite(text) {
    if (!config.filterInvites) return false;
    return config.invitePatterns.some(pattern => pattern.test(text));
}

function checkSpam(userId) {
    const now = Date.now();
    const userMessages = messageTracker.get(userId) || [];
    const recentMessages = userMessages.filter(time => now - time < config.spamTimeSeconds * 1000);
    
    recentMessages.push(now);
    messageTracker.set(userId, recentMessages);
    
    return recentMessages.length >= config.spamLimit;
}

function countMentions(message) {
    return message.mentions.users.size + message.mentions.roles.size + (message.mentions.everyone ? 1 : 0);
}

// ============================================
// COMMANDS - HELP
// ============================================

client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot) return;
    if (!message.content.startsWith('-')) return;
    
    const args = message.content.slice(1).trim().split(/ +/);
    const command = args.shift().toLowerCase();
    const ctx = { author: message.author, guild: message.guild, channel: message.channel, reply: async (content) => message.reply(content) };
    
    // HELP COMMAND
    if (command === 'help') {
        const embed = new EmbedBuilder()
            .setTitle('🛡️ Advanced Protection Bot - Command List')
            .setDescription('Complete security system with `-` prefix')
            .setColor(0x2F3136)
            .setTimestamp()
            .addFields(
                { name: '🛡️ Protection Commands', value: '```\n-protection status\n-protection toggle <module>\n-antiraid <on/off>\n-antispam <on/off>\n-antilink <on/off>\n-antiping <on/off>\n```', inline: false },
                { name: '👮 Moderation Commands', value: '```\n-ban <user> [reason]\n-kick <user> [reason]\n-mute <user> [minutes] [reason]\n-unmute <user>\n-warn <user> <reason>\n-warnings <user>\n-clearwarns <user>\n-clear <amount>\n-lock\n-unlock\n-slowmode <seconds>\n-lockdown\n-unlockdown\n```', inline: false },
                { name: '📊 Utility Commands', value: '```\n-userinfo [user]\n-serverinfo\n-avatar [user]\n-ping\n-stats\n-invite\n```', inline: false },
                { name: '⚙️ Admin Commands', value: '```\n-bypass add/remove/list <user>\n-addword <word>\n-removeword <word>\n-wordlist\n```', inline: false }
            )
            .setFooter({ text: `Total Commands: 40+ | Requested by ${message.author.tag}` });
        
        return message.reply({ embeds: [embed] });
    }
    
    // Check permissions for moderation commands
    const modCommands = ['ban', 'kick', 'mute', 'unmute', 'warn', 'warnings', 'clearwarns', 'clear', 'lock', 'unlock', 'slowmode', 'lockdown', 'unlockdown'];
    if (modCommands.includes(command) && !isAdmin(message.member)) {
        return message.reply('❌ You need administrator permissions!');
    }
    
    // ============================================
    // PROTECTION COMMANDS
    // ============================================
    
    if (command === 'protection') {
        if (!isAdmin(message.member)) return message.reply('❌ Admin only!');
        
        const action = args[0];
        const module = args[1];
        
        if (action === 'status') {
            const embed = new EmbedBuilder()
                .setTitle('🛡️ Protection Status')
                .setColor(0x2F3136)
                .setTimestamp();
            
            for (const [key, value] of Object.entries(protectionStatus)) {
                const name = key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase());
                embed.addFields({ name, value: value ? '✅' : '❌', inline: true });
            }
            
            return message.reply({ embeds: [embed] });
        } else if (action === 'toggle' && module) {
            const moduleKey = `anti${module.charAt(0).toUpperCase() + module.slice(1)}`;
            if (protectionStatus.hasOwnProperty(moduleKey)) {
                protectionStatus[moduleKey] = !protectionStatus[moduleKey];
                const state = protectionStatus[moduleKey] ? 'enabled' : 'disabled';
                message.reply(`✅ **${module}** protection has been **${state}**!`);
                await sendLog(message.guild, 'Protection Toggled', `**Module:** ${module}\n**Status:** ${state}`, 0x00ff00);
            } else {
                message.reply(`❌ Invalid module! Available: raid, spam, link, mention, channelcreate, channeldelete, rolecreate, roledelete, webhook, badwords, invite, scam`);
            }
        } else {
            message.reply('Usage: `-protection status` or `-protection toggle <module>`');
        }
    }
    
    // Individual toggles
    if (command === 'antiraid' && isAdmin(message.member)) {
        protectionStatus.antiRaid = args[0] === 'on';
        message.reply(`🛡️ Anti-Raid protection: **${args[0].toUpperCase()}**`);
    }
    
    if (command === 'antispam' && isAdmin(message.member)) {
        protectionStatus.antiSpam = args[0] === 'on';
        message.reply(`🛡️ Anti-Spam protection: **${args[0].toUpperCase()}**`);
    }
    
    if (command === 'antilink' && isAdmin(message.member)) {
        protectionStatus.antiLink = args[0] === 'on';
        message.reply(`🔗 Anti-Link protection: **${args[0].toUpperCase()}**`);
    }
    
    if (command === 'antiping' && isAdmin(message.member)) {
        protectionStatus.antiMention = args[0] === 'on';
        message.reply(`📢 Anti-Mass Ping protection: **${args[0].toUpperCase()}**`);
    }
    
    // ============================================
    // MODERATION COMMANDS
    // ============================================
    
    if (command === 'ban') {
        const user = message.mentions.members.first() || await message.guild.members.fetch(args[0]).catch(() => null);
        if (!user) return message.reply('❌ User not found!');
        
        const reason = args.slice(1).join(' ') || 'No reason provided';
        await user.ban({ reason });
        
        const embed = new EmbedBuilder()
            .setTitle('🔨 User Banned')
            .setColor(0xff0000)
            .setTimestamp()
            .addFields(
                { name: 'Member', value: `${user.user.tag} (${user.id})`, inline: true },
                { name: 'Moderator', value: message.author.tag, inline: true },
                { name: 'Reason', value: reason, inline: false }
            );
        
        message.reply({ embeds: [embed] });
        await sendLog(message.guild, 'Member Banned', `**Member:** ${user.user.tag}\n**Moderator:** ${message.author.tag}\n**Reason:** ${reason}`, 0xff0000);
    }
    
    if (command === 'kick') {
        const user = message.mentions.members.first() || await message.guild.members.fetch(args[0]).catch(() => null);
        if (!user) return message.reply('❌ User not found!');
        
        const reason = args.slice(1).join(' ') || 'No reason provided';
        await user.kick(reason);
        
        const embed = new EmbedBuilder()
            .setTitle('👢 User Kicked')
            .setColor(0xff6600)
            .setTimestamp()
            .addFields(
                { name: 'Member', value: `${user.user.tag} (${user.id})`, inline: true },
                { name: 'Moderator', value: message.author.tag, inline: true },
                { name: 'Reason', value: reason, inline: false }
            );
        
        message.reply({ embeds: [embed] });
        await sendLog(message.guild, 'Member Kicked', `**Member:** ${user.user.tag}\n**Moderator:** ${message.author.tag}\n**Reason:** ${reason}`, 0xff6600);
    }
    
    if (command === 'mute') {
        const user = message.mentions.members.first() || await message.guild.members.fetch(args[0]).catch(() => null);
        if (!user) return message.reply('❌ User not found!');
        
        const minutes = parseInt(args[1]) || 10;
        const reason = args.slice(2).join(' ') || 'No reason provided';
        
        await user.timeout(minutes * 60 * 1000, reason);
        
        const embed = new EmbedBuilder()
            .setTitle('🔇 User Muted')
            .setColor(0xffaa00)
            .setTimestamp()
            .addFields(
                { name: 'Member', value: user.toString(), inline: true },
                { name: 'Duration', value: `${minutes} minutes`, inline: true },
                { name: 'Reason', value: reason, inline: false }
            );
        
        message.reply({ embeds: [embed] });
    }
    
    if (command === 'unmute') {
        const user = message.mentions.members.first() || await message.guild.members.fetch(args[0]).catch(() => null);
        if (!user) return message.reply('❌ User not found!');
        
        await user.timeout(null);
        message.reply(`✅ ${user.toString()} has been unmuted!`);
    }
    
    if (command === 'warn') {
        const user = message.mentions.members.first() || await message.guild.members.fetch(args[0]).catch(() => null);
        if (!user) return message.reply('❌ User not found!');
        
        const reason = args.slice(1).join(' ');
        if (!reason) return message.reply('❌ Please provide a reason!');
        
        await progressivePunishment(message.guild, user, reason, message);
    }
    
    if (command === 'warnings') {
        const user = message.mentions.members.first() || message.member;
        const warns = userWarnings.get(user.id) || [];
        
        if (warns.length === 0) {
            return message.reply(`✅ ${user.toString()} has no warnings!`);
        }
        
        const embed = new EmbedBuilder()
            .setTitle(`⚠️ Warnings for ${user.user.username}`)
            .setColor(0xffaa00)
            .setTimestamp();
        
        warns.slice(0, 10).forEach((warn, i) => {
            embed.addFields({ name: `Warning #${i + 1}`, value: `**Reason:** ${warn.reason}\n**Date:** ${warn.time}\n**Moderator:** ${warn.moderator}`, inline: false });
        });
        
        message.reply({ embeds: [embed] });
    }
    
    if (command === 'clearwarns') {
        const user = message.mentions.members.first() || await message.guild.members.fetch(args[0]).catch(() => null);
        if (!user) return message.reply('❌ User not found!');
        
        userWarnings.delete(user.id);
        message.reply(`✅ Cleared all warnings for ${user.toString()}`);
    }
    
    if (command === 'clear') {
        const amount = parseInt(args[0]);
        if (amount < 1 || amount > 100) return message.reply('❌ Amount must be between 1 and 100!');
        
        const deleted = await message.channel.bulkDelete(amount + 1);
        const msg = await message.reply(`✅ Deleted ${deleted.size - 1} messages!`);
        setTimeout(() => msg.delete(), 3000);
    }
    
    if (command === 'lock') {
        await message.channel.permissionOverwrites.edit(message.guild.id, { SendMessages: false });
        lockedChannels.add(message.channel.id);
        message.reply(`🔒 ${message.channel.toString()} has been locked!`);
    }
    
    if (command === 'unlock') {
        await message.channel.permissionOverwrites.edit(message.guild.id, { SendMessages: null });
        lockedChannels.delete(message.channel.id);
        message.reply(`🔓 ${message.channel.toString()} has been unlocked!`);
    }
    
    if (command === 'slowmode') {
        const seconds = parseInt(args[0]);
        if (seconds < 0 || seconds > 21600) return message.reply('❌ Slowmode must be between 0 and 21600 seconds!');
        
        await message.channel.setRateLimitPerUser(seconds);
        message.reply(seconds === 0 ? `✅ Slowmode has been disabled!` : `🐢 Slowmode set to ${seconds} seconds!`);
    }
    
    if (command === 'lockdown' && isAdmin(message.member)) {
        lockedServer = true;
        for (const channel of message.guild.channels.cache.values()) {
            try {
                await channel.permissionOverwrites.edit(message.guild.id, { SendMessages: false });
            } catch (error) {}
        }
        message.reply('🔒 **SERVER LOCKDOWN ACTIVATED!** All channels locked.');
        await sendLog(message.guild, 'Server Lockdown', `**Moderator:** ${message.author.tag}\nAll channels have been locked!`, 0xff0000);
    }
    
    if (command === 'unlockdown' && isAdmin(message.member)) {
        lockedServer = false;
        for (const channel of message.guild.channels.cache.values()) {
            try {
                await channel.permissionOverwrites.edit(message.guild.id, { SendMessages: null });
            } catch (error) {}
        }
        message.reply('🔓 **SERVER LOCKDOWN DEACTIVATED!** All channels unlocked.');
        await sendLog(message.guild, 'Server Unlocked', `**Moderator:** ${message.author.tag}\nAll channels have been unlocked!`, 0x00ff00);
    }
    
    // ============================================
    // UTILITY COMMANDS
    // ============================================
    
    if (command === 'userinfo') {
        const user = message.mentions.members.first() || message.member;
        
        const embed = new EmbedBuilder()
            .setTitle(`👤 User Info: ${user.user.tag}`)
            .setColor(user.displayHexColor || 0x2F3136)
            .setThumbnail(user.user.displayAvatarURL())
            .setTimestamp()
            .addFields(
                { name: 'ID', value: user.id, inline: true },
                { name: 'Bot', value: user.user.bot ? 'Yes' : 'No', inline: true },
                { name: 'Joined Server', value: user.joinedAt.toLocaleDateString(), inline: false },
                { name: 'Joined Discord', value: user.user.createdAt.toLocaleDateString(), inline: false },
                { name: 'Roles', value: user.roles.cache.map(r => r.toString()).slice(0, 10).join(', ') || 'None', inline: false }
            );
        
        message.reply({ embeds: [embed] });
    }
    
    if (command === 'serverinfo') {
        const guild = message.guild;
        
        const embed = new EmbedBuilder()
            .setTitle(`📡 Server Info: ${guild.name}`)
            .setColor(0x2F3136)
            .setThumbnail(guild.iconURL())
            .setTimestamp()
            .addFields(
                { name: 'Owner', value: guild.ownerId, inline: true },
                { name: 'ID', value: guild.id, inline: true },
                { name: 'Created', value: guild.createdAt.toLocaleDateString(), inline: true },
                { name: 'Members', value: guild.memberCount.toString(), inline: true },
                { name: 'Channels', value: guild.channels.cache.size.toString(), inline: true },
                { name: 'Roles', value: guild.roles.cache.size.toString(), inline: true },
                { name: 'Boost Level', value: guild.premiumTier.toString(), inline: true },
                { name: 'Boost Count', value: guild.premiumSubscriptionCount?.toString() || '0', inline: true }
            );
        
        message.reply({ embeds: [embed] });
    }
    
    if (command === 'avatar') {
        const user = message.mentions.users.first() || message.author;
        
        const embed = new EmbedBuilder()
            .setTitle(`🖼️ Avatar: ${user.tag}`)
            .setImage(user.displayAvatarURL({ size: 1024, dynamic: true }))
            .setColor(0x2F3136)
            .setFooter({ text: `Requested by ${message.author.tag}` });
        
        message.reply({ embeds: [embed] });
    }
    
    if (command === 'ping') {
        const latency = client.ws.ping;
        const embed = new EmbedBuilder()
            .setTitle('🏓 Pong!')
            .setDescription(`Latency: **${latency}ms**`)
            .setColor(0x00ff00);
        
        message.reply({ embeds: [embed] });
    }
    
    if (command === 'stats') {
        const embed = new EmbedBuilder()
            .setTitle('📊 Bot Statistics')
            .setColor(0x2F3136)
            .setTimestamp()
            .addFields(
                { name: 'Servers', value: client.guilds.cache.size.toString(), inline: true },
                { name: 'Users', value: client.users.cache.size.toString(), inline: true },
                { name: 'Latency', value: `${client.ws.ping}ms`, inline: true },
                { name: 'Commands', value: '40+', inline: true },
                { name: 'Protections', value: '12+', inline: true },
                { name: 'Uptime', value: 'Online', inline: true }
            );
        
        message.reply({ embeds: [embed] });
    }
    
    if (command === 'invite') {
        const inviteUrl = `https://discord.com/oauth2/authorize?client_id=${config.clientId}&permissions=8&scope=bot`;
        
        const embed = new EmbedBuilder()
            .setTitle('🔗 Invite Bot')
            .setDescription(`[Click here to invite me!](${inviteUrl})`)
            .setColor(0x00ff00)
            .addFields({ name: 'Permissions', value: 'Administrator (Full Access)', inline: false });
        
        message.reply({ embeds: [embed] });
    }
    
    // ============================================
    // ADMIN COMMANDS
    // ============================================
    
    if (command === 'bypass' && isAdmin(message.member)) {
        const action = args[0];
        const user = message.mentions.members.first();
        
        if (action === 'add' && user) {
            bypassUsers.add(user.id);
            message.reply(`✅ ${user.toString()} has been added to bypass list!`);
        } else if (action === 'remove' && user) {
            bypassUsers.delete(user.id);
            message.reply(`✅ ${user.toString()} has been removed from bypass list!`);
        } else if (action === 'list') {
            if (bypassUsers.size === 0) {
                message.reply('No users in bypass list!');
            } else {
                const users = [];
                for (const uid of bypassUsers) {
                    const user = await client.users.fetch(uid).catch(() => null);
                    users.push(`• ${user ? user.tag : uid}`);
                }
                message.reply(`**Bypassed Users:**\n${users.join('\n')}`);
            }
        } else {
            message.reply('Usage: `-bypass add/remove/list <user>`');
        }
    }
    
    if (command === 'addword' && isAdmin(message.member)) {
        const word = args.join(' ');
        if (!word) return message.reply('❌ Please provide a word!');
        
        if (!config.badWords.includes(word.toLowerCase())) {
            config.badWords.push(word.toLowerCase());
            message.reply(`✅ Added \`${word}\` to bad words list!`);
        } else {
            message.reply(`❌ \`${word}\` is already in the list!`);
        }
    }
    
    if (command === 'removeword' && isAdmin(message.member)) {
        const word = args.join(' ');
        if (!word) return message.reply('❌ Please provide a word!');
        
        const index = config.badWords.indexOf(word.toLowerCase());
        if (index !== -1) {
            config.badWords.splice(index, 1);
            message.reply(`✅ Removed \`${word}\` from bad words list!`);
        } else {
            message.reply(`❌ \`${word}\` not found in bad words list!`);
        }
    }
    
    if (command === 'wordlist') {
        if (config.badWords.length === 0) {
            message.reply('No bad words configured!');
        } else {
            const words = config.badWords.slice(0, 25).map(w => `• ${w}`).join('\n');
            message.reply(`**Bad Words List:**\n${words}`);
        }
    }
});

// ============================================
// EVENTS - PROTECTION SYSTEM
// ============================================

client.on(Events.GuildMemberAdd, async (member) => {
    if (isOwner(member.id) || bypassUsers.has(member.id)) return;
    
    const now = Date.now();
    const joins = joinTracker.get(member.guild.id) || [];
    joins.push(now);
    joinTracker.set(member.guild.id, joins.filter(time => now - time < config.raidJoinTime * 1000));
    
    if (protectionStatus.antiRaid && checkRaid(member.guild.id)) {
        await member.guild.channels.cache.forEach(async channel => {
            try {
                await channel.permissionOverwrites.edit(member.guild.id, { SendMessages: false });
            } catch (error) {}
        });
        
        await sendLog(member.guild, '⚠️ RAID DETECTED!', `**${joinTracker.get(member.guild.id).length}** members joined in ${config.raidJoinTime} seconds!\nServer has been locked down!`, 0xff0000);
    }
});

client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot) return;
    if (isOwner(message.author.id) || bypassUsers.has(message.author.id)) return;
    
    if (lockedChannels.has(message.channel.id) || lockedServer) {
        await message.delete();
        return;
    }
    
    if (protectionStatus.antiSpam && checkSpam(message.author.id)) {
        await message.delete();
        await progressivePunishment(message.guild, message.member, "Spamming messages", message);
        return;
    }
    
    if (protectionStatus.antiMention) {
        const mentionCount = countMentions(message);
        if (mentionCount >= config.massMentionLimit) {
            await message.delete();
            await progressivePunishment(message.guild, message.member, `Mass mention (${mentionCount} mentions)`, message);
            return;
        }
    }
    
    if (protectionStatus.antiLink && containsLink(message.content)) {
        await message.delete();
        await progressivePunishment(message.guild, message.member, "Sending prohibited links", message);
        return;
    }
    
    if (protectionStatus.antiBadWords && containsBadWord(message.content)) {
        await message.delete();
        await progressivePunishment(message.guild, message.member, "Using inappropriate language", message);
        return;
    }
    
    if (protectionStatus.antiInvite && containsInvite(message.content)) {
        await message.delete();
        await progressivePunishment(message.guild, message.member, "Sending Discord invites", message);
        return;
    }
    
    if (protectionStatus.antiScam && containsScam(message.content)) {
        await message.delete();
        await progressivePunishment(message.guild, message.member, "Sending scam links", message);
        return;
    }
});

client.on(Events.ChannelCreate, async (channel) => {
    if (!protectionStatus.antiChannelCreate) return;
    
    const auditLog = await channel.guild.fetchAuditLogs({ limit: 1, type: 10 });
    const entry = auditLog.entries.first();
    if (!entry) return;
    
    const user = entry.executor;
    if (isOwner(user.id) || bypassUsers.has(user.id) || user.id === client.user.id) return;
    
    const now = Date.now();
    const creates = channelCreateTracker.get(user.id) || [];
    creates.push(now);
    channelCreateTracker.set(user.id, creates.filter(time => now - time < 10000));
    
    if (creates.length >= config.maxChannelCreate) {
        await channel.guild.bans.create(user, { reason: `Mass channel creation (${creates.length} channels)` });
        await sendLog(channel.guild, '🚨 Mass Channel Creation', `**User:** ${user.tag}\n**Action:** Banned for creating ${creates.length} channels`, 0xff0000);
    }
});

client.on(Events.ChannelDelete, async (channel) => {
    if (!protectionStatus.antiChannelDelete) return;
    
    const auditLog = await channel.guild.fetchAuditLogs({ limit: 1, type: 11 });
    const entry = auditLog.entries.first();
    if (!entry) return;
    
    const user = entry.executor;
    if (isOwner(user.id) || bypassUsers.has(user.id) || user.id === client.user.id) return;
    
    const now = Date.now();
    const deletes = channelDeleteTracker.get(user.id) || [];
    deletes.push(now);
    channelDeleteTracker.set(user.id, deletes.filter(time => now - time < 10000));
    
    if (deletes.length >= config.maxChannelDelete) {
        await channel.guild.bans.create(user, { reason: `Mass channel deletion (${deletes.length} channels)` });
        await sendLog(channel.guild, '🚨 Mass Channel Deletion', `**User:** ${user.tag}\n**Action:** Banned for deleting ${deletes.length} channels`, 0xff0000);
    }
});

client.on(Events.GuildRoleCreate, async (role) => {
    if (!protectionStatus.antiRoleCreate) return;
    
    const auditLog = await role.guild.fetchAuditLogs({ limit: 1, type: 30 });
    const entry = auditLog.entries.first();
    if (!entry) return;
    
    const user = entry.executor;
    if (isOwner(user.id) || bypassUsers.has(user.id) || user.id === client.user.id) return;
    
    const now = Date.now();
    const creates = roleCreateTracker.get(user.id) || [];
    creates.push(now);
    roleCreateTracker.set(user.id, creates.filter(time => now - time < 10000));
    
    if (creates.length >= config.maxRoleCreate) {
        await role.guild.bans.create(user, { reason: `Mass role creation (${creates.length} roles)` });
        await sendLog(role.guild, '🚨 Mass Role Creation', `**User:** ${user.tag}\n**Action:** Banned for creating ${creates.length} roles`, 0xff0000);
    }
});

client.on(Events.GuildRoleDelete, async (role) => {
    if (!protectionStatus.antiRoleDelete) return;
    
    const auditLog = await role.guild.fetchAuditLogs({ limit: 1, type: 31 });
    const entry = auditLog.entries.first();
    if (!entry) return;
    
    const user = entry.executor;
    if (isOwner(user.id) || bypassUsers.has(user.id) || user.id === client.user.id) return;
    
    const now = Date.now();
    const deletes = roleDeleteTracker.get(user.id) || [];
    deletes.push(now);
    roleDeleteTracker.set(user.id, deletes.filter(time => now - time < 10000));
    
    if (deletes.length >= config.maxRoleDelete) {
        await role.guild.bans.create(user, { reason: `Mass role deletion (${deletes.length} roles)` });
        await sendLog(role.guild, '🚨 Mass Role Deletion', `**User:** ${user.tag}\n**Action:** Banned for deleting ${deletes.length} roles`, 0xff0000);
    }
});

client.on(Events.WebhooksUpdate, async (channel) => {
    if (!protectionStatus.antiWebhook) return;
    
    const auditLog = await channel.guild.fetchAuditLogs({ limit: 1, type: 50 });
    const entry = auditLog.entries.first();
    if (!entry) return;
    
    const user = entry.executor;
    if (isOwner(user.id) || bypassUsers.has(user.id) || user.id === client.user.id) return;
    
    const now = Date.now();
    const creates = webhookCreateTracker.get(user.id) || [];
    creates.push(now);
    webhookCreateTracker.set(user.id, creates.filter(time => now - time < 30000));
    
    if (creates.length >= config.maxWebhookCreate) {
        await channel.guild.bans.create(user, { reason: `Mass webhook creation (${creates.length} webhooks)` });
        await sendLog(channel.guild, '🚨 Mass Webhook Creation', `**User:** ${user.tag}\n**Action:** Banned for creating ${creates.length} webhooks`, 0xff0000);
    }
});

// ============================================
// READY EVENT
// ============================================

client.once(Events.ClientReady, async () => {
    console.log(`✅ ${client.user.tag} is online!`);
    console.log(`📊 Protecting ${client.guilds.cache.size} servers!`);
    console.log(`🔗 Invite URL: https://discord.com/oauth2/authorize?client_id=${config.clientId}&permissions=8&scope=bot`);
    
    client.user.setPresence({
        activities: [{ name: `${client.guilds.cache.size} servers | -help`, type: 3 }],
        status: 'online'
    });
});

// ============================================
// ERROR HANDLING
// ============================================

process.on('unhandledRejection', (error) => {
    console.error('Unhandled rejection:', error);
});

// ============================================
// START BOT
// ============================================

if (!config.token) {
    console.error('❌ BOT_TOKEN is missing in .env file!');
    process.exit(1);
}

console.log('🚀 Starting Advanced Protection Bot...');
console.log(`🤖 Client ID: ${config.clientId}`);
console.log(`👑 Owner ID: ${config.ownerId}`);
client.login(config.token);
