/**
 * Webtoon Download Command - Download webtoons as PDF
 */

const axios = require('axios');
const config = require('../../config');
const fs = require('fs');
const path = require('path');

const WEBTOON_API_BASE = process.env.WEBTOON_API_URL || 'http://localhost:8001';
const DOWNLOADS_DIR = path.join(__dirname, '../../webtoon-api/downloads');

module.exports = {
    name: 'webtoon-download',
    aliases: ['wtd', 'wt-download', 'webtoon-pdf'],
    category: 'general',
    description: 'Download webtoon as PDF',
    usage: '.webtoon-download <url>',
    
    async execute(sock, msg, args, context) {
        const { from, sender } = context;
        const ownerJid = `${config.ownerNumber[0]}@s.whatsapp.net`;
        
        try {
            if (args.length === 0) {
                return await sock.sendMessage(from, { 
                    text: '❌ Please provide a webtoon URL!\n\nExample: .webtoon-download https://www.webtoons.com/en/drama/tower-of-god/list?title_no=1329' 
                });
            }
            
            const webtoonUrl = args.join(' ');
            
            // Validate URL
            if (!webtoonUrl.startsWith('http://') && !webtoonUrl.startsWith('https://')) {
                return await sock.sendMessage(from, { 
                    text: '❌ Please provide a valid URL starting with http:// or https://' 
                });
            }
            
            await sock.sendMessage(from, { 
                text: '📥 Starting webtoon download...\nThis may take a few minutes.',
                react: { text: '📥', key: msg.key }
            });
            
            // Start download
            const downloadResponse = await axios.post(`${WEBTOON_API_BASE}/download`, {
                webtoon_url: webtoonUrl,
                output_format: 'pdf',
                max_workers: 4
            }, {
                timeout: 30000
            });
            
            const taskId = downloadResponse.data.task_id;
            
            if (!taskId) {
                throw new Error('No task ID received from API');
            }
            
            // Poll for status
            let status = 'pending';
            let attempts = 0;
            const maxAttempts = 60; // 5 minutes max
            
            while (status !== 'completed' && status !== 'failed' && attempts < maxAttempts) {
                await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds
                
                try {
                    const statusResponse = await axios.get(`${WEBTOON_API_BASE}/download/${taskId}`);
                    status = statusResponse.data.status;
                    
                    if (status === 'processing') {
                        await sock.sendMessage(from, { 
                            text: `⏳ Processing... (attempt ${attempts + 1}/${maxAttempts})`
                        });
                    }
                } catch (error) {
                    console.error('Status check error:', error);
                }
                
                attempts++;
            }
            
            if (status === 'completed') {
                // Download the PDF
                const fileResponse = await axios.get(`${WEBTOON_API_BASE}/download/${taskId}/file`, {
                    responseType: 'stream'
                });
                
                // Save file locally
                const fileName = `webtoon_${taskId}.pdf`;
                const filePath = path.join(DOWNLOADS_DIR, fileName);
                
                const writer = fs.createWriteStream(filePath);
                fileResponse.data.pipe(writer);
                
                await new Promise((resolve, reject) => {
                    writer.on('finish', resolve);
                    writer.on('error', reject);
                });
                
                // Send file to user
                await sock.sendMessage(from, {
                    document: fs.readFileSync(filePath),
                    mimetype: 'application/pdf',
                    fileName: fileName,
                    caption: '✅ Webtoon downloaded successfully!'
                }, { quoted: msg });
                
                // Clean up
                try {
                    fs.unlinkSync(filePath);
                } catch (e) {
                    console.error('Failed to delete temp file:', e);
                }
                
            } else if (status === 'failed') {
                const statusResponse = await axios.get(`${WEBTOON_API_BASE}/download/${taskId}`);
                await sock.sendMessage(from, { 
                    text: `❌ Download failed: ${statusResponse.data.error || 'Unknown error'}`
                });
            } else {
                await sock.sendMessage(from, { 
                    text: '⏰ Download timed out. Please try again later.'
                });
            }
            
        } catch (error) {
            console.error('Webtoon download command error:', error);
            const detail = error.response?.data?.detail || error.response?.data?.message || error.message;
            await sock.sendMessage(from, { 
                text: `❌ Failed to download webtoon: ${detail}`
            });
        }
    }
};
