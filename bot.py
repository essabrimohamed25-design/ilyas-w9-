import discord
from discord.ext import commands
from datetime import datetime, timedelta
import asyncio
import re
import json
from collections import defaultdict
from typing import Dict, List, Set
import aiohttp

from config import *

# ============================================
# BOT SETUP
# ============================================

intents = discord.Intents.all()
bot = commands.Bot(command_prefix='-', intents=intents, help_command=None)

# ============================================
# DATA STRUCTURES
# ============================================

# Protection Data
join_tracker: Dict[int, List[datetime]] = defaultdict(list)
message_tracker: Dict[int, List[datetime]] = defaultdict(list)
channel_create_tracker: Dict[int, List[datetime]] = defaultdict(list)
channel_delete_tracker: Dict[int, List[datetime]] = defaultdict(list)
role_create_tracker: Dict[int, List[datetime]] = defaultdict(list)
role_delete_tracker: Dict[int, List[datetime]] = defaultdict(list)
webhook_create_tracker: Dict[int, List[datetime]] = defaultdict(list)
user_warnings: Dict[int, List[Dict]] = defaultdict(list)
user_timeouts: Dict[int, datetime] = {}
bypass_users: Set[int] = set()
locked_channels: Set[int] = set()
locked_server = False

# Protection Toggles
protection_status = {
    'anti_raid': True,
    'anti_spam': True,
    'anti_link': True,
    'anti_mention': True,
    'anti_channel_create': True,
    'anti_channel_delete': True,
    'anti_role_create': True,
    'anti_role_delete': True,
    'anti_webhook': True,
    'anti_bad_words': True,
    'anti_invite': True,
    'anti_scam': True,
    'auto_mod': True
}

# ============================================
# HELPER FUNCTIONS
# ============================================

async def send_log(guild: discord.Guild, title: str, description: str, color: int = 0xff0000, fields: List[tuple] = None):
    """Send log to webhook"""
    if not LOG_WEBHOOK_URL:
        return
    
    try:
        async with aiohttp.ClientSession() as session:
            webhook = discord.Webhook.from_url(LOG_WEBHOOK_URL, session=session)
            embed = discord.Embed(
                title=f"🛡️ {title}",
                description=description,
                color=color,
                timestamp=datetime.utcnow()
            )
            embed.set_footer(text=f"Server: {guild.name} | ID: {guild.id}")
            
            if fields:
                for name, value, inline in fields:
                    embed.add_field(name=name, value=value, inline=inline)
            
            await webhook.send(embed=embed)
    except Exception as e:
        print(f"Log error: {e}")

async def is_owner(ctx):
    """Check if user is bot owner"""
    return ctx.author.id == OWNER_ID

async def is_admin(ctx):
    """Check if user has admin permissions"""
    return ctx.author.guild_permissions.administrator or ctx.author.id == OWNER_ID

async def progressive_punishment(guild: discord.Guild, member: discord.Member, reason: str, ctx=None):
    """Progressive punishment system"""
    warnings = user_warnings[member.id]
    warning_count = len(warnings)
    
    embed = discord.Embed(title="⚠️ Violation Detected", color=0xffaa00, timestamp=datetime.utcnow())
    embed.add_field(name="Member", value=member.mention, inline=True)
    embed.add_field(name="Reason", value=reason, inline=True)
    embed.add_field(name="Warnings", value=f"{warning_count + 1}/{MAX_WARNINGS}", inline=True)
    
    action = "Warning"
    
    if warning_count + 1 >= MAX_WARNINGS:
        await guild.ban(member, reason=f"Reached max warnings: {reason}")
        action = "Permanent Ban"
        color = 0xff0000
    elif warning_count + 1 >= MAX_WARNINGS - 1:
        await member.kick(reason=f"Final warning: {reason}")
        action = "Kick"
        color = 0xff6600
    elif warning_count + 1 >= MAX_WARNINGS - 2:
        await member.timeout(timedelta(minutes=30), reason=reason)
        action = "30 Minute Timeout"
        color = 0xffaa00
    elif warning_count + 1 >= MAX_WARNINGS - 3:
        await member.timeout(timedelta(minutes=10), reason=reason)
        action = "10 Minute Timeout"
        color = 0xffaa00
    else:
        action = f"Warning {warning_count + 1}/{MAX_WARNINGS}"
        color = 0xffcc00
    
    embed.title = f"🛡️ {action}"
    embed.color = color
    embed.description = f"{member.mention} has been punished!"
    
    user_warnings[member.id].append({
        "reason": reason,
        "time": str(datetime.utcnow()),
        "moderator": str(ctx.author) if ctx else "System",
        "action": action
    })
    
    if ctx:
        await ctx.send(embed=embed, delete_after=5)
    
    await send_log(
        guild,
        action,
        f"**Member:** {member.mention}\n**Reason:** {reason}\n**Moderator:** {ctx.author if ctx else 'System'}",
        color
    )

