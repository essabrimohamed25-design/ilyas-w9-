const express = require('express');
const session = require('express-session');
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const path = require('path');
const { client, db, settings, loadSettings, saveSettings, addWarning, getWarnings, clearWarnings, isBypassed, addBypass, removeBypass, getBadWords, addBadWord, removeBadWord, logAction } = require('./bot');
require('dotenv').config();

const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// Session
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 86400000 }
}));

// Passport setup
passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

passport.use(new DiscordStrategy({
    clientID: process.env.CLIENT_ID,
    clientSecret: process.env.CLIENT_SECRET,
    callbackURL: `${process.env.DASHBOARD_URL}/auth/discord/callback`,
    scope: ['identify', 'guilds']
}, (accessToken, refreshToken, profile, done) => {
    process.nextTick(() => done(null, profile));
}));

app.use(passport.initialize());
app.use(passport.session());

// Authentication middleware
function isAuthenticated(req, res, next) {
    if (req.isAuthenticated()) return next();
    res.redirect('/login');
}

function isOwner(req, res, next) {
    if (req.user && req.user.id === process.env.OWNER_ID) return next();
    res.status(403).send('❌ You must be the bot owner to access this page');
}

// Routes
app.get('/', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Protection Bot Dashboard</title>
            <style>
                * { margin: 0; padding: 0; box-sizing: border-box; }
                body {
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    min-height: 100vh;
                    display: flex;
                    justify-content: center;
                    align-items: center;
                }
                .container {
                    background: white;
                    border-radius: 20px;
                    padding: 50px;
                    text-align: center;
                    box-shadow: 0 20px 60px rgba(0,0,0,0.3);
                    max-width: 500px;
                    width: 90%;
                }
                h1 {
                    color: #333;
                    margin-bottom: 10px;
                    font-size: 2.5em;
                }
                p {
                    color: #666;
                    margin-bottom: 30px;
                    line-height: 1.6;
                }
                .btn {
                    display: inline-block;
                    background: #5865F2;
                    color: white;
                    padding: 15px 40px;
                    border-radius: 50px;
                    text-decoration: none;
                    font-weight: bold;
                    transition: transform 0.2s;
                }
                .btn:hover {
                    transform: translateY(-2px);
                    background: #4752c4;
                }
                .features {
                    margin-top: 30px;
                    text-align: left;
                    display: grid;
                    grid-template-columns: repeat(2, 1fr);
                    gap: 15px;
                }
                .feature {
                    background: #f8f9fa;
                    padding: 10px;
                    border-radius: 10px;
                    font-size: 14px;
                    color: #333;
                }
                .feature span {
                    font-size: 20px;
                    margin-right: 8px;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>🛡️ Protection Bot</h1>
                <p>Complete security system with web dashboard</p>
                <a href="/login" class="btn">🔐 Login with Discord</a>
                <div class="features">
                    <div class="feature"><span>🛡️</span> Anti-Raid</div>
                    <div class="feature"><span>📝</span> Anti-Spam</div>
                    <div class="feature"><span>🔗</span> Anti-Link</div>
                    <div class="feature"><span>📢</span> Anti-Mass Mention</div>
                    <div class="feature"><span>💬</span> Bad Words Filter</div>
                    <div class="feature"><span>🎫</span> Anti-Invite</div>
                </div>
            </div>
        </body>
        </html>
    `);
});

app.get('/login', passport.authenticate('discord'));

app.get('/auth/discord/callback',
    passport.authenticate('discord', { failureRedirect: '/' }),
    (req, res) => res.redirect('/servers')
);

app.get('/logout', (req, res) => {
    req.logout(() => res.redirect('/'));
});

app.get('/servers', isAuthenticated, isOwner, async (req, res) => {
    const mutualServers = req.user.guilds.filter(g => 
        client.guilds.cache.has(g.id) && (g.permissions & 0x8) === 0x8
    );
    
    let serversHtml = mutualServers.map(server => `
        <div class="server-card">
            <img src="https://cdn.discordapp.com/icons/${server.id}/${server.icon}.png" 
                 onerror="this.src='https://cdn.discordapp.com/embed/avatars/0.png'">
            <div>
                <h3>${server.name}</h3>
                <p>ID: ${server.id}</p>
            </div>
            <a href="/server/${server.id}" class="manage-btn">Manage</a>
        </div>
    `).join('');
    
    if (serversHtml === '') serversHtml = '<p style="text-align:center; grid-column:1/-1;">No servers found where you have admin permissions</p>';
    
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Select Server - Protection Bot</title>
            <style>
                * { margin: 0; padding: 0; box-sizing: border-box; }
                body {
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                    background: #0a0e27;
                    color: white;
                }
                nav {
                    background: #1a1f3a;
                    padding: 20px;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }
                .logo { font-size: 24px; font-weight: bold; }
                .logout {
                    background: #ff4757;
                    color: white;
                    padding: 8px 20px;
                    border-radius: 8px;
                    text-decoration: none;
                }
                .container {
                    max-width: 1200px;
                    margin: 40px auto;
                    padding: 0 20px;
                }
                h1 { margin-bottom: 30px; }
                .servers-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
                    gap: 20px;
                }
                .server-card {
                    background: #1a1f3a;
                    border-radius: 12px;
                    padding: 20px;
                    display: flex;
                    align-items: center;
                    gap: 15px;
                }
                .server-card img {
                    width: 50px;
                    height: 50px;
                    border-radius: 50%;
                }
                .server-card h3 { margin-bottom: 5px; }
                .server-card p { color: #8a8fa8; font-size: 12px; }
                .manage-btn {
                    margin-left: auto;
                    background: #5865F2;
                    color: white;
                    padding: 8px 16px;
                    border-radius: 6px;
                    text-decoration: none;
                }
                .manage-btn:hover { background: #4752c4; }
            </style>
        </head>
        <body>
            <nav>
                <div class="logo">🛡️ Protection Bot</div>
                <a href="/logout" class="logout">Logout</a>
            </nav>
            <div class="container">
                <h1>📊 Select a Server to Manage</h1>
                <div class="servers-grid">${serversHtml}</div>
            </div>
        </body>
        </html>
    `);
});

