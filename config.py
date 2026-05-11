import os
from dotenv import load_dotenv

load_dotenv()

# Bot Configuration
BOT_TOKEN = os.getenv('BOT_TOKEN')
OWNER_ID = int(os.getenv('OWNER_ID'))
CLIENT_ID = int(os.getenv('CLIENT_ID'))

# Webhook URLs
LOG_WEBHOOK_URL = os.getenv('LOG_WEBHOOK_URL')

# Protection Settings
MAX_WARNINGS = int(os.getenv('MAX_WARNINGS', 5))
RAID_JOIN_LIMIT = int(os.getenv('RAID_JOIN_LIMIT', 5))
RAID_JOIN_TIME = int(os.getenv('RAID_JOIN_TIME', 10))
SPAM_LIMIT = int(os.getenv('SPAM_LIMIT', 5))
SPAM_TIME_SECONDS = int(os.getenv('SPAM_TIME_SECONDS', 5))
MASS_MENTION_LIMIT = int(os.getenv('MASS_MENTION_LIMIT', 5))
LINK_TIMEOUT_MINUTES = int(os.getenv('LINK_TIMEOUT_MINUTES', 5))
MAX_CHANNEL_CREATE_LIMIT = int(os.getenv('MAX_CHANNEL_CREATE_LIMIT', 5))
MAX_CHANNEL_DELETE_LIMIT = int(os.getenv('MAX_CHANNEL_DELETE_LIMIT', 5))
MAX_ROLE_CREATE_LIMIT = int(os.getenv('MAX_ROLE_CREATE_LIMIT', 5))
MAX_ROLE_DELETE_LIMIT = int(os.getenv('MAX_ROLE_DELETE_LIMIT', 5))
MAX_WEBHOOK_CREATE_LIMIT = int(os.getenv('MAX_WEBHOOK_CREATE_LIMIT', 3))

# Anti-Link Settings
BLOCK_ALL_LINKS = os.getenv('BLOCK_ALL_LINKS', 'true').lower() == 'true'
ALLOWED_DOMAINS = os.getenv('ALLOWED_DOMAINS', '').split(',')
BLOCKED_DOMAINS = os.getenv('BLOCKED_DOMAINS', '').split(',')

# Auto-Mod Settings
AUTO_MODERATION = os.getenv('AUTO_MODERATION', 'true').lower() == 'true'
FILTER_BAD_WORDS = os.getenv('FILTER_BAD_WORDS', 'true').lower() == 'true'
FILTER_INVITES = os.getenv('FILTER_INVITES', 'true').lower() == 'true'
FILTER_SCAM_LINKS = os.getenv('FILTER_SCAM_LINKS', 'true').lower() == 'true'

# Bad words list (customize as needed)
BAD_WORDS = [
    'fuck', 'shit', 'asshole', 'bitch', 'cunt', 'nigger', 'faggot',
    'retard', 'kys', 'kill yourself', 'die', 'stupid', 'idiot'
]

# Scam patterns
SCAM_PATTERNS = [
    r'free.*nitro', r'discord\.gift', r'steam.*free', r'gift.*card',
    r'claim.*free', r'win.*iphone', r'giveaway.*free'
]

# Permissions
ADMIN_PERMISSIONS = 8
MOD_PERMISSIONS = 268435462
