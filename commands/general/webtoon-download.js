/**
 * Webtoon Download Command - Download webtoons as PDF from MangaDex
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

// Download image from URL to buffer
function downloadImage(url) {
    return new Promise((resolve, reject) => {
        const client = url.startsWith('https') ? https : http;
        const req = client.get(url, (res) => {
            const chunks = [];
            res.on('data', chunk => chunks.push(chunk));
            res.on('end', () => resolve(Buffer.concat(chunks)));
            res.on('error', reject);
        });
        req.on('error', reject);
        req.setTimeout(30000, () => {
            req.destroy();
            reject(new Error('Image download timeout'));
        });
    });
}

// Create PDF from images
function createPdfFromImages(images, outputPath, title) {
    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({ size: 'A4', autoFirstPage: false });
            const stream = fs.createWriteStream(outputPath);
            doc.pipe(stream);

            doc.on('error', reject);
            stream.on('finish', () => resolve(outputPath));
            stream.on('error', reject);

            images.forEach((imgBuffer, index) => {
                try {
                    const img = doc.openImage(imgBuffer);
                    const pageWidth = 595.28; // A4 width
                    const pageHeight = 841.89; // A4 height
                    const margin = 20;
                    
                    const availableWidth = pageWidth - (margin * 2);
                    const availableHeight = pageHeight - (margin * 2);
                    
                    const imgRatio = img.width / img.height;
                    let finalWidth, finalHeight;
                    
                    if (imgRatio > availableWidth / availableHeight) {
                        finalWidth = availableWidth;
                        finalHeight = availableWidth / imgRatio;
                    } else {
                        finalHeight = availableHeight;
                        finalWidth = availableHeight * imgRatio;
                    }
                    
                    doc.addPage({ size: [pageWidth, pageHeight] });
                    doc.image(img, margin, margin, { width: finalWidth, height: finalHeight });
                } catch (err) {
                    console.error(`Failed to add image ${index} to PDF:`, err.message);
                }
            });

            doc.end();
        } catch (error) {
            reject(error);
        }
    });
}

module.exports = {
    name: 'webtoon-download',
    aliases: ['wtd', 'wt-download', 'webtoon-pdf'],
    category: 'general',
    description: 'Download webtoon chapters as PDF from MangaDex',
    usage: '.webtoon-download <manga_id> [chapter_ids]',
    
    async execute(sock, msg, args, context) {
        const { from } = context;
        
        try {
            if (args.length === 0) {
                return await sock.sendMessage(from, { 
                    text: '❌ Please provide a manga ID!\n\nExample: .webtoon-download 8ed2d52d-3a16-4a76-b6ae-a42e67fc905e' 
                });
            }
            
            const mangaId = args[0];
            const chapterIds = args.slice(1);
            
            await sock.sendMessage(from, { 
                text: '📥 Fetching manga info...',
                react: { text: '📥', key: msg.key }
            });
            
            // Get manga info
            const mangaResponse = await axios.get(`https://api.mangadex.org/manga/${mangaId}`, {
                timeout: 30000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            });
            
            const mangaData = mangaResponse.data.data;
            const mangaAttr = mangaData.attributes;
            const mangaTitle = mangaAttr.title?.en || Object.values(mangaAttr.title || {})[0] || 'Unknown';
            
            // Get chapters
            await sock.sendMessage(from, { 
                text: '📥 Fetching chapters...'
            });
            
            const chaptersResponse = await axios.get(`https://api.mangadex.org/manga/${mangaId}/feed`, {
                params: {
                    limit: 100,
                    order: { chapter: 'asc' },
                    'contentRating[]': ['safe', 'suggestive']
                },
                timeout: 30000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            });
            
            let chapters = chaptersResponse.data.data || [];
            
            // Filter chapters if specified
            if (chapterIds.length > 0) {
                chapters = chapters.filter(ch => chapterIds.includes(ch.id));
            }
            
            if (!chapters.length) {
                return await sock.sendMessage(from, { 
                    text: '❌ No chapters found.' 
                });
            }
            
            await sock.sendMessage(from, { 
                text: `📥 Downloading ${chapters.length} chapters...`
            });
            
            // Download all chapter images
            const allImages = [];
            const tempDir = path.join(DOWNLOADS_DIR, mangaId);
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
                    // Get chapter server info
                    const serverResponse = await axios.get(`https://api.mangadex.org/at-home/server/${chapter.id}`, {
                        timeout: 30000,
                        headers: {
                            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                        }
                    });
                    
                    const serverData = serverResponse.data;
                    const baseUrl = serverData.baseUrl;
                    const chapterData = serverData.chapter?.[serverData.chapter.hash];
                    
                    if (!chapterData || !chapterData.data) {
                        console.error(`No image data for chapter ${chapter.id}`);
                        continue;
                    }
                    
                    // Download images
                    const imagePromises = chapterData.data.map((imgPath, idx) => {
                        const imgUrl = `https://uploads.mangadex.org/data/${baseUrl}/${imgPath}`;
                        return downloadImage(imgUrl).then(buffer => ({ idx, buffer })).catch(err => {
                            console.error(`Failed to download image ${idx} from chapter ${chapterNum}:`, err.message);
                            return null;
                        });
                    });
                    
                    const imageResults = await Promise.all(imagePromises);
                    const validImages = imageResults.filter(img => img !== null);
                    
                    if (validImages.length === 0) {
                        console.error(`No valid images for chapter ${chapterNum}`);
                        continue;
                    }
                    
                    // Sort by index
                    validImages.sort((a, b) => a.idx - b.idx);
                    allImages.push(...validImages.map(img => img.buffer));
                    
                } catch (error) {
                    console.error(`Failed to download chapter ${chapterNum}:`, error.message);
                }
            }
            
            if (allImages.length === 0) {
                return await sock.sendMessage(from, { 
                    text: '❌ Failed to download any images.' 
                });
            }
            
            await sock.sendMessage(from, { 
                text: '📄 Generating PDF...'
            });
            
            // Generate PDF
            const pdfPath = path.join(DOWNLOADS_DIR, `${mangaId}.pdf`);
            await createPdfFromImages(allImages, pdfPath, mangaTitle);
            
            // Send PDF
            const pdfBuffer = fs.readFileSync(pdfPath);
            await sock.sendMessage(from, {
                document: pdfBuffer,
                mimetype: 'application/pdf',
                fileName: `${mangaTitle.replace(/[^a-z0-9]/gi, '_')}.pdf`,
                caption: `✅ Downloaded: ${mangaTitle}\n${chapters.length} chapters, ${allImages.length} pages`
            }, { quoted: msg });
            
            // Clean up
            try {
                fs.unlinkSync(pdfPath);
                fs.rmSync(tempDir, { recursive: true, force: true });
            } catch (e) {
                console.error('Failed to clean up temp files:', e);
            }
            
        } catch (error) {
            console.error('Webtoon download command error:', error);
            await sock.sendMessage(from, { 
                text: `❌ Failed to download webtoon: ${error.message}` 
            });
        }
    }
};
