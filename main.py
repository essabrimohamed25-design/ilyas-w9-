import discord
from discord.ext import commands, tasks
from discord import app_commands
from datetime import datetime, timedelta
import asyncio
import aiohttp
import re
import json
from typing import Optional, List, Dict, Set
from collections import defaultdict

from config import *
from cogs.security import SecurityCog

# =========================
# BOT SETUP
# =========================

intents = discord.Intents.all()
bot = commands.Bot(command_prefix="/", intents=intents)
tree = bot.tree

# =========================
# DATA STRUCTURES
# =========================

protections = {
    "Anti Spam": True,
    "Anti Links": True,
    "Anti Script": True,
    "Anti Bot": True,
    "Anti Raid": True,
    "Anti Sabotage": True,
    "Commands Log": True,
    "Anti Mass Delete": True,
    "Anti Mass Create": True
}

spam_tracker: Dict[int, List[float]] = {}
raid_tracker: Dict[int, List[float]] = defaultdict(list)
mass_delete_tracker: Dict[int, List[float]] = defaultdict(list)
mass_create_tracker: Dict[int, List[float]] = defaultdict(list)
bypass_users: Set[int] = set()
blacklisted_words: Set[str] = set()
member_warnings: Dict[int, List[Dict]] = defaultdict(list)
member_roles_backup: Dict[int, List[int]] = {}
slowmode_channels: Set[int] = set()
locked_channels: Set[int] = set()

# =========================
# HELPER FUNCTIONS
# =========================

async def send_log(title: str, description: str, color: int = 0xff0000, file: discord.File = None):
    """Send log to webhook"""
    try:
        async with aiohttp.ClientSession() as session:
            webhook = discord.Webhook.from_url(LOG_WEBHOOK_URL, session=session)
            embed = discord.Embed(title=title, description=description, color=color, timestamp=datetime.utcnow())
            embed.set_footer(text="🛡️ Miramar Security System")
            await webhook.send(embed=embed, file=file)
    except Exception as e:
        print(f"Log error: {e}")

async def send_command_log(ctx, command_name: str, result: str):
    """Log commands to webhook"""
    if not protections["Commands Log"]:
        return
    try:
        async with aiohttp.ClientSession() as session:
            webhook = discord.Webhook.from_url(COMMAND_WEBHOOK_URL, session=session)
            embed = discord.Embed(title="📁 Command Log", color=0x00ff00, timestamp=datetime.utcnow())
            embed.add_field(name="👤 User", value=f"{ctx.author.mention}\n`{ctx.author.id}`", inline=False)
            embed.add_field(name="📄 Command", value=f"`{command_name}`", inline=False)
            embed.add_field(name="📊 Result", value=result, inline=False)
            await webhook.send(embed=embed)
    except Exception as e:
        print(f"Command log error: {e}")

async def check_owner(interaction: discord.Interaction):
    """Check if user is bot owner"""
    if interaction.user.id != OWNER_ID:
        embed = discord.Embed(title="❌ Access Denied", description="⛔ هذا الأمر مخصص لمالك البوت فقط!", color=0xff0000)
        await interaction.response.send_message(embed=embed, ephemeral=True)
        return False
    return True

