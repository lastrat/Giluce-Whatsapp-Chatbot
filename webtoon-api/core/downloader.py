"""
Main downloader with threading support for concurrent downloads.
Inspired by comix-downloader architecture.
"""

import asyncio
import time
import random
import ssl
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Optional, Callable, List, Tuple
from urllib.parse import urlparse

import requests
from PIL import Image
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader
from io import BytesIO

from .models import DownloadConfig, WebtoonChapter, ImageDownloadReport, ImageFailure


logger = __import__('logging').getLogger(__name__)


class ImageDownloader:
    """Downloads images with threading and retry logic."""
    
    def __init__(self, config: DownloadConfig):
        self.config = config
        self.session = requests.Session()
        self.session.headers.update({
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        })
    
    def download_image(self, url: str, index: int) -> Tuple[int, Optional[bytes], Optional[str]]:
        """
        Download a single image with retry logic.
        
        Returns:
            Tuple of (index, image_bytes, error_message)
        """
        # Handle data URLs
        if url.startswith("data:image/"):
            try:
                import base64
                header, b64_data = url.split(",", 1)
                img_bytes = base64.b64decode(b64_data, validate=True)
                return index, img_bytes, None
            except Exception as e:
                return index, None, f"Failed to decode data URL: {e}"
        
        last_error: Optional[Exception] = None
        attempts = max(1, int(self.config.retry_count) + 1)
        
        for attempt in range(attempts):
            try:
                logger.debug(f"Downloading image {index} (attempt {attempt + 1})")
                
                with self.session.get(
                    url,
                    timeout=(10, 60),
                    stream=True,
                    allow_redirects=True
                ) as response:
                    response.raise_for_status()
                    content = bytearray()
                    for chunk in response.iter_content(chunk_size=8192):
                        if chunk:
                            content.extend(chunk)
                    data = bytes(content)
                
                # Validate and convert image to RGB JPEG
                img = Image.open(BytesIO(data))
                img = img.convert('RGB')
                buffer = BytesIO()
                img.save(buffer, format='JPEG', quality=90)
                data = buffer.getvalue()
                
                return index, data, None
                
            except Exception as exc:
                last_error = exc
                if attempt + 1 < attempts:
                    delay = min(30.0, float(self.config.retry_delay) * (2 ** attempt))
                    delay += random.uniform(0, min(0.5, delay * 0.1))
                    logger.warning(f"Image {index} failed ({type(exc).__name__}); retrying in {delay:.1f}s")
                    time.sleep(delay)
                    continue
                break
        
        error = str(last_error) if last_error else "Download failed"
        logger.error(f"Image {index} failed after {attempts} attempts: {error}")
        return index, None, error
    
    def download_all_images(self, image_urls: List[str]) -> ImageDownloadReport:
        """
        Download all images concurrently.
        
        Returns:
            ImageDownloadReport with results
        """
        results: List[Tuple[int, bytes]] = []
        failed: List[Tuple[int, str]] = []
        
        with ThreadPoolExecutor(max_workers=self.config.max_image_workers) as executor:
            futures = {
                executor.submit(self.download_image, url, idx): idx
                for idx, url in enumerate(image_urls, 1)
            }
            
            for future in as_completed(futures):
                index = futures[future]
                try:
                    result_index, data, error = future.result()
                    if data is not None:
                        results.append((result_index, data))
                    else:
                        failed.append((result_index, error or "Download failed"))
                except Exception as exc:
                    failed.append((index, str(exc)))
        
        return ImageDownloadReport(
            images=sorted(results, key=lambda x: x[0]),
            failed=sorted(failed, key=lambda x: x[0]),
            total=len(image_urls)
        )


class WebtoonDownloader:
    """Downloads webtoon chapters."""
    
    def __init__(self, max_workers: int = 4):
        self.config = DownloadConfig(max_image_workers=max_workers)
        self.image_downloader = ImageDownloader(self.config)
    
    async def download_chapter(self, chapter: WebtoonChapter) -> List[bytes]:
        """
        Download a chapter and return image bytes.
        
        Args:
            chapter: WebtoonChapter object
        
        Returns:
            List of image bytes
        """
        from .api.webtoon import WebtoonAPI
        
        api = WebtoonAPI()
        
        # Get image URLs for the chapter
        image_urls = await api.get_chapter_images(chapter.chapter_id, chapter.url)
        
        if not image_urls:
            logger.warning(f"No images found for chapter {chapter.title}")
            return []
        
        # Download images
        report = self.image_downloader.download_all_images(image_urls)
        
        if report.failed:
            logger.warning(f"Chapter {chapter.title}: {len(report.failed)} images failed")
        
        # Return image bytes in order
        return [data for _, data in report.images]
