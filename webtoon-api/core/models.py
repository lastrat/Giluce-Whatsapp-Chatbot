"""
Core models for Webtoon Downloader.
"""

from dataclasses import dataclass, field
from typing import List, Optional
from pathlib import Path


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


@dataclass
class DownloadConfig:
    """Configuration for downloads."""
    download_path: Path = Path("./downloads")
    output_format: str = "pdf"  # pdf, images
    max_workers: int = 4
    max_image_workers: int = 4
    retry_count: int = 3
    retry_delay: float = 1.0
    headless: bool = True
    keep_images: bool = False


@dataclass
class ImageDownloadReport:
    """Result of a multi-image download attempt."""
    images: List[tuple[int, bytes]]
    failed: List[tuple[int, str]]
    total: int
    failure_details: List["ImageFailure"] = field(default_factory=list)

    @property
    def is_complete(self) -> bool:
        return len(self.images) == self.total and not self.failed


@dataclass(frozen=True)
class ImageFailure:
    """Structured diagnostics for one failed page."""
    index: int
    category: str
    attempts: int
    message: str
    host: str = ""
