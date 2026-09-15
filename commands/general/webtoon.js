/**
 * Webtoon Command - Search and download webtoons as PDF
 */

const axios = require('axios');
const config = require('../../config');
const fs = require('fs');
const path = require('path');

const WEBTOON_API_BASE = process.env.WEBTOON_API_URL || 'http://localhost:8001';

module.exports = {
    name: 'webtoon',
    aliases: ['wt', 'webtoon-search'],
    category: 'general',
    description: 'Search webtoons and download as PDF',
    usage: '.webtoon <query>',
    
    async execute(sock, msg, args, context) {
        const { from, sender } = context;
        const ownerJid = `${config.ownerNumber[0]}@s.whatsapp.net`;
        
        try {
            if (args.length === 0) {
                return await sock.sendMessage(from, { 
                    text: '❌ Please provide a search query!\n\nExample: .webtoon tower of god' 
                });
            }
            
            const query = args.join(' ');
            
            await sock.sendMessage(from, { 
                text: '🔍 Searching webtoons...',
                react: { text: '🔍', key: msg.key }
            });
            
            // Search webtoons
            const searchResponse = await axios.post(`${WEBTOON_API_BASE}/search`, {
                query: query,
                source: 'webtoon'
            }, {
                timeout: 30000
            });
            
            const results = searchResponse.data;
            
            if (!results || results.length === 0) {
                return await sock.sendMessage(from, { 
                    text: '❌ No webtoons found for your query.' 
                });
            }
            
            // Format results
            let resultText = `📚 *Webtoon Search Results for: "${query}"*\n\n`;
            
            results.slice(0, 5).forEach((webtoon, index) => {
                resultText += `${index + 1}. *${webtoon.title}*\n`;
                resultText += `   Author: ${webtoon.author}\n`;
                resultText += `   Source: ${webtoon.source}\n`;
                if (webtoon.chapters && webtoon.chapters.length > 0) {
                    resultText += `   Chapters: ${webtoon.chapters.length}\n`;
                }
                resultText += `\n`;
            });
            
            resultText += `💡 Use .webtoon-download <url> to download a webtoon as PDF`;
            
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
