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

const MANGA_DEX_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Origin': 'https://mangadex.org',
    'Referer': 'https://mangadex.org/'
};

const MANGA_DEX_BASE = 'https://api.mangadex.org';

function downloadImage(url) {
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
            reject(new Error('Image download timeout'));
        });
    });
}

function createPdfFromImages(images, outputPath, title) {
    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({ size: 'A4', autoFirstPage: false });
            const stream = fs.createWriteStream(outputPath);
            doc.pipe(stream);

            doc.on('error', reject);
            stream.on('finish', () => resolve(outputPath));
            stream.on('error', reject);

            let addedPages = 0;
            for (let i = 0; i < images.length; i++) {
                try {
                    const img = doc.openImage(images[i]);
                    const pageWidth = 595.28;
                    const pageHeight = 841.89;
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
                    addedPages++;
                } catch (err) {
                    console.error(`[WebtoonDownload] Failed to add image ${i} to PDF:`, err.message);
                }
            }

            console.log(`[WebtoonDownload] PDF pages created: ${addedPages}/${images.length}`);
            doc.end();
        } catch (error) {
            reject(error);
        }
    });
}

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
            
            if (attempt === retries) {
                throw error;
            }
            
            const delay = Math.min(5000, 1000 * Math.pow(2, attempt - 1));
            console.error(`[WebtoonDownload] Retrying in ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
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
            let mangaResponse;
            try {
                mangaResponse = await fetchWithRetry(`${MANGA_DEX_BASE}/manga/${mangaId}`);
            } catch (error) {
                console.error('[WebtoonDownload] Manga info fetch failed:', error.message);
                return await sock.sendMessage(from, { 
                    text: `❌ Failed to fetch manga info: ${error.message}\n\nCheck:\n1. Internet connection\n2. MangaDex is not blocked\n3. Manga ID is correct` 
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
            
            // Filter chapters if specified
            if (chapterIds.length > 0) {
                chapters = chapters.filter(ch => chapterIds.includes(ch.id));
            }
            
            if (!chapters.length) {
                return await sock.sendMessage(from, { 
                    text: '❌ No chapters found for this manga.' 
                });
            }
            
            await sock.sendMessage(from, { 
                text: `📚 Found ${chapters.length} chapters\nStarting download...`
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
                const chapterId = chapter.id;
                
                await sock.sendMessage(from, { 
                    text: `⏳ Downloading chapter ${i + 1}/${chapters.length}...`
                });
                
                try {
                    const serverResponse = await fetchWithRetry(`${MANGA_DEX_BASE}/at-home/server/${chapterId}`);
                    
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
                    
                    console.log(`[WebtoonDownload] Chapter ${chapterNum}: ${imagePaths.length} images`);
                    
                    const imagePromises = imagePaths.map((imgPath, idx) => {
                        const imgUrl = `https://uploads.mangadex.org/data/${baseUrl}/${imgPath}`;
                        return downloadImage(imgUrl)
                            .then(buffer => ({ idx, buffer }))
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
                    allImages.push(...validImages.map(img => img.buffer));
                    
                } catch (error) {
                    console.error(`[WebtoonDownload] Failed chapter ${chapterNum}:`, error.message);
                }
            }
            
            if (allImages.length === 0) {
                return await sock.sendMessage(from, { 
                    text: '❌ Failed to download any images.\nTry again later or choose another manga.' 
                });
            }
            
            await sock.sendMessage(from, { 
                text: `📄 Generating PDF with ${allImages.length} pages...`
            });
            
            // Generate PDF
            const pdfPath = path.join(DOWNLOADS_DIR, `${mangaId}.pdf`);
            try {
                await createPdfFromImages(allImages, pdfPath, mangaTitle);
                
                const pdfStats = fs.statSync(pdfPath);
                console.log('[WebtoonDownload] PDF created:', pdfStats.size, 'bytes');
                
                if (pdfStats.size < 1000) {
                    throw new Error(`PDF too small: ${pdfStats.size} bytes`);
                }
                
                const pdfBuffer = fs.readFileSync(pdfPath);
                await sock.sendMessage(from, {
                    document: pdfBuffer,
                    mimetype: 'application/pdf',
                    fileName: `${mangaTitle.replace(/[^a-z0-9]/gi, '_')}.pdf`,
                    caption: `✅ ${mangaTitle}\n${chapters.length} chapters | ${allImages.length} pages`
                }, { quoted: msg });
                
            } catch (pdfError) {
                console.error('[WebtoonDownload] PDF failed:', pdfError.message);
                
                // Fallback: send images directly
                await sock.sendMessage(from, { 
                    text: `⚠️ PDF generation failed, sending ${allImages.length} images directly...` 
                });
                
                for (let i = 0; i < Math.min(allImages.length, 10); i++) {
                    try {
                        await sock.sendMessage(from, {
                            image: allImages[i],
                            caption: `${mangaTitle} - Page ${i + 1}`
                        });
                    } catch (e) {
                        console.error(`[WebtoonDownload] Failed to send image ${i}:`, e.message);
                    }
                }
                
                if (allImages.length > 10) {
                    await sock.sendMessage(from, { 
                        text: `... and ${allImages.length - 10} more pages` 
                    });
                }
            }
            
            // Clean up
            try {
                if (fs.existsSync(pdfPath)) fs.unlinkSync(pdfPath);
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