async def progressive_punishment(guild, member, reason: str, ctx=None):
    """Progressive punishment system"""
    warnings = member_warnings[member.id]
    warning_count = len(warnings)
    
    embed = discord.Embed(title="⚠️ مخالفة جديدة", color=0xffaa00, timestamp=datetime.utcnow())
    embed.add_field(name="👤 العضو", value=member.mention, inline=True)
    embed.add_field(name="📋 السبب", value=reason, inline=True)
    embed.add_field(name="📊 عدد التحذيرات", value=f"`{warning_count + 1}/{MAX_WARNINGS_BEFORE_BAN}`", inline=True)
    
    if warning_count + 1 >= MAX_WARNINGS_BEFORE_BAN:
        await guild.ban(member, reason=f"تجاوز الحد الأقصى للتحذيرات: {reason}")
        embed.title = "🔨 حظر دائم"
        embed.color = 0xff0000
        embed.description = f"تم حظر {member.mention} بشكل دائم!"
        await send_log("🔨 Permanent Ban", f"{member.mention} تم حظره بسبب: {reason}", color=0xff0000)
        
    elif warning_count + 1 >= 3:
        await member.kick(reason=f"التحذير الثالث: {reason}")
        embed.title = "👢 طرد"
        embed.color = 0xff6600
        embed.description = f"تم طرد {member.mention} من السيرفر!"
        await send_log("👢 Member Kicked", f"{member.mention} تم طرده بسبب: {reason}", color=0xff6600)
        
    elif warning_count + 1 >= 2:
        if member.id not in member_roles_backup:
            member_roles_backup[member.id] = [role.id for role in member.roles if role.name != "@everyone"]
        await member.timeout(timedelta(minutes=10), reason=reason)
        embed.title = "🔇 تايم أوت"
        embed.color = 0xffaa00
        embed.description = f"تم إعطاء {member.mention} تايم أوت 10 دقائق!"
        await send_log("🔇 Timeout", f"{member.mention} أخذ تايم أوت بسبب: {reason}", color=0xffaa00)
    else:
        embed.title = "⚠️ تحذير"
        embed.color = 0xffff00
        embed.description = f"{member.mention} تم تسجيل مخالفة ضده!"
        await send_log("⚠️ Warning", f"{member.mention} أخذ تحذير بسبب: {reason}", color=0xffff00)
    
    member_warnings[member.id].append({
        "reason": reason, 
        "time": str(datetime.utcnow()), 
        "moderator": str(ctx.author) if ctx else "System"
    })
    
    if ctx:
        await ctx.send(embed=embed)

# =========================
# ON READY
# =========================

@bot.event
async def on_ready():
    # Load security cog
    await bot.add_cog(SecurityCog(bot, protections, spam_tracker, raid_tracker, mass_delete_tracker, 
                                   mass_create_tracker, bypass_users, blacklisted_words, member_warnings,
                                   member_roles_backup, slowmode_channels, locked_channels))
    
    try:
        synced = await bot.tree.sync()
        print(f"✅ Synced {len(synced)} slash commands")
    except Exception as e:
        print(f"Sync error: {e}")
    
    print(f"✅ {bot.user} is ready!")
    print(f"✅ Owner ID: {OWNER_ID}")
    print(f"✅ Client ID: {CLIENT_ID}")
    print(f"✅ Protected servers: {len(bot.guilds)}")
    print(f"✅ Invite URL: {get_invite_url()}")
    status_task.start()

@tasks.loop(seconds=10)
async def status_task():
    """Auto-rotate bot status"""
    await bot.change_presence(activity=discord.Activity(
        type=discord.ActivityType.watching, 
        name=f"{len(bot.guilds)} servers | /miramar"
    ))

# =========================
# DASHBOARD COMMAND
# =========================

@bot.tree.command(name="miramar", description="🛡️ لوحة تحكم البوت")
async def miramar_dashboard(interaction: discord.Interaction):
    if interaction.user.id != OWNER_ID:
        embed = discord.Embed(title="❌ Access Denied", description="هذا الأمر مخصص لمالك البوت فقط!", color=0xff0000)
        await interaction.response.send_message(embed=embed, ephemeral=True)
        return
    
    embed = discord.Embed(title="🛡️ Miramar Security Dashboard", 
                          description="**متقدم | سريع | شامل**", 
                          color=0x2F3136, 
                          timestamp=datetime.utcnow())
    
    for name, status in protections.items():
        state = "🟢 مفعل" if status else "🔴 معطل"
        embed.add_field(name=name, value=state, inline=True)
    
    embed.add_field(name="📊 إحصائيات السيرفر", 
                    value=f"👥 الأعضاء: {interaction.guild.member_count}\n📁 الرومات: {len(interaction.guild.channels)}\n🎭 الرتب: {len(interaction.guild.roles)}", 
                    inline=False)
    embed.add_field(name="⚙️ إعدادات", 
                    value=f"⚠️ الحد الأقصى للتحذيرات: {MAX_WARNINGS_BEFORE_BAN}\n📡 حد الريد: {RAID_LIMIT} خلال {RAID_TIME} ثانية", 
                    inline=False)
    embed.set_footer(text=f"البوت يحمي {len(bot.guilds)} سيرفر")
    
    await interaction.response.send_message(embed=embed)

