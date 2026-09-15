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
                    contentRating[]: ['safe', 'suggestive'],
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
            
            let resultText = `📚 *Webtoon Search Results for: "${query}"*\n\n`;
            
            mangaList.slice(0, 5).forEach((manga, index) => {
                const attr = manga.attributes || {};
                const title = attr.title?.en || Object.values(attr.title || {})[0] || 'Unknown';
                const author = (attr.author || [])[0] || 'Unknown';
                const status = attr.status || 'Unknown';
                const mangaId = manga.id;
                
                resultText += `${index + 1}. *${title}*\n`;
                resultText += `   Author: ${author}\n`;
                resultText += `   Status: ${status}\n`;
                resultText += `   ID: ${mangaId}\n`;
                resultText += `\n`;
            });
            
            resultText += `💡 Use .webtoon-download <manga_id> to download as PDF\n`;
            resultText += `Example: .webtoon-download ${mangaList[0].id}`;
            
            await sock.sendMessage(from, { 
                text: resultText 
            });
            
        } catch (error) {
            console.error('Webtoon command error:', error);
            await sock.sendMessage(from, { 
                text: `❌ Failed to search webtoons: ${error.message}` 
            });
        }
    }
};