def check_raid(guild_id: int) -> bool:
    """Check if raid is happening"""
    if guild_id not in join_tracker:
        return False
    
    now = datetime.utcnow()
    recent_joins = [j for j in join_tracker[guild_id] if now - j < timedelta(seconds=RAID_JOIN_TIME)]
    
    if len(recent_joins) >= RAID_JOIN_LIMIT:
        return True
    return False

def contains_link(text: str) -> bool:
    """Check if text contains a link"""
    url_pattern = r'https?:\/\/[^\s]+|www\.[^\s]+|[a-zA-Z0-9-]+\.[a-zA-Z]{2,}[\/\w\-?=&%]*'
    discord_invite = r'discord\.gg\/[a-zA-Z0-9]+|discord\.com\/invite\/[a-zA-Z0-9]+|dsc\.gg\/[a-zA-Z0-9]+'
    
    if re.search(url_pattern, text, re.IGNORECASE) or re.search(discord_invite, text, re.IGNORECASE):
        if not BLOCK_ALL_LINKS:
            for domain in ALLOWED_DOMAINS:
                if domain in text.lower():
                    return False
        for domain in BLOCKED_DOMAINS:
            if domain in text.lower():
                return True
        return True
    return False

def contains_bad_word(text: str) -> bool:
    """Check if text contains bad words"""
    text_lower = text.lower()
    for word in BAD_WORDS:
        if word in text_lower:
            return True
    return False

def contains_scam(text: str) -> bool:
    """Check if text contains scam patterns"""
    text_lower = text.lower()
    for pattern in SCAM_PATTERNS:
        if re.search(pattern, text_lower):
            return True
    return False

def contains_invite(text: str) -> bool:
    """Check if text contains Discord invite"""
    invite_patterns = [
        r'discord\.gg\/[a-zA-Z0-9]+',
        r'discord\.com\/invite\/[a-zA-Z0-9]+',
        r'discordapp\.com\/invite\/[a-zA-Z0-9]+',
        r'dsc\.gg\/[a-zA-Z0-9]+'
    ]
    for pattern in invite_patterns:
        if re.search(pattern, text, re.IGNORECASE):
            return True
    return False

def check_spam(user_id: int) -> bool:
    """Check if user is spamming"""
    now = datetime.utcnow()
    if user_id not in message_tracker:
        message_tracker[user_id] = []
    
    message_tracker[user_id] = [t for t in message_tracker[user_id] if now - t < timedelta(seconds=SPAM_TIME_SECONDS)]
    message_tracker[user_id].append(now)
    
    return len(message_tracker[user_id]) >= SPAM_LIMIT

def count_mentions(message: discord.Message) -> int:
    """Count mentions in message"""
    return len(message.mentions) + len(message.role_mentions) + len(message.mention_everyone)

# ============================================
# COMMANDS - HELP
# ============================================