# =========================
# TOGGLE COMMANDS
# =========================

@bot.tree.command(name="anti_spam", description="تفعيل/تعطيل نظام مكافحة السبام")
@app_commands.describe(mode="on أو off")
async def anti_spam(interaction: discord.Interaction, mode: str):
    if not await check_owner(interaction):
        return
    protections["Anti Spam"] = mode.lower() == "on"
    state = "مفعل 🟢" if protections["Anti Spam"] else "معطل 🔴"
    await interaction.response.send_message(f"🛡️ نظام مكافحة السبام: {state}")
    await send_log("🛡️ Anti Spam", f"تم {state} النظام", color=0x00ff00)

@bot.tree.command(name="anti_links", description="تفعيل/تعطيل نظام منع الروابط")
@app_commands.describe(mode="on أو off")
async def anti_links(interaction: discord.Interaction, mode: str):
    if not await check_owner(interaction):
        return
    protections["Anti Links"] = mode.lower() == "on"
    state = "مفعل 🟢" if protections["Anti Links"] else "معطل 🔴"
    await interaction.response.send_message(f"🔗 نظام منع الروابط: {state}")

@bot.tree.command(name="anti_raid", description="تفعيل/تعطيل نظام مكافحة الريد")
@app_commands.describe(mode="on أو off")
async def anti_raid(interaction: discord.Interaction, mode: str):
    if not await check_owner(interaction):
        return
    protections["Anti Raid"] = mode.lower() == "on"
    state = "مفعل 🟢" if protections["Anti Raid"] else "معطل 🔴"
    await interaction.response.send_message(f"📡 نظام مكافحة الريد: {state}")

@bot.tree.command(name="anti_bot", description="تفعيل/تعطيل نظام منع البوتات")
@app_commands.describe(mode="on أو off")
async def anti_bot(interaction: discord.Interaction, mode: str):
    if not await check_owner(interaction):
        return
    protections["Anti Bot"] = mode.lower() == "on"
    state = "مفعل 🟢" if protections["Anti Bot"] else "معطل 🔴"
    await interaction.response.send_message(f"🤖 نظام منع البوتات: {state}")

@bot.tree.command(name="anti_sabotage", description="تفعيل/تعطيل نظام مكافحة التخريب")
@app_commands.describe(mode="on أو off")
async def anti_sabotage(interaction: discord.Interaction, mode: str):
    if not await check_owner(interaction):
        return
    protections["Anti Sabotage"] = mode.lower() == "on"
    state = "مفعل 🟢" if protections["Anti Sabotage"] else "معطل 🔴"
    await interaction.response.send_message(f"🧨 نظام مكافحة التخريب: {state}")

@bot.tree.command(name="commands_log", description="تفعيل/تعطيل تسجيل الأوامر")
@app_commands.describe(mode="on أو off")
async def commands_log(interaction: discord.Interaction, mode: str):
    if not await check_owner(interaction):
        return
    protections["Commands Log"] = mode.lower() == "on"
    state = "مفعل 🟢" if protections["Commands Log"] else "معطل 🔴"
    await interaction.response.send_message(f"📁 تسجيل الأوامر: {state}")

# =========================
# BLACKLIST WORDS
# =========================

@bot.tree.command(name="blacklist_word", description="إدارة الكلمات المحظورة")
@app_commands.describe(action="add/remove/list", word="الكلمة (لـ add/remove)")
async def blacklist_word(interaction: discord.Interaction, action: str, word: str = None):
    if not await check_owner(interaction):
        return
    
    if action.lower() == "add" and word:
        blacklisted_words.add(word.lower())
        await interaction.response.send_message(f"✅ تم إضافة `{word}` إلى قائمة الكلمات المحظورة")
        await send_log("📝 Blacklist Added", f"تم إضافة `{word}` إلى الكلمات المحظورة")
    
    elif action.lower() == "remove" and word:
        blacklisted_words.discard(word.lower())
        await interaction.response.send_message(f"✅ تم إزالة `{word}` من قائمة الكلمات المحظورة")
    
    elif action.lower() == "list":
        if blacklisted_words:
            words_list = "\n".join([f"• {w}" for w in blacklisted_words])
            await interaction.response.send_message(f"**الكلمات المحظورة:**\n{words_list}")
        else:
            await interaction.response.send_message("📭 لا توجد كلمات محظورة حالياً")
    else:
        await interaction.response.send_message("❌ استخدم: `/blacklist_word action:add word:كلمة` أو `action:remove` أو `action:list`")

