"""
Webtoon API wrapper for searching and fetching webtoon information.
Supports multiple sources: Webtoon.com, Tapas, MangaDex, etc.
"""

import asyncio
import re
import json
import logging
from typing import List, Optional
from dataclasses import dataclass, field
from pathlib import Path

import aiohttp
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)


@dataclass
class WebtoonChapter:
    """Represents a webtoon chapter."""
    chapter_id: str
    title: str
    url: str
    page_count: Optional[int] = 0


@dataclass
class WebtoonInfo:
    """Represents webtoon information."""
    title: str
    author: str
    description: str
    cover_url: Optional[str] = None
    chapters: List[WebtoonChapter] = field(default_factory=list)
    source: str = "unknown"


class WebtoonAPI:
    """API wrapper for webtoon sources."""
    
    BASE_URLS = {
        "webtoon": "https://www.webtoons.com",
        "tapas": "https://tapas.io",
        "mangadex": "https://api.mangadex.org",
    }
    
    def __init__(self):
        self.session: Optional[aiohttp.ClientSession] = None
    
    async def _get_session(self) -> aiohttp.ClientSession:
        """Get or create aiohttp session."""
        if self.session is None or self.session.closed:
            self.session = aiohttp.ClientSession(
                headers={
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
                    "Accept-Language": "en-US,en;q=0.5",
                }
            )
        return self.session
    
    async def close(self):
        """Close the session."""
        if self.session and not self.session.closed:
            await self.session.close()
    
    async def search(self, query: str, source: str = "webtoon") -> List[WebtoonInfo]:
        """
        Search for webtoons by query.
        
        Args:
            query: Search query
            source: Source to search ("webtoon", "tapas", "mangadex")
        
        Returns:
            List of WebtoonInfo objects
        """
        try:
            if source == "webtoon":
                return await self._search_webtoon(query)
            elif source == "tapas":
                return await self._search_tapas(query)
            elif source == "mangadex":
                return await self._search_mangadex(query)
            else:
                raise ValueError(f"Unsupported source: {source}")
        except Exception as e:
            logger.error(f"Search failed for {source}: {e}")
            return []
    
    async def _search_webtoon(self, query: str) -> List[WebtoonInfo]:
        """Search Webtoon.com."""
        session = await self._get_session()
        results = []
        
        try:
            # Webtoon.com search URL
            search_url = f"https://www.webtoons.com/en/search?keyword={query.replace(' ', '+')}"
            
            async with session.get(search_url, timeout=aiohttp.ClientTimeout(total=30)) as response:
                if response.status != 200:
                    logger.warning(f"Webtoon search returned status {response.status}")
                    return results
                
                html = await response.text()
                soup = BeautifulSoup(html, 'html.parser')
                
                # Parse search results
                # Note: This is a simplified parser, actual structure may vary
                cards = soup.select('.search_result_item') or soup.select('.card')
                
                for card in cards[:10]:  # Limit to 10 results
                    try:
                        title_elem = card.select_one('.title') or card.select_one('h3') or card.select_one('a')
                        title = title_elem.get_text(strip=True) if title_elem else "Unknown"
                        
                        link_elem = card.select_one('a')
                        href = link_elem.get('href', '') if link_elem else ''
                        
                        if href and not href.startswith('http'):
                            href = f"https://www.webtoons.com{href}"
                        
                        results.append(WebtoonInfo(
                            title=title,
                            author="Unknown",
                            description="",
                            cover_url=None,
                            chapters=[],
                            source="webtoon"
                        ))
                    except Exception as e:
                        logger.debug(f"Failed to parse search result: {e}")
                        continue
                        
        except Exception as e:
            logger.error(f"Webtoon search error: {e}")
        
        return results
    
    async def _search_tapas(self, query: str) -> List[WebtoonInfo]:
        """Search Tapas.io."""
        session = await self._get_session()
        results = []
        
        try:
            search_url = f"https://tapas.io/search?q={query.replace(' ', '+')}"
            
            async with session.get(search_url, timeout=aiohttp.ClientTimeout(total=30)) as response:
                if response.status != 200:
                    return results
                
                html = await response.text()
                soup = BeautifulSoup(html, 'html.parser')
                
                # Parse Tapas search results
                cards = soup.select('.search-result-item') or soup.select('.series-card')
                
                for card in cards[:10]:
                    try:
                        title_elem = card.select_one('.title') or card.select_one('h3')
                        title = title_elem.get_text(strip=True) if title_elem else "Unknown"
                        
                        results.append(WebtoonInfo(
                            title=title,
                            author="Unknown",
                            description="",
                            cover_url=None,
                            chapters=[],
                            source="tapas"
                        ))
                    except Exception as e:
                        logger.debug(f"Failed to parse Tapas result: {e}")
                        continue
                        
        except Exception as e:
            logger.error(f"Tapas search error: {e}")
        
        return results
    
    async def _search_mangadex(self, query: str) -> List[WebtoonInfo]:
        """Search MangaDex API."""
        session = await self._get_session()
        results = []
        
        try:
            # MangaDex has a public API
            api_url = "https://api.mangadex.org/manga"
            params = {
                "title": query,
                "limit": 10,
                "contentRating[]": ["safe", "suggestive"],
            }
            
            async with session.get(api_url, params=params, timeout=aiohttp.ClientTimeout(total=30)) as response:
                if response.status != 200:
                    return results
                
                data = await response.json()
                
                for manga in data.get("data", []):
                    try:
                        attr = manga.get("attributes", {})
                        title = attr.get("title", {}).get("en") or list(attr.get("title", {}).values())[0] if attr.get("title") else "Unknown"
                        
                        results.append(WebtoonInfo(
                            title=title,
                            author=attr.get("author", ["Unknown"])[0] if attr.get("author") else "Unknown",
                            description=attr.get("description", {}).get("en", "") if isinstance(attr.get("description"), dict) else str(attr.get("description", ""))[:200],
                            cover_url=None,
                            chapters=[],
                            source="mangadex"
                        ))
                    except Exception as e:
                        logger.debug(f"Failed to parse MangaDex result: {e}")
                        continue
                        
        except Exception as e:
            logger.error(f"MangaDex search error: {e}")
        
        return results
    
    async def get_info(self, webtoon_id: str, source: str = "webtoon") -> WebtoonInfo:
        """
        Get detailed information about a webtoon.
        
        Args:
            webtoon_id: Webtoon ID or URL
            source: Source platform
        
        Returns:
            WebtoonInfo object
        """
        if source == "webtoon":
            return await self._get_webtoon_info(webtoon_id)
        elif source == "tapas":
            return await self._get_tapas_info(webtoon_id)
        elif source == "mangadex":
            return await self._get_mangadex_info(webtoon_id)
        else:
            raise ValueError(f"Unsupported source: {source}")
    
    async def _get_webtoon_info(self, webtoon_id: str) -> WebtoonInfo:
        """Get Webtoon.com info."""
        session = await self._get_session()
        
        # If it's a URL, extract the ID
        if webtoon_id.startswith("http"):
            match = re.search(r'/title/([^/?]+)', webtoon_id)
            if match:
                webtoon_id = match.group(1)
        
        url = f"https://www.webtoons.com/en/drama/{webtoon_id}/list?title_no={webtoon_id}"
        
        async with session.get(url, timeout=aiohttp.ClientTimeout(total=30)) as response:
            if response.status != 200:
                raise HTTPException(status_code=404, detail="Webtoon not found")
            
            html = await response.text()
            soup = BeautifulSoup(html, 'html.parser')
            
            # Parse webtoon info
            title = soup.select_one('h1.detail_header__title') or soup.select_one('.detail_header__title')
            title = title.get_text(strip=True) if title else webtoon_id
            
            author = soup.select_one('.detail_header__author') or soup.select_one('.author')
            author = author.get_text(strip=True) if author else "Unknown"
            
            description = soup.select_one('.detail_header__summary') or soup.select_one('.summary')
            description = description.get_text(strip=True) if description else ""
            
            # Parse chapters
            chapters = []
            chapter_items = soup.select('.detail_lst .detail_lst_item') or soup.select('.episode-list .episode-item')
            
            for item in chapter_items[:50]:  # Limit to 50 chapters
                try:
                    link = item.select_one('a')
                    if not link:
                        continue
                    
                    href = link.get('href', '')
                    chapter_title = link.get_text(strip=True)
                    
                    if not href.startswith('http'):
                        href = f"https://www.webtoons.com{href}"
                    
                    chapter_id_match = re.search(r'episode_no=(\d+)', href)
                    chapter_id = chapter_id_match.group(1) if chapter_id_match else href
                    
                    chapters.append(WebtoonChapter(
                        chapter_id=chapter_id,
                        title=chapter_title,
                        url=href,
                        page_count=0
                    ))
                except Exception as e:
                    logger.debug(f"Failed to parse chapter: {e}")
                    continue
            
            return WebtoonInfo(
                title=title,
                author=author,
                description=description[:500],  # Limit description length
                cover_url=None,
                chapters=chapters,
                source="webtoon"
            )
    
    async def _get_tapas_info(self, webtoon_id: str) -> WebtoonInfo:
        """Get Tapas.io info."""
        session = await self._get_session()
        
        if webtoon_id.startswith("http"):
            webtoon_id = webtoon_id.rstrip('/').split('/')[-1]
        
        url = f"https://tapas.io/series/{webtoon_id}"
        
        async with session.get(url, timeout=aiohttp.ClientTimeout(total=30)) as response:
            if response.status != 200:
                raise HTTPException(status_code=404, detail="Webtoon not found")
            
            html = await response.text()
            soup = BeautifulSoup(html, 'html.parser')
            
            title = soup.select_one('.series-title') or soup.select_one('h1')
            title = title.get_text(strip=True) if title else webtoon_id
            
            author = soup.select_one('.creator-name') or soup.select_one('.author')
            author = author.get_text(strip=True) if author else "Unknown"
            
            description = soup.select_one('.series-summary') or soup.select_one('.description')
            description = description.get_text(strip=True) if description else ""
            
            chapters = []
            chapter_items = soup.select('.episode-item') or soup.select('.chapter-item')
            
            for item in chapter_items[:50]:
                try:
                    link = item.select_one('a')
                    if not link:
                        continue
                    
                    href = link.get('href', '')
                    chapter_title = link.get_text(strip=True)
                    
                    if not href.startswith('http'):
                        href = f"https://tapas.io{href}"
                    
                    chapters.append(WebtoonChapter(
                        chapter_id=href,
                        title=chapter_title,
                        url=href,
                        page_count=0
                    ))
                except Exception as e:
                    logger.debug(f"Failed to parse Tapas chapter: {e}")
                    continue
            
            return WebtoonInfo(
                title=title,
                author=author,
                description=description[:500],
                cover_url=None,
                chapters=chapters,
                source="tapas"
            )
    
    async def _get_mangadex_info(self, webtoon_id: str) -> WebtoonInfo:
        """Get MangaDex info."""
        session = await self._get_session()
        
        # MangaDex uses UUIDs
        api_url = f"https://api.mangadex.org/manga/{webtoon_id}"
        
        async with session.get(api_url, timeout=aiohttp.ClientTimeout(total=30)) as response:
            if response.status != 200:
                raise HTTPException(status_code=404, detail="Webtoon not found")
            
            data = await response.json()
            manga = data.get("data", {})
            attr = manga.get("attributes", {})
            
            title = attr.get("title", {}).get("en") or list(attr.get("title", {}).values())[0] if attr.get("title") else "Unknown"
            author = attr.get("author", ["Unknown"])[0] if attr.get("author") else "Unknown"
            description = attr.get("description", {}).get("en", "") if isinstance(attr.get("description"), dict) else str(attr.get("description", ""))[:500]
            
            # Get chapters
            chapters = []
            chapters_url = f"https://api.mangadex.org/manga/{webtoon_id}/feed"
            
            async with session.get(chapters_url, params={"limit": 50}, timeout=aiohttp.ClientTimeout(total=30)) as ch_response:
                if ch_response.status == 200:
                    ch_data = await ch_response.json()
                    for ch in ch_data.get("data", []):
                        ch_attr = ch.get("attributes", {})
                        chapters.append(WebtoonChapter(
                            chapter_id=ch.get("id", ""),
                            title=f"Chapter {ch_attr.get('chapter', '?')}",
                            url=f"https://mangadex.org/chapter/{ch.get('id', '')}",
                            page_count=ch_attr.get("pages", 0)
                        ))
            
            return WebtoonInfo(
                title=title,
                author=author,
                description=description,
                cover_url=None,
                chapters=chapters,
                source="mangadex"
            )
    
    async def get_chapter_images(self, chapter_id: str, source: str = "webtoon") -> List[str]:
        """
        Get image URLs for a chapter.
        
        Args:
            chapter_id: Chapter ID or URL
            source: Source platform
        
        Returns:
            List of image URLs
        """
        if source == "webtoon":
            return await self._get_webtoon_chapter_images(chapter_id)
        elif source == "tapas":
            return await self._get_tapas_chapter_images(chapter_id)
        elif source == "mangadex":
            return await self._get_mangadex_chapter_images(chapter_id)
        else:
            raise ValueError(f"Unsupported source: {source}")
    
    async def _get_webtoon_chapter_images(self, chapter_id: str) -> List[str]:
        """Get Webtoon.com chapter images."""
        session = await self._get_session()
        
        if not chapter_id.startswith("http"):
            chapter_id = f"https://www.webtoons.com/en/drama/unknown/episode-{chapter_id}"
        
        async with session.get(chapter_id, timeout=aiohttp.ClientTimeout(total=60)) as response:
            if response.status != 200:
                raise HTTPException(status_code=404, detail="Chapter not found")
            
            html = await response.text()
            soup = BeautifulSoup(html, 'html.parser')
            
            images = []
            # Webtoon.com typically stores images in _images array or as <img> tags
            img_tags = soup.select('.viewer_img img') or soup.select('#_images img') or soup.select('img.viewer_img')
            
            for img in img_tags:
                src = img.get('src') or img.get('data-url')
                if src:
                    images.append(src)
            
            # If no images found in DOM, try to extract from JavaScript
            if not images:
                script_tags = soup.find_all('script')
                for script in script_tags:
                    script_text = script.string or ''
                    if '_images' in script_text:
                        # Extract image URLs from JavaScript array
                        matches = re.findall(r'"([^"]+\.jpg|[^"]+\.png|[^"]+\.gif)"', script_text)
                        images.extend(matches)
                        break
            
            return images
    
    async def _get_tapas_chapter_images(self, chapter_id: str) -> List[str]:
        """Get Tapas.io chapter images."""
        session = await self._get_session()
        
        if not chapter_id.startswith("http"):
            chapter_id = f"https://tapas.io/episode/{chapter_id}"
        
        async with session.get(chapter_id, timeout=aiohttp.ClientTimeout(total=60)) as response:
            if response.status != 200:
                raise HTTPException(status_code=404, detail="Chapter not found")
            
            html = await response.text()
            soup = BeautifulSoup(html, 'html.parser')
            
            images = []
            img_tags = soup.select('.episode-viewer img') or soup.select('.content img')
            
            for img in img_tags:
                src = img.get('src') or img.get('data-src')
                if src and not src.endswith('.gif'):
                    images.append(src)
            
            return images
    
    async def _get_mangadex_chapter_images(self, chapter_id: str) -> List[str]:
        """Get MangaDex chapter images."""
        session = await self._get_session()
        
        # Get chapter info
        chapter_url = f"https://api.mangadex.org/chapter/{chapter_id}"
        
        async with session.get(chapter_url, timeout=aiohttp.ClientTimeout(total=30)) as response:
            if response.status != 200:
                raise HTTPException(status_code=404, detail="Chapter not found")
            
            data = await response.json()
            chapter = data.get("data", {})
            attr = chapter.get("attributes", {})
            
            # MangaDex provides image URLs in the chapter data
            base_url = attr.get("data", [])
            if isinstance(base_url, list) and len(base_url) > 0:
                # Construct full URLs
                images = [url if url.startswith("http") else f"https://uploads.mangadex.org{url}" for url in base_url]
                return images
            
            return []