@bot.command(name='help')
async def help_command(ctx):
    """Show all commands"""
    embed = discord.Embed(
        title="🛡️ Advanced Protection Bot - Command List",
        description="Complete security system with `-` prefix",
        color=0x2F3136,
        timestamp=datetime.utcnow()
    )
    
    # Protection Commands
    embed.add_field(
        name="🛡️ Protection Commands",
        value="```\n"
              "-protection status - Show protection status\n"
              "-protection toggle <module> - Enable/disable protection\n"
              "-antiraid <on/off> - Toggle raid protection\n"
              "-antispam <on/off> - Toggle spam protection\n"
              "-antilink <on/off> - Toggle link protection\n"
              "-antiping <on/off> - Toggle mass ping protection\n"
              "```",
        inline=False
    )
    
    # Moderation Commands
    embed.add_field(
        name="👮 Moderation Commands",
        value="```\n"
              "-ban <user> [reason] - Ban user\n"
              "-kick <user> [reason] - Kick user\n"
              "-mute <user> [minutes] [reason] - Mute user\n"
              "-unmute <user> - Unmute user\n"
              "-warn <user> <reason> - Warn user\n"
              "-warnings <user> - View user warnings\n"
              "-clearwarns <user> - Clear user warnings\n"
              "-clear <amount> - Clear messages (1-100)\n"
              "-lock - Lock current channel\n"
              "-unlock - Unlock current channel\n"
              "-slowmode <seconds> - Set slowmode\n"
              "-lockdown - Lock entire server\n"
              "-unlockdown - Unlock entire server\n"
              "```",
        inline=False
    )
    
    # Utility Commands
    embed.add_field(
        name="📊 Utility Commands",
        value="```\n"
              "-userinfo [user] - Get user information\n"
              "-serverinfo - Get server information\n"
              "-avatar [user] - Get user avatar\n"
              "-ping - Check bot latency\n"
              "-stats - Bot statistics\n"
              "-invite - Bot invite link\n"
              "```",
        inline=False
    )
    
    # Admin Commands
    embed.add_field(
        name="⚙️ Admin Commands",
        value="```\n"
              "-bypass add <user> - Add user to bypass list\n"
              "-bypass remove <user> - Remove user from bypass\n"
              "-bypass list - List bypassed users\n"
              "-backup roles - Backup current roles\n"
              "-restore roles - Restore roles backup\n"
              "-addword <word> - Add bad word to filter\n"
              "-removeword <word> - Remove bad word\n"
              "-wordlist - Show bad words list\n"
              "-config show - Show current configuration\n"
              "-config set <key> <value> - Change configuration\n"
              "```",
        inline=False
    )
    
    embed.set_footer(text=f"Requested by {ctx.author.name} | Total Commands: 40+")
    embed.set_thumbnail(url=ctx.guild.icon.url if ctx.guild.icon else None)
    
    await ctx.send(embed=embed)

# ============================================
# PROTECTION COMMANDS
# ============================================

@bot.command(name='protection')
async def protection_command(ctx, action: str = None, module: str = None):
    """Manage protection modules"""
    if not await is_admin(ctx):
        return await ctx.send("❌ You need administrator permissions!")
    
    if action == 'status':
        embed = discord.Embed(title="🛡️ Protection Status", color=0x2F3136, timestamp=datetime.utcnow())
        
        status_emojis = {True: "✅", False: "❌"}
        for name, status in protection_status.items():
            formatted_name = name.replace('_', ' ').title()
            embed.add_field(name=formatted_name, value=status_emojis[status], inline=True)
        
        await ctx.send(embed=embed)
    
    elif action == 'toggle' and module:
        module_key = module.lower().replace('-', '_')
        if module_key in protection_status:
            protection_status[module_key] = not protection_status[module_key]
            state = "enabled" if protection_status[module_key] else "disabled"
            await ctx.send(f"✅ **{module.title()}** protection has been **{state}**!")
            await send_log(ctx.guild, "Protection Toggled", f"**Module:** {module}\n**Status:** {state}", 0x00ff00)
        else:
            available = "\n".join([f"• {m.replace('_', '-')}" for m in protection_status.keys()])
            await ctx.send(f"❌ Invalid module! Available modules:\n{available}")
    
    else:
        await ctx.send("Usage:\n`-protection status` - Show status\n`-protection toggle <module>` - Toggle protection")

# Individual protection toggles
@bot.command(name='antiraid')
async def anti_raid(ctx, state: str):
    if await is_admin(ctx):
        protection_status['anti_raid'] = state.lower() == 'on'
        await ctx.send(f"🛡️ Anti-Raid protection: **{state.upper()}**")

@bot.command(name='antispam')
async def anti_spam(ctx, state: str):
    if await is_admin(ctx):
        protection_status['anti_spam'] = state.lower() == 'on'
        await ctx.send(f"🛡️ Anti-Spam protection: **{state.upper()}**")

@bot.command(name='antilink')
async def anti_link(ctx, state: str):
    if await is_admin(ctx):
        protection_status['anti_link'] = state.lower() == 'on'
        await ctx.send(f"🔗 Anti-Link protection: **{state.upper()}**")

@bot.command(name='antiping')
async def anti_ping(ctx, state: str):
    if await is_admin(ctx):
        protection_status['anti_mention'] = state.lower() == 'on'
        await ctx.send(f"📢 Anti-Mass Ping protection: **{state.upper()}**")

# ============================================
# MODERATION COMMANDS
# ============================================

@bot.command(name='ban')
@commands.has_permissions(ban_members=True)
async def ban_command(ctx, member: discord.Member, *, reason: str = "No reason provided"):
    """Ban a member"""
    await member.ban(reason=reason)
    embed = discord.Embed(title="🔨 User Banned", color=0xff0000, timestamp=datetime.utcnow())
    embed.add_field(name="Member", value=f"{member.mention} ({member.id})", inline=True)
    embed.add_field(name="Moderator", value=ctx.author.mention, inline=True)
    embed.add_field(name="Reason", value=reason, inline=False)
    await ctx.send(embed=embed)
    await send_log(ctx.guild, "Member Banned", f"**Member:** {member.mention}\n**Moderator:** {ctx.author.mention}\n**Reason:** {reason}", 0xff0000)