# =========================
# WARNS SYSTEM
# =========================

@bot.tree.command(name="warn", description="إضافة تحذير لعضو")
@app_commands.describe(member="العضو", reason="سبب التحذير")
async def warn_member(interaction: discord.Interaction, member: discord.Member, reason: str = "بدون سبب"):
    if not await check_owner(interaction):
        return
    
    member_warnings[member.id].append({
        "reason": reason, 
        "time": str(datetime.utcnow()), 
        "moderator": str(interaction.user)
    })
    warning_count = len(member_warnings[member.id])
    
    embed = discord.Embed(title="⚠️ تحذير جديد", color=0xffaa00, timestamp=datetime.utcnow())
    embed.add_field(name="👤 العضو", value=member.mention, inline=True)
    embed.add_field(name="📋 السبب", value=reason, inline=True)
    embed.add_field(name="📊 عدد التحذيرات", value=f"{warning_count}/{MAX_WARNINGS_BEFORE_BAN}", inline=True)
    embed.add_field(name="👮 المُحذر", value=interaction.user.mention, inline=True)
    
    await interaction.response.send_message(embed=embed)
    await send_log("⚠️ Warn Issued", f"{member.mention} أخذ تحذير: {reason}")

@bot.tree.command(name="warnings", description="عرض تحذيرات العضو")
@app_commands.describe(member="العضو")
async def show_warnings(interaction: discord.Interaction, member: discord.Member):
    if not await check_owner(interaction):
        return
    
    warns = member_warnings.get(member.id, [])
    if not warns:
        await interaction.response.send_message(f"✅ {member.mention} ليس لديه أي تحذيرات")
        return
    
    embed = discord.Embed(title=f"⚠️ تحذيرات {member.name}", color=0xffaa00)
    for i, warn in enumerate(warns[:10], 1):
        embed.add_field(name=f"#{i}", 
                       value=f"السبب: {warn['reason']}\nالتاريخ: {warn['time']}\nالمُحذر: {warn['moderator']}", 
                       inline=False)
    
    await interaction.response.send_message(embed=embed)

@bot.tree.command(name="clear_warns", description="مسح تحذيرات العضو")
@app_commands.describe(member="العضو")
async def clear_warnings(interaction: discord.Interaction, member: discord.Member):
    if not await check_owner(interaction):
        return
    
    if member.id in member_warnings:
        del member_warnings[member.id]
        await interaction.response.send_message(f"✅ تم مسح جميع تحذيرات {member.mention}")
    else:
        await interaction.response.send_message(f"ℹ️ {member.mention} ليس لديه تحذيرات")

# =========================
# MODERATION COMMANDS
# =========================

@bot.tree.command(name="timeout", description="إعطاء تايم أوت لعضو")
@app_commands.describe(member="العضو", minutes="عدد الدقائق", reason="السبب")
async def timeout_member(interaction: discord.Interaction, member: discord.Member, minutes: int = 10, reason: str = "بدون سبب"):
    if not await check_owner(interaction):
        return
    
    await member.timeout(datetime.utcnow() + timedelta(minutes=minutes), reason=reason)
    embed = discord.Embed(title="🔇 Timeout", 
                         description=f"{member.mention} أخذ تايم أوت {minutes} دقيقة\n📋 السبب: {reason}", 
                         color=0xffaa00)
    await interaction.response.send_message(embed=embed)
    await send_log("🔇 Timeout", f"{member.mention} أخذ تايم أوت {minutes} دقيقة بسبب: {reason}")

@bot.tree.command(name="remove_timeout", description="إزالة التايم أوت عن عضو")
async def remove_timeout(interaction: discord.Interaction, member: discord.Member):
    if not await check_owner(interaction):
        return
    
    await member.timeout(None)
    await interaction.response.send_message(f"✅ تم فك التايم أوت عن {member.mention}")

