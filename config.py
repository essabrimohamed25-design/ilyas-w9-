import os
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Bot Configuration
BOT_TOKEN = os.getenv('BOT_TOKEN')
OWNER_ID = int(os.getenv('OWNER_ID'))
CLIENT_ID = int(os.getenv('CLIENT_ID'))

# Webhook URLs
LOG_WEBHOOK_URL = os.getenv('LOG_WEBHOOK_URL')
COMMAND_WEBHOOK_URL = os.getenv('COMMAND_WEBHOOK_URL')

# Protection Settings
RAID_LIMIT = int(os.getenv('RAID_LIMIT', 3))
RAID_TIME = int(os.getenv('RAID_TIME', 10))
MASS_DELETE_LIMIT = int(os.getenv('MASS_DELETE_LIMIT', 3))
MASS_DELETE_TIME = int(os.getenv('MASS_DELETE_TIME', 5))
MASS_CREATE_LIMIT = int(os.getenv('MASS_CREATE_LIMIT', 3))
MASS_CREATE_TIME = int(os.getenv('MASS_CREATE_TIME', 5))
MAX_WARNINGS_BEFORE_BAN = int(os.getenv('MAX_WARNINGS_BEFORE_BAN', 4))

# Blocked file extensions
BLOCKED_EXTENSIONS = (".exe", ".bat", ".cmd", ".scr", ".msi", ".vbs", ".ps1", ".jar", ".zip", ".rar", ".7z")

# Regex patterns
LINK_REGEX = r"(https?:\/\/|www\.|discord\.gg\/|discord\.com\/invite)"

# Required permissions as integer (Administrator - 8)
REQUIRED_PERMISSIONS = 8

def get_invite_url():
    return f"https://discord.com/oauth2/authorize?client_id={CLIENT_ID}&permissions={REQUIRED_PERMISSIONS}&scope=bot+applications.commands"