@bot.command(name='kick')
@commands.has_permissions(kick_members=True)
async def kick_command(ctx, member: discord.Member, *, reason: str = "No reason provided"):
    """Kick a member"""
    await member.kick(reason=reason)
    embed = discord.Embed(title="👢 User Kicked", color=0xff6600, timestamp=datetime.utcnow())
    embed.add_field(name="Member", value=f"{member.mention} ({member.id})", inline=True)
    embed.add_field(name="Moderator", value=ctx.author.mention, inline=True)
    embed.add_field(name="Reason", value=reason, inline=False)
    await ctx.send(embed=embed)
    await send_log(ctx.guild, "Member Kicked", f"**Member:** {member.mention}\n**Moderator:** {ctx.author.mention}\n**Reason:** {reason}", 0xff6600)

@bot.command(name='mute')
@commands.has_permissions(moderate_members=True)
async def mute_command(ctx, member: discord.Member, minutes: int = 10, *, reason: str = "No reason provided"):
    """Mute a member"""
    duration = timedelta(minutes=minutes)
    await member.timeout(duration, reason=reason)
    embed = discord.Embed(title="🔇 User Muted", color=0xffaa00, timestamp=datetime.utcnow())
    embed.add_field(name="Member", value=member.mention, inline=True)
    embed.add_field(name="Duration", value=f"{minutes} minutes", inline=True)
    embed.add_field(name="Reason", value=reason, inline=False)
    await ctx.send(embed=embed)

@bot.command(name='unmute')
@commands.has_permissions(moderate_members=True)
async def unmute_command(ctx, member: discord.Member):
    """Unmute a member"""
    await member.timeout(None)
    await ctx.send(f"✅ {member.mention} has been unmuted!")

@bot.command(name='warn')
@commands.has_permissions(kick_members=True)
async def warn_command(ctx, member: discord.Member, *, reason: str):
    """Warn a member"""
    await progressive_punishment(ctx.guild, member, reason, ctx)
    await send_log(ctx.guild, "Warning Issued", f"**Member:** {member.mention}\n**Reason:** {reason}\n**Moderator:** {ctx.author.mention}", 0xffcc00)

@bot.command(name='warnings')
async def warnings_command(ctx, member: discord.Member = None):
    """View warnings for a member"""
    member = member or ctx.author
    warns = user_warnings.get(member.id, [])
    
    if not warns:
        return await ctx.send(f"✅ {member.mention} has no warnings!")
    
    embed = discord.Embed(title=f"⚠️ Warnings for {member.name}", color=0xffaa00, timestamp=datetime.utcnow())
    for i, warn in enumerate(warns[:10], 1):
        embed.add_field(
            name=f"Warning #{i}",
            value=f"**Reason:** {warn['reason']}\n**Date:** {warn['time']}\n**Moderator:** {warn['moderator']}",
            inline=False
        )
    
    await ctx.send(embed=embed)

@bot.command(name='clearwarns')
@commands.has_permissions(administrator=True)
async def clear_warns(ctx, member: discord.Member):
    """Clear all warnings for a member"""
    if member.id in user_warnings:
        del user_warnings[member.id]
        await ctx.send(f"✅ Cleared all warnings for {member.mention}")
    else:
        await ctx.send(f"ℹ️ {member.mention} has no warnings")

@bot.command(name='clear')
@commands.has_permissions(manage_messages=True)
async def clear_command(ctx, amount: int):
    """Clear messages in channel"""
    if amount < 1 or amount > 100:
        return await ctx.send("❌ Amount must be between 1 and 100!")
    
    deleted = await ctx.channel.purge(limit=amount + 1)
    msg = await ctx.send(f"✅ Deleted {len(deleted) - 1} messages!")
    await msg.delete(delay=3)

@bot.command(name='lock')
@commands.has_permissions(manage_channels=True)
async def lock_command(ctx, channel: discord.TextChannel = None):
    """Lock a channel"""
    channel = channel or ctx.channel
    await channel.set_permissions(ctx.guild.default_role, send_messages=False)
    locked_channels.add(channel.id)
    await ctx.send(f"🔒 {channel.mention} has been locked!")

