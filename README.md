# 🤖 Giluce WhatsApp Chatbot

<p align="center">
  <img src="https://img.shields.io/node-v/20.x.x?style=flat&color=green" alt="Node.js">
  <img src="https://img.shields.io/npm/v/baileys/latest?color=purple" alt="Baileys">
  <img src="https://img.shields.io/github/license/giluce/whatsapp-bot" alt="License">
  <img src="https://img.shields.io/github/forks/giluce/whatsapp-bot?color=blue" alt="Forks">
  <img src="https://img.shields.io/github/stars/giluce/whatsapp-bot?color=yellow" alt="Stars">
</p>


> A powerful WhatsApp chatbot built with Baileys MD, featuring multi-session support, AI integration, and a beautiful Laravel dashboard for complete management.

---

## ✨ Features

### 🤖 Bot Features
- **Multi-Session Support** - Manage multiple WhatsApp accounts simultaneously
- **QR Code Pairing** - Easy device connection via QR code
- **Pairing Code** - Alternative login with phone number
- **Auto-Reconnect** - Automatic reconnection on disconnect

### 🎨 Beautiful Dashboard (Laravel)
- **Session Management** - Connect/disconnect WhatsApp sessions
- **Statistics Dashboard** - View message stats, user activity
- **Group Management** - Configure group settings
- **User Interface** - Clean, modern Bootstrap 5 design
- **Real-time Updates** - Live bot status monitoring

### 👥 Group Management
- **Welcome Messages** - Customizable group welcome
- **Goodbye Messages** - Member leave notifications
- **Anti-Link** - Remove group links automatically
- **Anti-Spam** - Spam protection system
- **Anti-Tag** - Prevent excessive tagging
- **Moderation** - Kick, promote, demote members

### 📥 Media Downloader
- **YouTube** - Download videos and audio
- **Instagram** - Download posts, reels, stories
- **TikTok** - Download videos
- **Facebook** - Download videos
- **Pinterest** - Download images

### 📚 Webtoon Commands
- **\.webtoon <query>\** - Search webtoons on Comix.to
- **\.webtoon-download <manga_code>\** - Download chapters as PDF or images

