/**
 * Webtoon Download Command - Download webtoons from Comix.to
 * Supports chapter selection conversation.
 */

const { exec } = require('child_process');
const path = require('path');
const config = require('../../config');
const fs = require('fs');
const https = require('https');
const http = require('http');

const DOWNLOADS_DIR = path.join(__dirname, '../../temp/webtoon-downloads');
if (!fs.existsSync(DOWNLOADS_DIR)) {
    fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
}

const COMIX_DOWNLOAD_SCRIPT = path.join(__dirname, '../../comix-downloader/download_comix.py');

const pendingWebtoonDownloads = new Map();

function downloadImage(url) {
    return new Promise((resolve, reject) => {
        const client = url.startsWith('https') ? https : http;
        const req = client.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => {
                const buffer = Buffer.concat(chunks);
                const statusCode = res.statusCode;
                console.log(`[WebtoonDownload] Download result: ${url} -> status=${statusCode}, size=${buffer.length}`);
                if (statusCode !== 200) {
                    reject(new Error(`HTTP ${statusCode} for ${url}`));
                    return;
                }
                if (!buffer.length) {
                    reject(new Error('Empty image buffer'));
                    return;
                }
                resolve({ buffer, mimeType: 'image/jpeg' });
            });
            res.on('error', reject);
        });
        req.on('error', reject);
        req.setTimeout(60000, () => {
            req.destroy();
            reject(new Error('Image download timeout'));
        });
    });
}

async function callPythonDownload(mangaCode, chaptersStr) {
    return new Promise((resolve, reject) => {
        const cmd = `python "${COMIX_DOWNLOAD_SCRIPT}" "${mangaCode}" "${chaptersStr}"`;
        exec(cmd, { timeout: 600000, maxBuffer: 50 * 1024 * 1024 }, (error, stdout) => {
            if (error) {
                reject(new Error(`Download failed: ${error.message}`));
                return;
            }
            try {
                const result = JSON.parse(stdout);
                if (result.ok) {
                    resolve(result);
                } else {
                    reject(new Error(result.error || 'Unknown error'));
                }
            } catch (e) {
                reject(new Error(`Failed to parse download results: ${e.message}`));
            }
        });
    });
}

async function sendImagesDirectly(sock, from, msg, chaptersData, mangaTitle, maxImages = 10) {
    let totalSent = 0;
    for (const chapterData of chaptersData) {
        if (!chapterData.images || chapterData.images.length === 0) continue;
        const limited = chapterData.images.slice(0, maxImages);
        await sock.sendMessage(from, {
            text: `📖 *${mangaTitle}* - Chapter ${chapterData.number}\nSending ${limited.length} pages...`
        });
        for (let i = 0; i < limited.length; i++) {
            try {
                const img = limited[i];
                const buffer = Buffer.from(img.data, 'base64');
                await sock.sendMessage(from, {
                    image: buffer,
                    caption: `${mangaTitle} - Chapter ${chapterData.number} - Page ${i + 1}`
                });
                totalSent++;
            } catch (e) {
                console.error(`[WebtoonDownload] Failed to send image ${i}:`, e.message);
            }
        }
    }
    return totalSent;
}

async function downloadChaptersDirect(sock, from, msg, mangaCode, chaptersStr, mangaTitle) {
    try {
        await sock.sendMessage(from, { text: '🐍 Downloading with Comix.to engine...' });
        const result = await callPythonDownload(mangaCode, chaptersStr);
        if (!result.chapters || result.chapters.length === 0) {
            await sock.sendMessage(from, { text: '❌ No chapters downloaded.' });
            return;
        }
        const totalImages = result.chapters.reduce((sum, ch) => sum + (ch.images ? ch.images.length : 0), 0);
        await sock.sendMessage(from, {
            text: `✅ Downloaded ${result.total_chapters_downloaded} chapter(s) with ${totalImages} pages.\nSending images...`
        });
        const sent = await sendImagesDirectly(sock, from, msg, result.chapters, mangaTitle, 10);
        await sock.sendMessage(from, {
            text: `✅ Sent ${sent} images from ${result.total_chapters_downloaded} chapter(s).`
        });
    } catch (error) {
        console.error('[WebtoonDownload] Direct download error:', error);
        await sock.sendMessage(from, { text: `❌ Download failed: ${error.message}` });
    }
}

