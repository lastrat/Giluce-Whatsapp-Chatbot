/**
 * Webtoon Command - Search webtoons on Comix.to
 */

const { exec } = require('child_process');
const path = require('path');
const config = require('../../config');

const COMIX_SEARCH_SCRIPT = path.join(__dirname, '../../comix-downloader/search_comix.py');
const PYTHON_PATH = config.pythonPath || 'python';

function extractMangaCode(input) {
    if (!input) return null;
    input = input.trim();
    if (/^https?:\/\//i.test(input)) {
        try {
            const url = new URL(input);
            const parts = url.pathname.split('/').filter(Boolean);
            const titlePart = parts[parts.length - 1] || '';
            const code = titlePart.split('-')[0];
            return code || null;
        } catch {
            return null;
        }
    }
    return input;
}

module.exports = {
    name: 'webtoon',
    aliases: ['wt', 'webtoon-search'],
    category: 'general',
    description: 'Search webtoons on Comix.to',
    usage: '.webtoon <query_or_url>',
    
    async execute(sock, msg, args, context) {
        const { from } = context;
        
        try {
            if (args.length === 0) {
                return await sock.sendMessage(from, { 
                    text: '❌ Please provide a search query or Comix.to URL!\n\nExample: .webtoon violet evergarden' 
                });
            }
            
            const query = args.join(' ');
            
            await sock.sendMessage(from, { 
                text: '🔍 Searching webtoons on Comix.to...',
                react: { text: '🔍', key: msg.key }
            });
            
            // Search using Comix.to via Python script
            const searchResults = await new Promise((resolve, reject) => {
                exec(`"${PYTHON_PATH}" "${COMIX_SEARCH_SCRIPT}" "${query.replace(/"/g, '\\"')}"`, 
                    { timeout: 120000 },
                    (error, stdout, stderr) => {
                        if (error) {
                            if (error.message && error.message.includes('Cloudflare')) {
                        reject(new Error('Cloudflare verification failed. Please try again later or use a direct Comix.to URL.'));
                    } else {
                        reject(new Error(`Search failed: ${error.message}`));
                    }
                            return;
                        }
                        try {
                            const result = JSON.parse(stdout);
                            if (result.ok) {
                                resolve(result.items);
                            } else {
                                reject(new Error(result.error || 'Unknown error'));
                            }
                        } catch (e) {
                            reject(new Error(`Failed to parse search results: ${e.message}`));
                        }
                    }
                );
            });
            
            if (!searchResults.length) {
                return await sock.sendMessage(from, { 
                    text: '❌ No webtoons found for your query.' 
                });
            }
            
            await sock.sendMessage(from, { 
                text: `📚 *Webtoon Search Results for: "${query}"*`
            });
            
            for (const manga of searchResults.slice(0, 5)) {
                const title = manga.title || 'Unknown';
                const mangaType = manga.manga_type || 'Unknown';
                const status = manga.status || 'Unknown';
                const year = manga.year || 'N/A';
                const latestChapter = manga.latest_chapter || 'N/A';
                const ratedAvg = manga.rated_avg || 'N/A';
                const mangaCode = manga.manga_code;
                const canonicalUrl = manga.canonical_url || `https://comix.to/title/${mangaCode}`;
                const posterUrl = manga.poster_url;
                
                const caption = `*${title}*\n` +
                    `Type: ${mangaType}\n` +
                    `Status: ${status}\n` +
                    `Year: ${year}\n` +
                    `Latest Chapter: ${latestChapter}\n` +
                    `Rating: ${ratedAvg}\n` +
                    `ID: ${mangaCode}\n` +
                    `URL: ${canonicalUrl}`;
                
                if (!posterUrl) {
                    await sock.sendMessage(from, { text: caption });
                    continue;
                }
                
                try {
                    const https = require('https');
                    const http = require('http');
                    
                    const imageBuffer = await new Promise((resolve, reject) => {
                        const url = new URL(posterUrl);
                        const lib = url.protocol === 'https:' ? https : http;
                        lib.get(posterUrl, { 
                            headers: { 'User-Agent': 'Mozilla/5.0' },
                            timeout: 20000 
                        }, (res) => {
                            const chunks = [];
                            res.on('data', chunk => chunks.push(chunk));
                            res.on('end', () => resolve(Buffer.concat(chunks)));
                            res.on('error', reject);
                        }).on('error', reject);
                    });
                    
                    console.log('[Webtoon] Cover bytes for', title, ':', imageBuffer.length);
                    if (!imageBuffer.length) {
                        console.error('[Webtoon] Empty cover buffer for', title);
                        await sock.sendMessage(from, { text: caption });
                        continue;
                    }
                    
                    await sock.sendMessage(from, {
                        image: imageBuffer,
                        caption
                    });
                    console.log('[Webtoon] Image sent for', title);
                } catch (error) {
                    console.error('[Webtoon] Image send failed for', title, ':', error.message);
                    await sock.sendMessage(from, { text: caption });
                }
            }
            
            await sock.sendMessage(from, { 
                text: `💡 Use .webtoon-download <manga_code> to download as PDF\nExample: .webtoon-download ${searchResults[0].manga_code}`
            });
            
        } catch (error) {
            console.error('Webtoon command error:', error);
            await sock.sendMessage(from, { 
                text: `❌ Failed to search webtoons: ${error.message}` 
            });
        }
    }
};