@bot.command(name='unlock')
@commands.has_permissions(manage_channels=True)
async def unlock_command(ctx, channel: discord.TextChannel = None):
    """Unlock a channel"""
    channel = channel or ctx.channel
    await channel.set_permissions(ctx.guild.default_role, send_messages=None)
    locked_channels.discard(channel.id)
    await ctx.send(f"🔓 {channel.mention} has been unlocked!")

@bot.command(name='slowmode')
@commands.has_permissions(manage_channels=True)
async def slowmode_command(ctx, seconds: int):
    """Set slowmode for channel"""
    if seconds < 0 or seconds > 21600:
        return await ctx.send("❌ Slowmode must be between 0 and 21600 seconds!")
    
    await ctx.channel.edit(slowmode_delay=seconds)
    if seconds == 0:
        await ctx.send(f"✅ Slowmode has been disabled!")
    else:
        await ctx.send(f"🐢 Slowmode set to {seconds} seconds!")

@bot.command(name='lockdown')
@commands.has_permissions(administrator=True)
async def lockdown_command(ctx):
    """Lockdown entire server"""
    global locked_server
    
    for channel in ctx.guild.channels:
        try:
            await channel.set_permissions(ctx.guild.default_role, send_messages=False)
        except:
            pass
    
    locked_server = True
    await ctx.send("🔒 **SERVER LOCKDOWN ACTIVATED!** All channels locked.")
    await send_log(ctx.guild, "Server Lockdown", f"**Moderator:** {ctx.author.mention}\nAll channels have been locked!", 0xff0000)

@bot.command(name='unlockdown')
@commands.has_permissions(administrator=True)
async def unlockdown_command(ctx):
    """Unlock entire server"""
    global locked_server
    
    for channel in ctx.guild.channels:
        try:
            await channel.set_permissions(ctx.guild.default_role, send_messages=None)
        except:
            pass
    
    locked_server = False
    await ctx.send("🔓 **SERVER LOCKDOWN DEACTIVATED!** All channels unlocked.")
    await send_log(ctx.guild, "Server Unlocked", f"**Moderator:** {ctx.author.mention}\nAll channels have been unlocked!", 0x00ff00)

# ============================================
# UTILITY COMMANDS
# ============================================

@bot.command(name='userinfo')
async def user_info(ctx, member: discord.Member = None):
    """Get user information"""
    member = member or ctx.author
    
    embed = discord.Embed(title=f"👤 User Info: {member.name}", color=member.color, timestamp=datetime.utcnow())
    embed.set_thumbnail(url=member.avatar.url if member.avatar else member.default_avatar.url)
    embed.add_field(name="ID", value=member.id, inline=True)
    embed.add_field(name="Bot", value="Yes" if member.bot else "No", inline=True)
    embed.add_field(name="Joined Server", value=member.joined_at.strftime("%Y-%m-%d %H:%M:%S"), inline=False)
    embed.add_field(name="Joined Discord", value=member.created_at.strftime("%Y-%m-%d %H:%M:%S"), inline=False)
    embed.add_field(name="Roles", value=", ".join([r.mention for r in member.roles[1:10]]) or "None", inline=False)
    
    await ctx.send(embed=embed)

@bot.command(name='serverinfo')
async def server_info(ctx):
    """Get server information"""
    guild = ctx.guild
    
    embed = discord.Embed(title=f"📡 Server Info: {guild.name}", color=0x2F3136, timestamp=datetime.utcnow())
    if guild.icon:
        embed.set_thumbnail(url=guild.icon.url)
    
    embed.add_field(name="Owner", value=guild.owner.mention, inline=True)
    embed.add_field(name="ID", value=guild.id, inline=True)
    embed.add_field(name="Created", value=guild.created_at.strftime("%Y-%m-%d"), inline=True)
    embed.add_field(name="Members", value=guild.member_count, inline=True)
    embed.add_field(name="Channels", value=len(guild.channels), inline=True)
    embed.add_field(name="Roles", value=len(guild.roles), inline=True)
    embed.add_field(name="Boost Level", value=guild.premium_tier, inline=True)
    embed.add_field(name="Boost Count", value=guild.premium_subscription_count or 0, inline=True)
    
    await ctx.send(embed=embed)

@bot.command(name='avatar')
async def avatar_command(ctx, member: discord.Member = None):
    """Get user avatar"""
    member = member or ctx.author
    
    embed = discord.Embed(title=f"🖼️ Avatar: {member.name}", color=member.color)
    embed.set_image(url=member.avatar.url if member.avatar else member.default_avatar.url)
    embed.set_footer(text=f"Requested by {ctx.author.name}")
    
    await ctx.send(embed=embed)