@bot.tree.command(name="ban", description="حظر عضو")
@app_commands.describe(member="العضو", reason="السبب")
async def ban_member(interaction: discord.Interaction, member: discord.Member, reason: str = "بدون سبب"):
    if not await check_owner(interaction):
        return
    
    await member.ban(reason=reason)
    await interaction.response.send_message(f"🔨 تم حظر {member.mention}")
    await send_log("🔨 Ban", f"{member.mention} تم حظره بسبب: {reason}", color=0xff0000)

@bot.tree.command(name="unban", description="إلغاء حظر مستخدم")
@app_commands.describe(user_id="آيدي المستخدم")
async def unban_member(interaction: discord.Interaction, user_id: str):
    if not await check_owner(interaction):
        return
    
    try:
        user = await bot.fetch_user(int(user_id))
        await interaction.guild.unban(user)
        await interaction.response.send_message(f"✅ تم فك الحظر عن {user.name}")
    except Exception as e:
        await interaction.response.send_message(f"❌ خطأ: {e}")

@bot.tree.command(name="kick", description="طرد عضو")
@app_commands.describe(member="العضو", reason="السبب")
async def kick_member(interaction: discord.Interaction, member: discord.Member, reason: str = "بدون سبب"):
    if not await check_owner(interaction):
        return
    
    await member.kick(reason=reason)
    await interaction.response.send_message(f"👢 تم طرد {member.mention}")
    await send_log("👢 Kick", f"{member.mention} تم طرده بسبب: {reason}")

# =========================
# UTILITY COMMANDS
# =========================

@bot.tree.command(name="clear", description="حذف رسائل")
@app_commands.describe(amount="عدد الرسائل (1-100)")
async def clear_messages(interaction: discord.Interaction, amount: int = 10):
    if not await check_owner(interaction):
        return
    
    if amount > 100:
        amount = 100
    await interaction.channel.purge(limit=amount)
    await interaction.response.send_message(f"🧹 تم حذف {amount} رسالة", delete_after=3)

@bot.tree.command(name="clear_all", description="حذف جميع الرسائل في الروم")
async def clear_all(interaction: discord.Interaction):
    if not await check_owner(interaction):
        return
    
    await interaction.channel.purge()
    await interaction.response.send_message("🧹 تم حذف جميع الرسائل", delete_after=3)

@bot.tree.command(name="lockdown", description="إغلاق الروم مؤقتاً")
async def lockdown_channel(interaction: discord.Interaction):
    if not await check_owner(interaction):
        return
    
    overwrite = interaction.channel.overwrites_for(interaction.guild.default_role)
    overwrite.send_messages = False
    await interaction.channel.set_permissions(interaction.guild.default_role, overwrite=overwrite)
    locked_channels.add(interaction.channel.id)
    await interaction.response.send_message("🔒 **تم إغلاق الروم!**")

@bot.tree.command(name="unlock", description="فتح الروم")
async def unlock_channel(interaction: discord.Interaction):
    if not await check_owner(interaction):
        return
    
    overwrite = interaction.channel.overwrites_for(interaction.guild.default_role)
    overwrite.send_messages = None
    await interaction.channel.set_permissions(interaction.guild.default_role, overwrite=overwrite)
    locked_channels.discard(interaction.channel.id)
    await interaction.response.send_message("🔓 **تم فتح الروم!**")

@bot.tree.command(name="slowmode", description="تفعيل الوضع البطيء")
@app_commands.describe(seconds="عدد الثواني بين الرسائل (0 لإلغاء)")
async def slowmode_channel(interaction: discord.Interaction, seconds: int = 5):
    if not await check_owner(interaction):
        return
    
    await interaction.channel.edit(slowmode_delay=seconds)
    if seconds > 0:
        await interaction.response.send_message(f"🐢 تم تفعيل الوضع البطيء: {seconds} ثانية بين الرسائل")
    else:
        await interaction.response.send_message(f"✅ تم إلغاء الوضع البطيء")

