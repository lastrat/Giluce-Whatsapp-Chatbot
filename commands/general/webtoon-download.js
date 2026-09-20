/**
 * Webtoon Download Command - Download webtoons as PDF from MangaDex
 * Supports chapter selection conversation.
 */

const axios = require('axios');
const config = require('../../config');
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const https = require('https');
const http = require('http');

const DOWNLOADS_DIR = path.join(__dirname, '../../temp/webtoon-downloads');
if (!fs.existsSync(DOWNLOADS_DIR)) {
    fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
}

const WEBTOON_API_BASE = process.env.WEBTOON_API_URL || 'http://localhost:8001';
const MANGA_DEX_BASE = 'https://api.mangadex.org';

const MANGA_DEX_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Origin': 'https://mangadex.org',
    'Referer': 'https://mangadex.org/'
};

const pendingWebtoonDownloads = new Map();

async function fetchWithRetry(url, options = {}, retries = 3) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const response = await axios.get(url, {
                ...options,
                headers: {
                    ...MANGA_DEX_HEADERS,
                    ...(options.headers || {})
                },
                timeout: options.timeout || 60000,
                httpsAgent: new https.Agent({ keepAlive: false }),
                httpAgent: new http.Agent({ keepAlive: false })
            });
            return response;
        } catch (error) {
            console.error(`[WebtoonDownload] Attempt ${attempt}/${retries} failed for ${url}: ${error.message}`);
            if (attempt === retries) throw error;
            const delay = Math.min(5000, 1000 * Math.pow(2, attempt - 1));
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}

function detectMimeType(buffer) {
    if (!buffer || buffer.length < 12) return 'image/jpeg';
    const bytes = buffer.slice(0, 12);
    if (bytes[0] === 0xFF && bytes[1] === 0xD8) return 'image/jpeg';
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) return 'image/png';
    if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'image/gif';
    if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) return 'image/webp';
    return 'image/jpeg';
}