app.get('/server/:guildId', isAuthenticated, isOwner, async (req, res) => {
    const guildId = req.params.guildId;
    const guild = client.guilds.cache.get(guildId);
    
    if (!guild) return res.send('Server not found');
    
    const cfg = await loadSettings(guildId);
    const warnings = await new Promise((resolve) => {
        db.all('SELECT * FROM warnings WHERE guild_id = ? ORDER BY time DESC LIMIT 50', [guildId], (err, rows) => resolve(rows || []));
    });
    
    const bypassUsers = await new Promise((resolve) => {
        db.all('SELECT user_id FROM bypass_users WHERE guild_id = ?', [guildId], (err, rows) => resolve(rows || []));
    });
    
    const badWords = await getBadWords(guildId);
    const logs = await new Promise((resolve) => {
        db.all('SELECT * FROM logs WHERE guild_id = ? ORDER BY time DESC LIMIT 30', [guildId], (err, rows) => resolve(rows || []));
    });
    
    const members = await guild.members.fetch();
    
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>${guild.name} - Dashboard</title>
            <style>
                * { margin: 0; padding: 0; box-sizing: border-box; }
                body {
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                    background: #0a0e27;
                    color: white;
                }
                nav {
                    background: #1a1f3a;
                    padding: 20px;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    position: sticky;
                    top: 0;
                    z-index: 100;
                }
                .logo { font-size: 24px; font-weight: bold; }
                .nav-links { display: flex; gap: 20px; align-items: center; }
                .nav-links a {
                    color: white;
                    text-decoration: none;
                    padding: 8px 16px;
                    border-radius: 8px;
                    transition: background 0.2s;
                }
                .nav-links a:hover { background: #2a2f4a; }
                .logout { background: #ff4757; }
                .container { max-width: 1400px; margin: 0 auto; padding: 20px; }
                .stats-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
                    gap: 20px;
                    margin-bottom: 30px;
                }
                .stat-card {
                    background: #1a1f3a;
                    padding: 20px;
                    border-radius: 12px;
                    text-align: center;
                }
                .stat-card h3 { font-size: 32px; margin-bottom: 5px; }
                .stat-card p { color: #8a8fa8; }
                .section {
                    background: #1a1f3a;
                    border-radius: 12px;
                    padding: 20px;
                    margin-bottom: 20px;
                }
                .section h2 {
                    margin-bottom: 20px;
                    font-size: 20px;
                }
                .setting-group {
                    display: grid;
                    grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
                    gap: 15px;
                    margin-bottom: 20px;
                }
                .setting {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: 10px;
                    background: #0a0e27;
                    border-radius: 8px;
                }
                .toggle {
                    width: 50px;
                    height: 26px;
                    background: #2a2f4a;
                    border-radius: 13px;
                    cursor: pointer;
                    position: relative;
                    transition: background 0.2s;
                }
                .toggle.active { background: #5865F2; }
                .toggle::after {
                    content: '';
                    width: 22px;
                    height: 22px;
                    background: white;
                    border-radius: 50%;
                    position: absolute;
                    top: 2px;
                    left: 3px;
                    transition: transform 0.2s;
                }
                .toggle.active::after { transform: translateX(24px); }
                input, select {
                    background: #0a0e27;
                    border: 1px solid #2a2f4a;
                    color: white;
                    padding: 8px 12px;
                    border-radius: 6px;
                    width: 120px;
                }
                button {
                    background: #5865F2;
                    color: white;
                    border: none;
                    padding: 8px 16px;
                    border-radius: 6px;
                    cursor: pointer;
                }
                button:hover { background: #4752c4; }
                table {
                    width: 100%;
                    border-collapse: collapse;
                }
                th, td {
                    padding: 12px;
                    text-align: left;
                    border-bottom: 1px solid #2a2f4a;
                }
                th { color: #8a8fa8; font-weight: normal; }
                .badge {
                    display: inline-block;
                    padding: 4px 8px;
                    border-radius: 4px;
                    font-size: 12px;
                }
                .badge-ban { background: #ff4757; }
                .badge-kick { background: #ffa502; }
                .badge-warn { background: #ffa502; }
                .modal {
                    display: none;
                    position: fixed;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    background: rgba(0,0,0,0.5);
                    justify-content: center;
                    align-items: center;
                    z-index: 1000;
                }
                .modal-content {
                    background: #1a1f3a;
                    padding: 30px;
                    border-radius: 12px;
                    min-width: 400px;
                }
                .modal input {
                    width: 100%;
                    margin: 10px 0;
                    padding: 10px;
                }
                .close {
                    float: right;
                    cursor: pointer;
                    font-size: 24px;
                }
                @media (max-width: 768px) {
                    .stats-grid { grid-template-columns: repeat(2, 1fr); }
                    .setting-group { grid-template-columns: 1fr; }
                    table { font-size: 12px; }
                }
            </style>
        </head>
        <body>
            <nav>
                <div class="logo">🛡️ Protection Bot</div>
                <div class="nav-links">
                    <a href="/servers">Servers</a>
                    <a href="/logout" class="logout">Logout</a>
                </div>
            </nav>
            <div class="container">
                <div class="stats-grid">
                    <div class="stat-card"><h3>${guild.memberCount}</h3><p>Members</p></div>
                    <div class="stat-card"><h3>${warnings.length}</h3><p>Total Warnings</p></div>
                    <div class="stat-card"><h3>${bypassUsers.length}</h3><p>Bypassed Users</p></div>
                    <div class="stat-card"><h3>${badWords.length}</h3><p>Bad Words</p></div>
                </div>
                
                <div class="section">
                    <h2>🛡️ Protection Settings</h2>
                    <div class="setting-group">
                        <div class="setting"><span>Anti-Raid</span><div class="toggle ${cfg.antiRaid ? 'active' : ''}" onclick="toggleSetting('antiRaid')"></div></div>
                        <div class="setting"><span>Anti-Spam</span><div class="toggle ${cfg.antiSpam ? 'active' : ''}" onclick="toggleSetting('antiSpam')"></div></div>
                        <div class="setting"><span>Anti-Link</span><div class="toggle ${cfg.antiLink ? 'active' : ''}" onclick="toggleSetting('antiLink')"></div></div>
                        <div class="setting"><span>Anti-Mass Mention</span><div class="toggle ${cfg.antiMention ? 'active' : ''}" onclick="toggleSetting('antiMention')"></div></div>
                        <div class="setting"><span>Anti-Bad Words</span><div class="toggle ${cfg.antiBadWords ? 'active' : ''}" onclick="toggleSetting('antiBadWords')"></div></div>
                        <div class="setting"><span>Anti-Invite</span><div class="toggle ${cfg.antiInvite ? 'active' : ''}" onclick="toggleSetting('antiInvite')"></div></div>
                    </div>
                    <div class="setting-group">
                        <div class="setting"><span>Raid Join Limit</span><input type="number" id="raidJoinLimit" value="${cfg.raidJoinLimit}" onchange="updateSetting('raidJoinLimit', this.value)"></div>
                        <div class="setting"><span>Raid Time (seconds)</span><input type="number" id="raidJoinTime" value="${cfg.raidJoinTime}" onchange="updateSetting('raidJoinTime', this.value)"></div>
                        <div class="setting"><span>Spam Limit</span><input type="number" id="spamLimit" value="${cfg.spamLimit}" onchange="updateSetting('spamLimit', this.value)"></div>
                        <div class="setting"><span>Mass Mention Limit</span><input type="number" id="massMentionLimit" value="${cfg.massMentionLimit}" onchange="updateSetting('massMentionLimit', this.value)"></div>
                        <div class="setting"><span>Max Warnings</span><input type="number" id="maxWarnings" value="${cfg.maxWarnings}" onchange="updateSetting('maxWarnings', this.value)"></div>
                    </div>
                </div>
                
                <div class="section">
                    <h2>🚫 Bad Words Filter</h2>
                    <div style="display: flex; gap: 10px; margin-bottom: 20px;">
                        <input type="text" id="newWord" placeholder="Enter a word to block..." style="flex: 1;">
                        <button onclick="addBadWord()">Add Word</button>
                    </div>
                    <div id="badWordsList" style="display: flex; flex-wrap: wrap; gap: 10px;">
                        ${badWords.map(word => `<span style="background: #ff4757; padding: 5px 12px; border-radius: 20px;">${word} <a href="#" onclick="removeBadWord('${word}'); return false;" style="color: white; margin-left: 8px; text-decoration: none;">✖</a></span>`).join('')}
                    </div>
                </div>
                
                <div class="section">
                    <h2>👤 Bypass Users</h2>
                    <div style="display: flex; gap: 10px; margin-bottom: 20px;">
                        <input type="text" id="userId" placeholder="Enter User ID..." style="flex: 1;">
                        <button onclick="addBypass()">Add User</button>
                    </div>
                    <table id="bypassTable">
                        ${bypassUsers.map(u => `
                            <tr>
                                <td>${u.user_id}</td>
                                <td><button onclick="removeBypass('${u.user_id}')">Remove</button></td>
                            </tr>
                        `).join('')}
                    </table>
                </div>
                
                <div class="section">
                    <h2>⚠️ Recent Violations</h2>
                    <table>
                        <thead><tr><th>User</th><th>Reason</th><th>Moderator</th><th>Time</th></tr></thead>
                        <tbody>
                            ${warnings.map(w => `
                                <tr>
                                    <td>${w.user_id}</td>
                                    <td>${w.reason}</td>
                                    <td>${w.moderator}</td>
                                    <td>${new Date(w.time).toLocaleString()}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
                
                <div class="section">
                    <h2>📝 Action Logs</h2>
                    <table>
                        <thead><tr><th>Action</th><th>Details</th><th>Time</th></tr></thead>
                        <tbody>
                            ${logs.map(log => `
                                <tr>
                                    <td><span class="badge badge-${log.action.toLowerCase().replace('_', '-')}">${log.action}</span></td>
                                    <td>${log.details}</td>
                                    <td>${new Date(log.time).toLocaleString()}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
            
            <script>
                const guildId = '${guildId}';
                
                async function toggleSetting(setting) {
                    const toggle = event.target;
                    const newState = !toggle.classList.contains('active');
                    toggle.classList.toggle('active', newState);
                    
                    await fetch('/api/settings', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ guildId, setting, value: newState })
                    });
                }
                
                async function updateSetting(setting, value) {
                    await fetch('/api/settings', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ guildId, setting, value: parseInt(value) })
                    });
                }
                
                async function addBadWord() {
                    const word = document.getElementById('newWord').value;
                    if (!word) return;
                    
                    const res = await fetch('/api/badwords', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ guildId, word, action: 'add' })
                    });
                    
                    if (res.ok) location.reload();
                }
                
                async function removeBadWord(word) {
                    const res = await fetch('/api/badwords', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ guildId, word, action: 'remove' })
                    });
                    
                    if (res.ok) location.reload();
                }
                
                async function addBypass() {
                    const userId = document.getElementById('userId').value;
                    if (!userId) return;
                    
                    const res = await fetch('/api/bypass', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ guildId, userId, action: 'add' })
                    });
                    
                    if (res.ok) location.reload();
                }
                
                async function removeBypass(userId) {
                    const res = await fetch('/api/bypass', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ guildId, userId, action: 'remove' })
                    });
                    
                    if (res.ok) location.reload();
                }
            </script>
        </body>
        </html>
    `);
});

// API endpoints
app.post('/api/settings', async (req, res) => {
    const { guildId, setting, value } = req.body;
    const cfg = await loadSettings(guildId);
    cfg[setting] = value;
    await saveSettings(guildId, cfg);
    res.json({ success: true });
});

app.post('/api/badwords', async (req, res) => {
    const { guildId, word, action } = req.body;
    if (action === 'add') {
        await addBadWord(guildId, word);
    } else if (action === 'remove') {
        await removeBadWord(guildId, word);
    }
    res.json({ success: true });
});

app.post('/api/bypass', async (req, res) => {
    const { guildId, userId, action } = req.body;
    if (action === 'add') {
        await addBypass(guildId, userId);
    } else if (action === 'remove') {
        await removeBypass(guildId, userId);
    }
    res.json({ success: true });
});

app.get('/api/stats/:guildId', async (req, res) => {
    const guild = client.guilds.cache.get(req.params.guildId);
    if (!guild) return res.json({ error: 'Server not found' });
    
    res.json({
        members: guild.memberCount,
        channels: guild.channels.cache.size,
        roles: guild.roles.cache.size,
        boosts: guild.premiumSubscriptionCount || 0
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`✅ Dashboard running on http://localhost:${PORT}`);
    console.log(`📊 Open your browser and visit: ${process.env.DASHBOARD_URL}`);
});