@bot.tree.command(name="say", description="البوت يتكلم باسمك")
@app_commands.describe(message="الرسالة", channel="الروم (اختياري)")
async def say_message(interaction: discord.Interaction, message: str, channel: discord.TextChannel = None):
    if not await check_owner(interaction):
        return
    
    target = channel or interaction.channel
    await target.send(message)
    await interaction.response.send_message(f"✅ تم إرسال الرسالة إلى {target.mention}", ephemeral=True)

@bot.tree.command(name="announce", description="إرسال إعلان منسق")
@app_commands.describe(title="العنوان", message="الرسالة", color="اللون (red/green/blue/yellow)")
async def announce(interaction: discord.Interaction, title: str, message: str, color: str = "blue"):
    if not await check_owner(interaction):
        return
    
    colors = {
        "red": 0xff0000,
        "green": 0x00ff00,
        "blue": 0x0000ff,
        "yellow": 0xffff00
    }
    
    embed = discord.Embed(title=f"📢 {title}", 
                         description=message, 
                         color=colors.get(color.lower(), 0x2F3136), 
                         timestamp=datetime.utcnow())
    embed.set_footer(text=f"بواسطة {interaction.user.name}")
    
    await interaction.channel.send(embed=embed)
    await interaction.response.send_message("✅ تم إرسال الإعلان", ephemeral=True)

@bot.tree.command(name="server_info", description="معلومات السيرفر")
async def server_info(interaction: discord.Interaction):
    guild = interaction.guild
    embed = discord.Embed(title=f"📡 {guild.name}", color=0x2F3136, timestamp=datetime.utcnow())
    embed.add_field(name="👥 الأعضاء", value=guild.member_count)
    embed.add_field(name="📁 الرومات", value=len(guild.channels))
    embed.add_field(name="🎭 الرتب", value=len(guild.roles))
    embed.add_field(name="👑 المالك", value=guild.owner.mention)
    embed.add_field(name="🆔 الآيدي", value=guild.id)
    embed.add_field(name="📅 تاريخ الإنشاء", value=guild.created_at.strftime("%Y-%m-%d"))
    if guild.icon:
        embed.set_thumbnail(url=guild.icon.url)
    await interaction.response.send_message(embed=embed)

@bot.tree.command(name="userinfo", description="معلومات عن عضو")
@app_commands.describe(member="العضو")
async def user_info(interaction: discord.Interaction, member: discord.Member = None):
    if not await check_owner(interaction):
        return
    
    member = member or interaction.user
    embed = discord.Embed(title=f"👤 {member.name}", color=member.color, timestamp=datetime.utcnow())
    embed.add_field(name="🆔 الآيدي", value=member.id, inline=True)
    embed.add_field(name="📅 تاريخ الانضمام", value=member.joined_at.strftime("%Y-%m-%d"), inline=True)
    embed.add_field(name="📅 تاريخ الإنشاء", value=member.created_at.strftime("%Y-%m-%d"), inline=True)
    embed.add_field(name="🎭 الرتب", value=", ".join([r.mention for r in member.roles[1:]]) or "لا يوجد", inline=False)
    embed.add_field(name="🤖 بوت؟", value="نعم" if member.bot else "لا", inline=True)
    if member.avatar:
        embed.set_thumbnail(url=member.avatar.url)
    await interaction.response.send_message(embed=embed)

@bot.tree.command(name="add_permission", description="إضافة شخص للاستثناء من الحماية")
async def add_permission(interaction: discord.Interaction, member: discord.Member):
    if not await check_owner(interaction):
        return
    
    bypass_users.add(member.id)
    await interaction.response.send_message(f"✅ {member.mention} تم استثناؤه من الحماية")

@bot.tree.command(name="rm_permission", description="إزالة شخص من الاستثناء")
async def remove_permission(interaction: discord.Interaction, member: discord.Member):
    if not await check_owner(interaction):
        return
    
    bypass_users.discard(member.id)
    await interaction.response.send_message(f"✅ تم إزالة استثناء {member.mention}")

# =========================
# RUN BOT
# =========================

if __name__ == "__main__":
    print("🚀 Starting Miramar Bot...")
    print(f"📝 Owner ID: {OWNER_ID}")
    print(f"🤖 Client ID: {CLIENT_ID}")
    print(f"🔗 Invite URL: {get_invite_url()}")
    bot.run(BOT_TOKEN)