@bot.command(name='ping')
async def ping_command(ctx):
    """Check bot latency"""
    latency = round(bot.latency * 1000)
    embed = discord.Embed(title="🏓 Pong!", description=f"Latency: **{latency}ms**", color=0x00ff00)
    await ctx.send(embed=embed)

@bot.command(name='stats')
async def stats_command(ctx):
    """Bot statistics"""
    embed = discord.Embed(title="📊 Bot Statistics", color=0x2F3136, timestamp=datetime.utcnow())
    embed.add_field(name="Servers", value=len(bot.guilds), inline=True)
    embed.add_field(name="Users", value=sum(g.member_count for g in bot.guilds), inline=True)
    embed.add_field(name="Latency", value=f"{round(bot.latency * 1000)}ms", inline=True)
    embed.add_field(name="Commands", value="40+", inline=True)
    embed.add_field(name="Protections", value="12+", inline=True)
    embed.add_field(name="Uptime", value="Online", inline=True)
    
    await ctx.send(embed=embed)

@bot.command(name='invite')
async def invite_command(ctx):
    """Bot invite link"""
    invite_url = f"https://discord.com/oauth2/authorize?client_id={CLIENT_ID}&permissions=8&scope=bot+applications.commands"
    
    embed = discord.Embed(title="🔗 Invite Bot", description=f"[Click here to invite me!]({invite_url})", color=0x00ff00)
    embed.add_field(name="Permissions", value="Administrator (Full Access)", inline=False)
    
    await ctx.send(embed=embed)

# ============================================
# ADMIN COMMANDS
# ============================================

@bot.command(name='bypass')
@commands.has_permissions(administrator=True)
async def bypass_command(ctx, action: str, member: discord.Member = None):
    """Manage bypass list"""
    if action == 'add' and member:
        bypass_users.add(member.id)
        await ctx.send(f"✅ {member.mention} has been added to bypass list!")
    elif action == 'remove' and member:
        bypass_users.discard(member.id)
        await ctx.send(f"✅ {member.mention} has been removed from bypass list!")
    elif action == 'list':
        if bypass_users:
            users = []
            for uid in bypass_users:
                user = await bot.fetch_user(uid)
                users.append(f"• {user.name} ({uid})")
            await ctx.send(f"**Bypassed Users:**\n" + "\n".join(users))
        else:
            await ctx.send("No users in bypass list!")
    else:
        await ctx.send("Usage:\n`-bypass add <user>`\n`-bypass remove <user>`\n`-bypass list`")

@bot.command(name='addword')
@commands.has_permissions(administrator=True)
async def add_bad_word(ctx, *, word: str):
    """Add word to bad words filter"""
    if word.lower() not in BAD_WORDS:
        BAD_WORDS.append(word.lower())
        await ctx.send(f"✅ Added `{word}` to bad words list!")
    else:
        await ctx.send(f"❌ `{word}` is already in the list!")

@bot.command(name='removeword')
@commands.has_permissions(administrator=True)
async def remove_bad_word(ctx, *, word: str):
    """Remove word from bad words filter"""
    if word.lower() in BAD_WORDS:
        BAD_WORDS.remove(word.lower())
        await ctx.send(f"✅ Removed `{word}` from bad words list!")
    else:
        await ctx.send(f"❌ `{word}` not found in bad words list!")

@bot.command(name='wordlist')
async def wordlist_command(ctx):
    """Show bad words list"""
    if BAD_WORDS:
        words = "\n".join([f"• {w}" for w in BAD_WORDS[:25]])
        await ctx.send(f"**Bad Words List:**\n{words}")
    else:
        await ctx.send("No bad words configured!")

# ============================================
# EVENTS - PROTECTION SYSTEM
# ============================================

@bot.event
async def on_ready():
    """Bot ready event"""
    print(f"✅ {bot.user} is online!")
    print(f"📊 Protecting {len(bot.guilds)} servers!")
    print(f"🔗 Invite URL: https://discord.com/oauth2/authorize?client_id={CLIENT_ID}&permissions=8&scope=bot")
    
    # Set status
    await bot.change_presence(activity=discord.Activity(
        type=discord.ActivityType.watching,
        name=f"{len(bot.guilds)} servers | -help"
    ))