function downloadImage(url) {
    return new Promise((resolve, reject) => {
        const client = url.startsWith('https') ? https : http;
        const req = client.get(url, { headers: MANGA_DEX_HEADERS }, (res) => {
            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => {
                try {
                    const buffer = Buffer.concat(chunks);
                    if (!buffer.length) {
                        reject(new Error('Empty image buffer'));
                        return;
                    }
                    const mimeType = detectMimeType(buffer);
                    resolve({ buffer, mimeType });
                } catch (err) {
                    reject(new Error(`Image processing failed: ${err.message}`));
                }
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

async function callPythonApi(mangaId, chapterIds) {
    const payload = {
        webtoon_url: mangaId,
        chapters: chapterIds,
        output_format: 'pdf',
        max_workers: 4
    };
    const response = await axios.post(`${WEBTOON_API_BASE}/download`, payload, {
        timeout: 60000,
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        }
    });
    return response.data;
}

async function pollTaskStatus(taskId) {
    for (let attempt = 0; attempt < 60; attempt++) {
        try {
            const statusResponse = await axios.get(`${WEBTOON_API_BASE}/download/${taskId}`, {
                timeout: 30000
            });
            const data = statusResponse.data;
            if (data.status === 'completed') {
                return data;
            }
            if (data.status === 'failed') {
                throw new Error(data.error || 'Download failed');
            }
            await new Promise(resolve => setTimeout(resolve, 5000));
        } catch (error) {
            if (attempt === 59) throw error;
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
    }
    throw new Error('Download timed out');
}

async function downloadFileToBuffer(url) {
    return new Promise((resolve, reject) => {
        const client = url.startsWith('https') ? https : http;
        const req = client.get(url, { headers: MANGA_DEX_HEADERS }, (res) => {
            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => resolve(Buffer.concat(chunks)));
            res.on('error', reject);
        });
        req.on('error', reject);
        req.setTimeout(60000, () => {
            req.destroy();
            reject(new Error('File download timeout'));
        });
    });
}

async function sendImagesDirectly(sock, from, msg, images, title, maxImages = 10) {
    const limited = images.slice(0, maxImages);
    await sock.sendMessage(from, {
        text: `⚠️ Sending ${images.length} pages directly as images...`
    });
    for (let i = 0; i < limited.length; i++) {
        try {
            const item = limited[i];
            const buffer = Buffer.isBuffer(item) ? item : (item && item.buffer ? item.buffer : Buffer.from(item));
            await sock.sendMessage(from, {
                image: buffer,
                caption: `${title} - Page ${i + 1}`
            });
        } catch (e) {
            console.error(`[WebtoonDownload] Failed to send image ${i}:`, e.message);
        }
    }
    if (images.length > maxImages) {
        await sock.sendMessage(from, {
            text: `... and ${images.length - maxImages} more pages`
        });
    }
}

async function downloadChapters(sock, from, msg, chapters, mangaTitle) {
    const allImages = [];
    const tempDir = path.join(DOWNLOADS_DIR, Date.now().toString());
    if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
    }
    
    for (let i = 0; i < chapters.length; i++) {
        const chapter = chapters[i];
        const chapterNum = chapter.attributes.chapter || '?';
        
        await sock.sendMessage(from, { 
            text: `⏳ Downloading chapter ${i + 1}/${chapters.length}...`
        });
        
        try {
            const serverResponse = await fetchWithRetry(`${MANGA_DEX_BASE}/at-home/server/${chapter.id}`);
            
            const serverData = serverResponse.data;
            const baseUrl = serverData.baseUrl;
            const chapterHash = serverData.chapter?.hash;
            const chapterData = chapterHash ? serverData.chapter?.[chapterHash] : null;
            
            let imagePaths = [];
            if (chapterData && Array.isArray(chapterData.data)) {
                imagePaths = chapterData.data;
            } else if (Array.isArray(serverData.chapter?.data)) {
                imagePaths = serverData.chapter.data;
            }
            
            if (!imagePaths.length) {
                console.error(`[WebtoonDownload] No images for chapter ${chapterNum}`);
                continue;
            }
            
            const imagePromises = imagePaths.map((imgPath, idx) => {
                const imgUrl = `https://uploads.mangadex.org/data/${baseUrl}/${imgPath}`;
                return downloadImage(imgUrl)
                    .then(result => ({ idx, result }))
                    .catch(err => {
                        console.error(`[WebtoonDownload] Failed image ${idx} ch ${chapterNum}:`, err.message);
                        return null;
                    });
            });
            
            const imageResults = await Promise.all(imagePromises);
            const validImages = imageResults.filter(img => img !== null);
            
            if (validImages.length === 0) {
                console.error(`[WebtoonDownload] No valid images for chapter ${chapterNum}`);
                continue;
            }
            
            validImages.sort((a, b) => a.idx - b.idx);
            allImages.push(...validImages.map(img => img.result));
            
        } catch (error) {
            console.error(`[WebtoonDownload] Failed chapter ${chapterNum}:`, error.message);
        }
    }
    
    return allImages;
}

async function processDownload(sock, msg, mangaId, chapters, mangaTitle) {
    const from = msg.key.remoteJid;
    
    try {
        // Try Python API first
        let pdfBuffer = null;
        let usePythonApi = false;
        
        try {
            await sock.sendMessage(from, { 
                text: '🐍 Generating PDF with Python engine...'
            });
            
            const chapterIds = chapters.map(c => c.id);
            const taskResult = await callPythonApi(mangaId, chapterIds);
            const taskId = taskResult.task_id;
            
            if (!taskId) {
                throw new Error('No task ID from Python API');
            }
            
            const finalStatus = await pollTaskStatus(taskId);
            const fileUrl = `${WEBTOON_API_BASE}${finalStatus.download_url}`;
            pdfBuffer = await downloadFileToBuffer(fileUrl);
            
            if (pdfBuffer.length < 1000) {
                throw new Error(`PDF too small: ${pdfBuffer.length} bytes`);
            }
            
            usePythonApi = true;
            
        } catch (pythonError) {
            console.error('[WebtoonDownload] Python API failed:', pythonError.message);
            await sock.sendMessage(from, { 
                text: `⚠️ PDF engine unavailable, sending images directly...` 
            });
        }
        
        if (usePythonApi && pdfBuffer) {
            await sock.sendMessage(from, {
                document: pdfBuffer,
                mimetype: 'application/pdf',
                fileName: `${mangaTitle.replace(/[^a-z0-9]/gi, '_')}.pdf`,
                caption: `✅ ${mangaTitle}\n${chapters.length} chapters`
            }, { quoted: msg });
        } else {
            const allImages = await downloadChapters(sock, from, msg, chapters, mangaTitle);
            
            if (allImages.length === 0) {
                await sock.sendMessage(from, { 
                    text: '❌ Failed to download any images.\nTry again later.' 
                });
                return;
            }
            
            await sendImagesDirectly(sock, from, msg, allImages, mangaTitle, 10);
        }
        
    } catch (error) {
        console.error('[WebtoonDownload] Download error:', error);
        await sock.sendMessage(from, { 
            text: `❌ Download failed: ${error.message}` 
        });
    } finally {
        pendingWebtoonDownloads.delete(from);
    }
}

module.exports = {
    name: 'webtoon-download',
    aliases: ['wtd', 'wt-download', 'webtoon-pdf'],
    category: 'general',
    description: 'Download webtoon chapters as PDF from MangaDex',
    usage: '.webtoon-download <manga_id>',
    
    async execute(sock, msg, args, context) {
        const { from } = context;
        
        try {
            if (args.length === 0) {
                return await sock.sendMessage(from, { 
                    text: '❌ Please provide a manga ID!\n\nExample: .webtoon-download 8ed2d52d-3a16-4a76-b6ae-a42e67fc905e' 
                });
            }
            
            const mangaId = args[0];
            
            await sock.sendMessage(from, { 
                text: '📥 Fetching manga info...',
                react: { text: '📥', key: msg.key }
            });
            
            // Get manga info
            let mangaResponse;
            try {
                mangaResponse = await fetchWithRetry(`${MANGA_DEX_BASE}/manga/${mangaId}`);
            } catch (error) {
                console.error('[WebtoonDownload] Manga info fetch failed:', error.message);
                return await sock.sendMessage(from, { 
                    text: `❌ Failed to fetch manga info: ${error.message}\nCheck internet connection or MangaDex availability.` 
                });
            }
            
            const mangaData = mangaResponse.data.data;
            const mangaAttr = mangaData.attributes;
            const mangaTitle = mangaAttr.title?.en || Object.values(mangaAttr.title || {})[0] || 'Unknown';
            
            // Get chapters
            await sock.sendMessage(from, { 
                text: '📥 Fetching chapters list...'
            });
            
            let chaptersResponse;
            try {
                chaptersResponse = await fetchWithRetry(`${MANGA_DEX_BASE}/manga/${mangaId}/feed`, {
                    params: {
                        limit: 100,
                        order: { chapter: 'asc' },
                        'contentRating[]': ['safe', 'suggestive']
                    }
                });
            } catch (error) {
                console.error('[WebtoonDownload] Chapters fetch failed:', error.message);
                return await sock.sendMessage(from, { 
                    text: `❌ Failed to fetch chapters: ${error.message}` 
                });
            }
            
            let chapters = chaptersResponse.data.data || [];
            
            if (!chapters.length) {
                return await sock.sendMessage(from, { 
                    text: '❌ No chapters found for this manga.' 
                });
            }
            
            // Store pending download state
            pendingWebtoonDownloads.set(from, {
                mangaId,
                mangaTitle,
                chapters,
                timestamp: Date.now()
            });
            
            // Format chapter list
            let chapterList = `📚 *${mangaTitle}*\n`;
            chapterList += `📖 ${chapters.length} chapters available\n\n`;
            chapterList += `Please reply with the chapter numbers you want to download.\n\n`;
            chapterList += `Examples:\n`;
            chapterList += `• 1 (chapter 1 only)\n`;
            chapterList += `• 1 2 3 (chapters 1, 2, 3)\n`;
            chapterList += `• 1-5 (chapters 1 to 5)\n`;
            chapterList += `• all (all chapters)\n\n`;
            chapterList += `Chapter list:\n`;
            
            chapters.forEach((ch, idx) => {
                const chNum = ch.attributes.chapter || '?';
                const chTitle = ch.attributes.title || '';
                const label = chNum !== '?' ? `Chapter ${chNum}` : (chTitle || `Part ${idx + 1}`);
                chapterList += `${idx + 1}. ${label}${chTitle && chNum !== '?' ? ` - ${chTitle}` : ''}\n`;
            });
            
            await sock.sendMessage(from, { 
                text: chapterList
            });
            
        } catch (error) {
            console.error('Webtoon download command error:', error);
            await sock.sendMessage(from, { 
                text: `❌ Failed to load webtoon: ${error.message}` 
            });
        }
    },
    
    /**
     * Handle chapter selection from user
     * Returns true if handled, false otherwise
     */
    async handleSelection(sock, msg, from, body) {
        const pending = pendingWebtoonDownloads.get(from);
        
        if (!pending) return false;
        
        // Check timeout (10 minutes)
        if (Date.now() - pending.timestamp > 10 * 60 * 1000) {
            pendingWebtoonDownloads.delete(from);
            return false;
        }
        
        const trimmed = body.trim().toLowerCase();
        
        // Only intercept messages that look like chapter selections
        const looksLikeSelection = trimmed === 'all' || 
            /^\d+(\s+\d+)*$/.test(trimmed) || 
            /^\d+\s*-\s*\d+$/.test(trimmed) ||
            /^\d+(,\s*\d+)+$/.test(trimmed);
        
        if (!looksLikeSelection) {
            return false;
        }
        
        const { mangaId, mangaTitle, chapters } = pending;
        
        // Parse selection
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
        
        await sock.sendMessage(from, { 
            text: `✅ Selected ${selectedChapters.length} chapter(s)\nStarting download...`
        });
        
        // Clear pending state
        pendingWebtoonDownloads.delete(from);
        
        // Process download
        await processDownload(sock, msg, mangaId, selectedChapters, mangaTitle);
        
        return true;
    }
};
