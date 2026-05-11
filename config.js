require('dotenv').config();

module.exports = {
    // Bot Configuration
    token: process.env.BOT_TOKEN,
    ownerId: process.env.OWNER_ID,
    clientId: process.env.CLIENT_ID,
    
    // Webhooks
    logWebhookUrl: process.env.LOG_WEBHOOK_URL,
    
    // Protection Settings
    maxWarnings: parseInt(process.env.MAX_WARNINGS) || 5,
    raidJoinLimit: parseInt(process.env.RAID_JOIN_LIMIT) || 5,
    raidJoinTime: parseInt(process.env.RAID_JOIN_TIME) || 10,
    spamLimit: parseInt(process.env.SPAM_LIMIT) || 5,
    spamTimeSeconds: parseInt(process.env.SPAM_TIME_SECONDS) || 5,
    massMentionLimit: parseInt(process.env.MASS_MENTION_LIMIT) || 5,
    linkTimeoutMinutes: parseInt(process.env.LINK_TIMEOUT_MINUTES) || 5,
    maxChannelCreate: parseInt(process.env.MAX_CHANNEL_CREATE) || 5,
    maxChannelDelete: parseInt(process.env.MAX_CHANNEL_DELETE) || 5,
    maxRoleCreate: parseInt(process.env.MAX_ROLE_CREATE) || 5,
    maxRoleDelete: parseInt(process.env.MAX_ROLE_DELETE) || 5,
    maxWebhookCreate: parseInt(process.env.MAX_WEBHOOK_CREATE) || 3,
    
    // Anti-Link Settings
    blockAllLinks: process.env.BLOCK_ALL_LINKS === 'true',
    allowedDomains: (process.env.ALLOWED_DOMAINS || '').split(',').filter(d => d),
    blockedDomains: (process.env.BLOCKED_DOMAINS || '').split(',').filter(d => d),
    
    // Auto-Mod Settings
    autoModeration: process.env.AUTO_MODERATION === 'true',
    filterBadWords: process.env.FILTER_BAD_WORDS === 'true',
    filterInvites: process.env.FILTER_INVITES === 'true',
    filterScamLinks: process.env.FILTER_SCAM_LINKS === 'true',
    
    // Bad Words List
    badWords: [
        'fuck', 'shit', 'asshole', 'bitch', 'cunt', 'nigger', 'faggot',
        'retard', 'kys', 'kill yourself', 'die', 'stupid', 'idiot',
        'whore', 'slut', 'pussy', 'dick', 'cock', 'porn', 'sex'
    ],
    
    // Scam Patterns
    scamPatterns: [
        /free.*nitro/i, /discord\.gift/i, /steam.*free/i, /gift.*card/i,
        /claim.*free/i, /win.*iphone/i, /giveaway.*free/i, /hack.*free/i,
        /crypto.*giveaway/i, /eth.*giveaway/i, /btc.*giveaway/i
    ],
    
    // Invite Patterns
    invitePatterns: [
        /discord\.gg\/[a-zA-Z0-9]+/i,
        /discord\.com\/invite\/[a-zA-Z0-9]+/i,
        /discordapp\.com\/invite\/[a-zA-Z0-9]+/i,
        /dsc\.gg\/[a-zA-Z0-9]+/i,
        /dis\.gd\/[a-zA-Z0-9]+/i
    ],
    
    // URL Pattern
    urlPattern: /https?:\/\/[^\s]+|www\.[^\s]+|[a-zA-Z0-9-]+\.[a-zA-Z]{2,}[\/\w\-?=&%]*/i,
    
    // Permissions
    adminPermissions: 8,
    modPermissions: 268435462
};