@bot.event
async def on_member_join(member: discord.Member):
    """Anti-raid protection"""
    if not protection_status['anti_raid']:
        return
    
    if member.id == OWNER_ID or member.id in bypass_users:
        return
    
    guild_id = member.guild.id
    now = datetime.utcnow()
    join_tracker[guild_id].append(now)
    join_tracker[guild_id] = [j for j in join_tracker[guild_id] if now - j < timedelta(seconds=RAID_JOIN_TIME)]
    
    if check_raid(guild_id):
        await member.guild.set_permissions(member.guild.default_role, send_messages=False)
        await send_log(member.guild, "⚠️ RAID DETECTED!", f"**{len(join_tracker[guild_id])}** members joined in {RAID_JOIN_TIME} seconds!\nServer has been locked down!", 0xff0000)
        
        for channel in member.guild.channels:
            try:
                await channel.set_permissions(member.guild.default_role, send_messages=False)
            except:
                pass

@bot.event
async def on_message(message: discord.Message):
    """Message protection system"""
    if message.author.bot:
        await bot.process_commands(message)
        return
    
    # Skip bypass users and owner
    if message.author.id == OWNER_ID or message.author.id in bypass_users:
        await bot.process_commands(message)
        return
    
    # Check locked channels
    if message.channel.id in locked_channels or locked_server:
        await message.delete()
        return
    
    guild = message.guild
    
    # Anti-Spam
    if protection_status['anti_spam'] and check_spam(message.author.id):
        await message.delete()
        await progressive_punishment(guild, message.author, "Spamming messages", await ctx)
        return
    
    # Check mass mentions
    if protection_status['anti_mention']:
        mention_count = count_mentions(message)
        if mention_count >= MASS_MENTION_LIMIT:
            await message.delete()
            await progressive_punishment(guild, message.author, f"Mass mention ({mention_count} mentions)", await ctx)
            return
    
    # Check for links
    if protection_status['anti_link'] and contains_link(message.content):
        await message.delete()
        await progressive_punishment(guild, message.author, "Sending prohibited links", await ctx)
        return
    
    # Check for bad words
    if protection_status['anti_bad_words'] and FILTER_BAD_WORDS and contains_bad_word(message.content):
        await message.delete()
        await progressive_punishment(guild, message.author, "Using inappropriate language", await ctx)
        return
    
    # Check for invites
    if protection_status['anti_invite'] and FILTER_INVITES and contains_invite(message.content):
        await message.delete()
        await progressive_punishment(guild, message.author, "Sending Discord invites", await ctx)
        return
    
    # Check for scam links
    if protection_status['anti_scam'] and FILTER_SCAM_LINKS and contains_scam(message.content):
        await message.delete()
        await progressive_punishment(guild, message.author, "Sending scam links", await ctx)
        return
    
    await bot.process_commands(message)

@bot.event
async def on_guild_channel_create(channel: discord.TextChannel):
    """Anti-mass channel creation"""
    if not protection_status['anti_channel_create']:
        return
    
    async for entry in channel.guild.audit_logs(limit=1, action=discord.AuditLogAction.channel_create):
        user = entry.user
        if user.id == OWNER_ID or user.id == bot.user.id or user.id in bypass_users:
            return
        
        now = datetime.utcnow()
        channel_create_tracker[user.id].append(now)
        channel_create_tracker[user.id] = [c for c in channel_create_tracker[user.id] if now - c < timedelta(seconds=10)]
        
        if len(channel_create_tracker[user.id]) >= MAX_CHANNEL_CREATE_LIMIT:
            await channel.guild.ban(user, reason=f"Mass channel creation ({len(channel_create_tracker[user.id])} channels)")
            await send_log(channel.guild, "🚨 Mass Channel Creation", f"**User:** {user.mention}\n**Action:** Banned for creating {len(channel_create_tracker[user.id])} channels", 0xff0000)
        break

@bot.event
async def on_guild_channel_delete(channel: discord.TextChannel):
    """Anti-mass channel deletion"""
    if not protection_status['anti_channel_delete']:
        return
    
    async for entry in channel.guild.audit_logs(limit=1, action=discord.AuditLogAction.channel_delete):
        user = entry.user
        if user.id == OWNER_ID or user.id == bot.user.id or user.id in bypass_users:
            return
        
        now = datetime.utcnow()
        channel_delete_tracker[user.id].append(now)
        channel_delete_tracker[user.id] = [c for c in channel_delete_tracker[user.id] if now - c < timedelta(seconds=10)]
        
        if len(channel_delete_tracker[user.id]) >= MAX_CHANNEL_DELETE_LIMIT:
            await channel.guild.ban(user, reason=f"Mass channel deletion ({len(channel_delete_tracker[user.id])} channels)")
            await send_log(channel.guild, "🚨 Mass Channel Deletion", f"**User:** {user.mention}\n**Action:** Banned for deleting {len(channel_delete_tracker[user.id])} channels", 0xff0000)
        break

