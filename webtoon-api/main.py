"""
Webtoon Downloader API - FastAPI service for searching and downloading webtoons as PDF.
Inspired by comix-downloader architecture.
"""

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, HttpUrl
import asyncio
import os
import uuid
from pathlib import Path
from typing import Optional, List
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Create directories
BASE_DIR = Path(__file__).parent
DOWNLOADS_DIR = BASE_DIR / "downloads"
DOWNLOADS_DIR.mkdir(exist_ok=True)

app = FastAPI(
    title="Webtoon Downloader API",
    description="Search and download webtoons as PDF files",
    version="1.0.0"
)


# Models
class WebtoonSearchRequest(BaseModel):
    query: str
    source: Optional[str] = "webtoon"  # webtoon, tapas, mangadex, etc.


class WebtoonChapter(BaseModel):
    chapter_id: str
    title: str
    url: str
    page_count: Optional[int] = 0


class WebtoonInfo(BaseModel):
    title: str
    author: str
    description: str
    cover_url: Optional[str] = None
    chapters: List[WebtoonChapter]
    source: str


class DownloadRequest(BaseModel):
    webtoon_url: str
    chapters: Optional[List[str]] = None  # chapter IDs to download, None for all
    output_format: Optional[str] = "pdf"  # pdf, images
    max_workers: Optional[int] = 4


class DownloadResponse(BaseModel):
    task_id: str
    status: str
    message: str
    download_url: Optional[str] = None
    error: Optional[str] = None


# In-memory task storage (use Redis/DB in production)
tasks = {}


@app.get("/")
async def root():
    """Health check endpoint"""
    return {"status": "running", "service": "webtoon-downloader-api"}


@app.post("/search", response_model=List[WebtoonInfo])
async def search_webtoon(request: WebtoonSearchRequest):
    """
    Search for webtoons by query.
    
    Returns a list of matching webtoons with basic info.
    """
    try:
        from .api.webtoon import WebtoonAPI
        
        api = WebtoonAPI()
        results = await api.search(request.query, request.source)
        return results
         
    except ImportError as e:
        logger.error("WebtoonAPI import failed: %s", e)
        raise HTTPException(status_code=500, detail=f"WebtoonAPI import failed: {e}")
    except Exception as e:
        logger.error("Search failed: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/webtoon/{webtoon_id}", response_model=WebtoonInfo)
async def get_webtoon_info(webtoon_id: str, source: str = "webtoon"):
    """
    Get detailed information about a webtoon including chapters.
    """
    try:
        from .api.webtoon import WebtoonAPI
        
        api = WebtoonAPI()
        info = await api.get_info(webtoon_id, source)
        return info
        
    except ImportError:
        raise HTTPException(status_code=501, detail="WebtoonAPI not implemented yet")
    except Exception as e:
        logger.error(f"Failed to get webtoon info: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/download", response_model=DownloadResponse)
async def download_webtoon(request: DownloadRequest):
    """
    Download webtoon chapters as PDF.
    
    Starts an async download task and returns a task ID.
    Use GET /download/{task_id} to check status.
    """
    task_id = str(uuid.uuid4())
    
    # Initialize task
    tasks[task_id] = {
        "status": "pending",
        "message": "Download queued",
        "download_url": None,
        "error": None,
        "progress": 0
    }
    
    # Start download in background
    asyncio.create_task(
        process_download(task_id, request)
    )
    
    return DownloadResponse(
        task_id=task_id,
        status="pending",
        message="Download started"
    )


@app.get("/download/{task_id}", response_model=DownloadResponse)
async def get_download_status(task_id: str):
    """
    Check the status of a download task.
    """
    if task_id not in tasks:
        raise HTTPException(status_code=404, detail="Task not found")
    
    task = tasks[task_id]
    return DownloadResponse(
        task_id=task_id,
        status=task["status"],
        message=task["message"],
        download_url=task.get("download_url"),
        error=task.get("error")
    )


@app.get("/download/{task_id}/file")
async def download_file(task_id: str):
    """
    Download the generated PDF file.
    """
    if task_id not in tasks:
        raise HTTPException(status_code=404, detail="Task not found")
    
    task = tasks[task_id]
    if task["status"] != "completed":
        raise HTTPException(status_code=400, detail="Download not completed yet")
    
    file_path = task.get("file_path")
    if not file_path or not Path(file_path).exists():
        raise HTTPException(status_code=404, detail="File not found")
    
    return FileResponse(
        file_path,
        media_type="application/pdf",
        filename=Path(file_path).name
    )


@app.get("/tasks")
async def list_tasks():
    """List all download tasks (admin endpoint)"""
    return {"tasks": list(tasks.keys())}


@app.delete("/tasks/{task_id}")
async def delete_task(task_id: str):
    """Delete a completed task and its file"""
    if task_id not in tasks:
        raise HTTPException(status_code=404, detail="Task not found")
    
    task = tasks[task_id]
    file_path = task.get("file_path")
    
    # Delete file if exists
    if file_path and Path(file_path).exists():
        try:
            Path(file_path).unlink()
        except Exception as e:
            logger.warning(f"Failed to delete file {file_path}: {e}")
    
    # Remove task
    del tasks[task_id]
    
    return {"message": "Task deleted"}


async def process_download(task_id: str, request: DownloadRequest):
    """
    Background task to process webtoon download.
    """
    try:
        tasks[task_id]["status"] = "processing"
        tasks[task_id]["message"] = "Fetching webtoon info..."
        
        from .api.webtoon import WebtoonAPI
        from .core.downloader import WebtoonDownloader
        from .formats.pdf import create_pdf_from_bytes
        
        # Get webtoon info
        api = WebtoonAPI()
        webtoon_id = request.webtoon_url  # In real implementation, extract ID from URL
        
        tasks[task_id]["message"] = "Fetching chapters..."
        webtoon_info = await api.get_info(webtoon_id)
        
        # Filter chapters if specified
        chapters_to_download = webtoon_info.chapters
        if request.chapters:
            chapters_to_download = [
                ch for ch in webtoon_info.chapters 
                if ch.chapter_id in request.chapters
            ]
        
        if not chapters_to_download:
            raise ValueError("No chapters to download")
        
        # Download chapters
        tasks[task_id]["message"] = f"Downloading {len(chapters_to_download)} chapters..."
        downloader = WebtoonDownloader(max_workers=request.max_workers or 4)
        
        all_images = []
        for i, chapter in enumerate(chapters_to_download):
            tasks[task_id]["message"] = f"Downloading chapter {i+1}/{len(chapters_to_download)}..."
            images = await downloader.download_chapter(chapter)
            all_images.extend(images)
        
        if not all_images:
            raise ValueError("No images downloaded")
        
        # Create PDF
        tasks[task_id]["message"] = "Generating PDF..."
        output_path = DOWNLOADS_DIR / f"{task_id}.pdf"
        create_pdf_from_bytes(all_images, output_path, webtoon_info.title)
        
        # Update task status
        tasks[task_id]["status"] = "completed"
        tasks[task_id]["message"] = "Download completed"
        tasks[task_id]["file_path"] = str(output_path)
        tasks[task_id]["download_url"] = f"/download/{task_id}/file"
        
        logger.info(f"Task {task_id} completed successfully")
        
    except Exception as e:
        logger.error(f"Download task {task_id} failed: {e}")
        tasks[task_id]["status"] = "failed"
        tasks[task_id]["message"] = "Download failed"
        tasks[task_id]["error"] = str(e)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