module.exports = {
    name: 'webtoon-download',
    aliases: ['wtd', 'wt-download', 'webtoon-pdf'],
    category: 'general',
    description: 'Download webtoon chapters from Comix.to',
    usage: '.webtoon-download <manga_code>',
    
    async execute(sock, msg, args, context) {
        const { from } = context;
        try {
            if (args.length === 0) {
                return await sock.sendMessage(from, { 
                    text: '❌ Please provide a manga code!\n\nExample: .webtoon-download zxl15' 
                });
            }
            const mangaId = args[0];
            await sock.sendMessage(from, { 
                text: '📥 Fetching manga info from Comix.to...',
                react: { text: '📥', key: msg.key }
            });
            const searchResults = await new Promise((resolve, reject) => {
                exec(`python "${COMIX_DOWNLOAD_SCRIPT}" "${mangaId}" "1-1"`, 
                    { timeout: 120000, maxBuffer: 10 * 1024 * 1024 },
                    (error, stdout) => {
                        if (error) return reject(new Error(`Search failed: ${error.message}`));
                        try {
                            const result = JSON.parse(stdout);
                            result.ok ? resolve(result) : reject(new Error(result.error || 'Unknown error'));
                        } catch (e) {
                            reject(new Error(`Failed to parse results: ${e.message}`));
                        }
                    }
                );
            });
            const manga = searchResults.manga;
            const chapters = searchResults.chapters || [];
            if (!chapters.length) {
                return await sock.sendMessage(from, { text: '❌ No chapters found for this manga.' });
            }
            pendingWebtoonDownloads.set(from, {
                mangaId,
                mangaTitle: manga.title,
                chapters,
                timestamp: Date.now()
            });
            let chapterList = `📚 *${manga.title}*\n📖 ${chapters.length} chapters available\n\n`;
            chapterList += `Please reply with the chapter numbers you want to download.\n\nExamples:\n• 1\n• 1 2 3\n• 1-5\n• all\n\nChapter list:\n`;
            chapters.forEach((ch, idx) => {
                const chNum = ch.number || '?';
                const chTitle = ch.title || '';
                const label = chNum !== '?' ? `Chapter ${chNum}` : (chTitle || `Part ${idx + 1}`);
                chapterList += `${idx + 1}. ${label}${chTitle && chNum !== '?' ? ` - ${chTitle}` : ''}\n`;
            });
            await sock.sendMessage(from, { text: chapterList });
        } catch (error) {
            console.error('Webtoon download command error:', error);
            await sock.sendMessage(from, { text: `❌ Failed to load webtoon: ${error.message}` });
        }
    },
    
    async handleSelection(sock, msg, from, body) {
        const pending = pendingWebtoonDownloads.get(from);
        if (!pending) return false;
        if (Date.now() - pending.timestamp > 10 * 60 * 1000) {
            pendingWebtoonDownloads.delete(from);
            return false;
        }
        const trimmed = body.trim().toLowerCase();
        const looksLikeSelection = trimmed === 'all' || 
            /^\d+(\s+\d+)*$/.test(trimmed) || 
            /^\d+\s*-\s*\d+$/.test(trimmed) ||
            /^\d+(,\s*\d+)+$/.test(trimmed);
        if (!looksLikeSelection) return false;
        const { mangaId, mangaTitle, chapters } = pending;
        let selectedChapters = [];
        if (trimmed === 'all') {
            selectedChapters = chapters;
        } else if (trimmed.includes('-')) {
            const [start, end] = trimmed.split('-').map(Number);
            if (!isNaN(start) && !isNaN(end) && start >= 1 && end <= chapters.length && start <= end) {
                selectedChapters = chapters.slice(start - 1, end);
            }
        } else {
            const numbers = trimmed.split(/[\s,]+/).map(Number).filter(n => !isNaN(n) && n >= 1 && n <= chapters.length);
            selectedChapters = numbers.map(n => chapters[n - 1]).filter(Boolean);
        }
        if (selectedChapters.length === 0) {
            await sock.sendMessage(from, { 
                text: '❌ Invalid selection. Please enter valid chapter numbers.\n\nExample: 1 2 3 or 1-5 or all' 
            });
            return true;
        }
        await sock.sendMessage(from, { text: `✅ Selected ${selectedChapters.length} chapter(s)\nStarting download...` });
        pendingWebtoonDownloads.delete(from);
        const chaptersStr = selectedChapters.map(ch => ch.number).join(',');
        await downloadChaptersDirect(sock, msg, mangaId, chaptersStr, mangaTitle);
        return true;
    }
};