> **Note:** Webtoon commands require Python 3.10+ and Chrome/Chromium installed.
> See [Webtoon Commands Setup](#-webtoon-commands-setup) for details.

### 🎮 Entertainment
- **Memes** - Random meme generator
- **Jokes** - Daily jokes
- **Lyrics** - Song lyrics finder
- **Stickers** - Create stickers from images
- **Anime Quiz** - Interactive anime quiz with AI-powered answer validation

### 🧠 Anime Quiz

The `.quiz` command runs an interactive anime quiz competition in groups with AI-powered answer validation.

| Command | Description |
|---------|-------------|
| `.quiz` | Start a quiz with 10 questions, 15s per question |
| `.quiz <count>` | Start a quiz with `<count>` questions |
| `.quiz <count> <duration>` | Start with custom count and duration (seconds) |
| `.quiz stop` | Stop the quiz and show final scores |
| `pass` | Skip the current question during a quiz |

**Features:**
- Questions loaded from `database/quiz_anime.txt`
- AI validation via LM Studio (local, free) — accepts partial, abbreviated, or reordered answers
- Wikipedia named-entity check for proper nouns
- Local keyword similarity fallback
- First correct answer wins a point
- Wrong answers show ❌ reaction
- Final leaderboard with real player names

**LM Studio Setup (for AI validation):**

Configure in `config.js`:
```javascript
lmStudio: {
    enabled: true,
    url: 'http://localhost:1234/v1/chat/completions',
    model: 'gemma-3-4b-it'
}
```

LM Studio must be running with the specified model loaded on port 1234. If unavailable, the bot falls back to local heuristics.

### 👑 Owner Commands
- **Broadcast** - Send messages to all users
- **Block/Unblock** - Manage user access
- **Session Management** - Control multiple sessions

---

## 🚀 Installation

### Prerequisites
- Node.js 18+
- PHP 8.1+
- Composer
- MySQL/SQLite

### Bot Installation (Node.js)

```bash
# Clone the repository
git clone https://github.com/lastrat/Giluce-Whatsapp-Chatbot.git

# Navigate to project directory
cd whatsapp-bot

# Install dependencies
npm install

# Start the bot
npm start
```

### Dashboard Installation (Laravel)

```bash
# Navigate to Laravel folder
cd whatsapp-bot-laravel

# Install PHP dependencies
composer install

# Copy environment file
cp .env.example .env

# Generate application key
php artisan key:generate

# Configure database in .env file
# Then run migrations
php artisan migrate

# Start the server
php artisan serve
```

---

## 🎨 Dashboard Screenshots

| Feature | Description |
|---------|-------------|
| **Dashboard Home** | Overview with stats, active sessions, recent activity |
| **Sessions** | Connect/disconnect WhatsApp, view QR codes |
| **Groups** | Manage group settings, view group info |
| **Statistics** | Message counts, user activity charts |

### Dashboard Routes

| Route | Description |
|-------|-------------|
| `/` | Home/Dashboard |
| `/login` | User login |
| `/register` | User registration |
| `/sessions` | WhatsApp session management |
| `/sessions/create` | Create new session (QR) |

---

## ⚙️ Configuration

### Bot Configuration

Edit `config.js` to customize your bot:

```javascript
module.exports = {
    // Bot Owner
    ownerNumber: ['237671624397'], // Your WhatsApp number
    ownerName: ['Giluce Bot', 'Admin'],
    
    // Bot Settings
    botName: 'Giluce Bot',
    prefix: '.',
    
    // Behavior
    selfMode: false,
    autoRead: false,
    autoTyping: false,
    autoReact: true,
    
    // Group Defaults
    defaultGroupSettings: {
        antilink: false,
        welcome: true,
        goodbye: true
    }
};
```

### Laravel Environment (.env)

```env
APP_NAME="Giluce WhatsApp"
APP_URL=http://localhost:8000

DB_CONNECTION=mysql
DB_HOST=127.0.0.1
DB_PORT=3306
DB_DATABASE=giluce
DB_USERNAME=root
DB_PASSWORD=

WHATSAPP_SESSION_PATH=../sessions
```

---

## 📖 Bot Commands

### Basic Commands

| Command | Description |
|---------|-------------|
| `.menu` | Display bot menu |
| `.ping` | Test bot response |
| `.info` | Bot information |
| `.owner` | Contact owner |

### Group Commands

| Command | Description |
|---------|-------------|
| `.kick` | Remove member |
| `.promote` | Make admin |
| `.demote` | Remove admin |
| `.welcome` | Set welcome message |
| `.antilink` | Enable/disable anti-link |
| `.tagall` | Tag all members |

### Media Commands

| Command | Description |
|---------|-------------|
| `.song` | Download YouTube audio |
| `.video` | Download YouTube video |
| `.instagram` | Download Instagram media |
| `.tiktok` | Download TikTok video |
| `.facebook` | Download Facebook video |
| `.lyrics` | Get song lyrics |

### Fun Commands

| Command | Description |
|---------|-------------|
| `.quiz [count] [duration]` | Start anime quiz |
| `.quiz stop` | Stop quiz and show scores |
| `pass` | Skip current quiz question |
| `.bomb` | Bomb number game |
| `.truth` | Random truth question |
| `.dare` | Random dare challenge |

---

## 📁 Project Structure

`
Giluce-WhatsApp-Chatbot/
│
├── whatsapp-bot/              # Node.js Bot (Baileys)
│   ├── commands/              # Command files
│   │   ├── admin/           # Group management
│   │   ├── general/          # General commands
│   │   └── media/            # Download commands
│   ├── src/                  # Source files
│   │   ├── handler.js       # Message handler
│   │   ├── database.js      # Database functions
│   │   └── utils/           # Utilities
│   ├── sessions/             # WhatsApp sessions
│   ├── config.js             # Configuration
│   └── index.js             # Entry point
│
├── comix-downloader/         # Python webtoon downloader (Comix.to)
│   ├── main.py              # CLI entry point
│   ├── download_comix.py    # Chapter download wrapper
│   ├── search_comix.py      # Search wrapper
│   ├── src/                 # Core downloader library
│   └── requirements.txt     # Python dependencies
│
├── webtoon-api/              # Optional FastAPI wrapper
│   └── main.py              # REST API for webtoon features
│
└── whatsapp-bot-laravel/    # Laravel Dashboard
    ├── app/                  # Application controllers
    ├── resources/views/       # Blade templates
    ├── routes/               # Web routes
    └── database/migrations/  # Database migrations
`---

## 🔧 API Configuration

The bot uses various free APIs for media downloading:

- **YouTube** - EliteProTech, Yupra, Okatsu APIs
- **TikTok** - Siputzx API
- **Instagram** - NexRay API
- **Lyrics** - Vreden, Siputzx APIs

---

## 🛠️ Technologies Used

### Bot (Node.js)
- [Baileys](https://github.com/WhiskeySockets/Baileys) - WhatsApp Web MD
- Express.js - HTTP server
- Axios - HTTP client

### Dashboard (Laravel)
- Laravel 10 - PHP Framework
- Bootstrap 5 - UI Framework
- MySQL/SQLite - Database

---

## 🤝 Contributing

Contributions are welcome! Please read our [contributing guidelines](CONTRIBUTING.md) first.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## 📚 Webtoon Commands Setup

The webtoon features require additional Python dependencies and a Chrome/Chromium browser for automation.

### Prerequisites

- **Python 3.10+** installed and available in PATH
- **Chrome** or **Chromium** browser installed
- **Pip packages** (installed automatically via comix-downloader/requirements.txt)

### Installation

`ash
# Install Python dependencies
cd comix-downloader
pip install -r requirements.txt
`

### How It Works

| Command | Python Entry Point | Description |
|---------|-------------------|-------------|
| .webtoon <query> | comix-downloader/search_comix.py | Searches Comix.to and returns results |
| .webtoon-download <code> | comix-downloader/download_comix.py | Downloads chapters as PDF/images |

### Hosting Considerations

**These commands cannot run on Render or similar serverless platforms** because they require:
- A persistent Chrome/Chromium browser for nodriver automation
- Valid Comix.to cookies to bypass Cloudflare protection
- Significant memory and CPU for PDF generation

**Recommended hosting:**
- **VPS** (OVH, DigitalOcean, Hetzner) with Docker + Chrome headless
- **Local PC / WAMP** with PM2 or similar process manager
- **Dedicated server** for best performance

See [comix-downloader/README.md](comix-downloader/README.md) for detailed setup instructions.

---

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## 🙏 Acknowledgments

- [Baileys](https://github.com/WhiskeySockets/Baileys) - WhatsApp Web MD library
- [Laravel](https://laravel.com) - Beautiful PHP framework
- [KnightBot-Mini](https://github.com) - Inspiration and ideas

---

## 📞 Support

- 💬 Join our [WhatsApp Group](https://chat.whatsapp.com/)
- 🐛 Report bugs on [GitHub Issues](https://github.com/lastrat/Giluce-Whatsapp-Chatbot/issues)
- 📧 Email: simosimogildas@gmail.com

---

<p align="center">
  Made with ❤️ by <a href="https://giluce.com">Gildas & Eunice</a>
</p>
