/**
 * Webtoon Command - Search webtoons on MangaDex
 */

const axios = require('axios');
const config = require('../../config');

module.exports = {
    name: 'webtoon',
    aliases: ['wt', 'webtoon-search'],
    category: 'general',
    description: 'Search webtoons on MangaDex',
    usage: '.webtoon <query>',
    
    async execute(sock, msg, args, context) {
        const { from } = context;
        
        try {
            if (args.length === 0) {
                return await sock.sendMessage(from, { 
                    text: '❌ Please provide a search query!\n\nExample: .webtoon violet evergarden' 
                });
            }
            
            const query = args.join(' ');
            
            await sock.sendMessage(from, { 
                text: '🔍 Searching webtoons...',
                react: { text: '🔍', key: msg.key }
            });
            
            const searchResponse = await axios.get('https://api.mangadex.org/manga', {
                params: {
                    title: query,
                    limit: 10,
                    'contentRating[]': ['safe', 'suggestive'],
                    order: { relevance: 'desc' }
                },
                timeout: 30000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            });
            
            const data = searchResponse.data;
            const mangaList = data.data || [];
            
            if (!mangaList.length) {
                return await sock.sendMessage(from, { 
                    text: '❌ No webtoons found for your query.' 
                });
            }
            
            await sock.sendMessage(from, { 
                text: `📚 *Webtoon Search Results for: "${query}"*`
            });
            
            for (const manga of mangaList.slice(0, 5)) {
                const attr = manga.attributes || {};
                const title = attr.title?.en || Object.values(attr.title || {})[0] || 'Unknown';
                const author = (attr.author || [])[0] || 'Unknown';
                const status = attr.status || 'Unknown';
                const mangaId = manga.id;
                const desc = (attr.description?.en || Object.values(attr.description || {})[0] || '')?.slice(0, 300) || '';
                
                const coverRel = (manga.relationships || []).find(r => r.type === 'cover_art');
                const coverFileName = coverRel?.attributes?.fileName;
                const coverUrl = coverFileName ? `https://uploads.mangadex.org/covers/${mangaId}/${coverFileName}` : null;
                
                const caption = `*${title}*\nAuthor: ${author}\nStatus: ${status}\n${desc ? desc + '\n' : ''}ID: ${mangaId}`;
                
                if (coverUrl) {
                    try {
                        const imgResponse = await axios.get(coverUrl, {
                            responseType: 'arraybuffer',
                            timeout: 20000,
                            headers: { 'User-Agent': 'Mozilla/5.0' }
                        });
                        const imageBuffer = Buffer.from(imgResponse.data);
                        if (!imageBuffer.length) throw new Error('Empty cover image');
                        await sock.sendMessage(from, {
                            image: imageBuffer,
                            caption,
                            mimetype: 'image/jpeg'
                        });
                        continue;
                    } catch (error) {
                        console.error('Cover download failed:', error.message);
                    }
                }
                
                await sock.sendMessage(from, { text: caption });
            }
            
            await sock.sendMessage(from, { 
                text: `💡 Use .webtoon-download <manga_id> to download as PDF\nExample: .webtoon-download ${mangaList[0].id}`
            });
            
        } catch (error) {
            console.error('Webtoon command error:', error);
            await sock.sendMessage(from, { 
                text: `❌ Failed to search webtoons: ${error.message}` 
            });
        }
    }
};