@bot.event
async def on_guild_role_create(role: discord.Role):
    """Anti-mass role creation"""
    if not protection_status['anti_role_create']:
        return
    
    async for entry in role.guild.audit_logs(limit=1, action=discord.AuditLogAction.role_create):
        user = entry.user
        if user.id == OWNER_ID or user.id == bot.user.id or user.id in bypass_users:
            return
        
        now = datetime.utcnow()
        role_create_tracker[user.id].append(now)
        role_create_tracker[user.id] = [r for r in role_create_tracker[user.id] if now - r < timedelta(seconds=10)]
        
        if len(role_create_tracker[user.id]) >= MAX_ROLE_CREATE_LIMIT:
            await role.guild.ban(user, reason=f"Mass role creation ({len(role_create_tracker[user.id])} roles)")
            await send_log(role.guild, "🚨 Mass Role Creation", f"**User:** {user.mention}\n**Action:** Banned for creating {len(role_create_tracker[user.id])} roles", 0xff0000)
        break

@bot.event
async def on_guild_role_delete(role: discord.Role):
    """Anti-mass role deletion"""
    if not protection_status['anti_role_delete']:
        return
    
    async for entry in role.guild.audit_logs(limit=1, action=discord.AuditLogAction.role_delete):
        user = entry.user
        if user.id == OWNER_ID or user.id == bot.user.id or user.id in bypass_users:
            return
        
        now = datetime.utcnow()
        role_delete_tracker[user.id].append(now)
        role_delete_tracker[user.id] = [r for r in role_delete_tracker[user.id] if now - r < timedelta(seconds=10)]
        
        if len(role_delete_tracker[user.id]) >= MAX_ROLE_DELETE_LIMIT:
            await role.guild.ban(user, reason=f"Mass role deletion ({len(role_delete_tracker[user.id])} roles)")
            await send_log(role.guild, "🚨 Mass Role Deletion", f"**User:** {user.mention}\n**Action:** Banned for deleting {len(role_delete_tracker[user.id])} roles", 0xff0000)
        break

@bot.event
async def on_webhook_update(webhook: discord.Webhook):
    """Anti-webhook abuse"""
    if not protection_status['anti_webhook']:
        return
    
    async for entry in webhook.guild.audit_logs(limit=1, action=discord.AuditLogAction.webhook_create):
        user = entry.user
        if user.id == OWNER_ID or user.id == bot.user.id or user.id in bypass_users:
            return
        
        now = datetime.utcnow()
        webhook_create_tracker[user.id].append(now)
        webhook_create_tracker[user.id] = [w for w in webhook_create_tracker[user.id] if now - w < timedelta(seconds=30)]
        
        if len(webhook_create_tracker[user.id]) >= MAX_WEBHOOK_CREATE_LIMIT:
            await webhook.guild.ban(user, reason=f"Mass webhook creation ({len(webhook_create_tracker[user.id])} webhooks)")
            await send_log(webhook.guild, "🚨 Mass Webhook Creation", f"**User:** {user.mention}\n**Action:** Banned for creating {len(webhook_create_tracker[user.id])} webhooks", 0xff0000)
        break

# ============================================
# ERROR HANDLING
# ============================================

@bot.event
async def on_command_error(ctx, error):
    """Command error handler"""
    if isinstance(error, commands.MissingPermissions):
        await ctx.send("❌ You don't have permission to use this command!", delete_after=5)
    elif isinstance(error, commands.MissingRequiredArgument):
        await ctx.send(f"❌ Missing required argument!\nUsage: `{ctx.prefix}{ctx.command.name} {ctx.command.signature}`", delete_after=5)
    elif isinstance(error, commands.BadArgument):
        await ctx.send("❌ Invalid argument provided!", delete_after=5)
    elif isinstance(error, commands.CommandNotFound):
        pass  # Ignore command not found
    else:
        print(f"Error: {error}")
        await ctx.send(f"❌ An error occurred: {str(error)[:100]}", delete_after=5)

# ============================================
# RUN BOT
# ============================================

if __name__ == "__main__":
    print("🚀 Starting Advanced Protection Bot...")
    print(f"🤖 Client ID: {CLIENT_ID}")
    print(f"👑 Owner ID: {OWNER_ID}")
    print(f"🔗 Invite URL: https://discord.com/oauth2/authorize?client_id={CLIENT_ID}&permissions=8&scope=bot")
    bot.run(BOT_TOKEN)
