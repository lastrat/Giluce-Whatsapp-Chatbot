"""
PDF creation from downloaded images.
"""

from pathlib import Path
from io import BytesIO
from PIL import Image
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader


def create_pdf_from_bytes(
    image_data: List[Tuple[int, bytes]],
    output_path: str | Path,
    title: str = "Webtoon"
) -> Path:
    """
    Create a PDF directly from image bytes without saving to disk first.
    
    Args:
        image_data: List of (index, image_bytes) tuples
        output_path: Output PDF file path
        title: PDF title metadata
    
    Returns:
        Path to created PDF
    """
    output_path = Path(output_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    
    # Sort by index
    image_data.sort(key=lambda x: x[0])
    
    images = []
    for idx, data in image_data:
        try:
            img = Image.open(BytesIO(data))
            img.load()
            
            # Convert to RGB JPEG explicitly
            if img.mode in ('RGBA', 'LA', 'P'):
                if img.mode == 'P':
                    img = img.convert('RGBA')
                background = Image.new('RGB', img.size, (255, 255, 255))
                background.paste(img, mask=img.split()[-1] if img.mode == 'RGBA' else None)
                img = background
            elif img.mode != 'RGB':
                img = img.convert('RGB')
            
            # Force JPEG buffer
            jpeg_buffer = BytesIO()
            img.save(jpeg_buffer, format='JPEG', quality=90)
            jpeg_buffer.seek(0)
            
            images.append((idx, jpeg_buffer))
        except Exception as e:
            logger.warning(f"Failed to process image {idx}: {e}")
            continue
    
    if not images:
        raise ValueError("No valid images provided for PDF creation")
    
    # Create PDF
    tmp_path = output_path.with_name(f"{output_path.name}.part")
    if tmp_path.exists():
        tmp_path.unlink()
    
    try:
        c = canvas.Canvas(str(tmp_path))
        c.setTitle(title)
        
        for idx, img_buffer in images:
            img = Image.open(img_buffer)
            img_width, img_height = img.size
            c.setPageSize((img_width, img_height))
            
            c.drawImage(ImageReader(img_buffer), 0, 0, img_width, img_height)
            c.showPage()
            logger.debug(f"Added page {idx} to PDF")
        
        c.save()
        tmp_path.replace(output_path)
        logger.info(f"Created PDF: {output_path}")
        return output_path
        
    except Exception:
        try:
            tmp_path.unlink()
        except FileNotFoundError:
            pass
        raise


def create_pdf(
    image_paths: List[Path],
    output_path: str | Path,
    title: str = "Webtoon"
) -> Path:
    """
    Create a PDF from a list of image files.
    
    Args:
        image_paths: List of image file paths
        output_path: Output PDF file path
        title: PDF title metadata
    
    Returns:
        Path to created PDF
    """
    output_path = Path(output_path)
    images = []
    
    for idx, img_path in enumerate(sorted(image_paths), 1):
        try:
            img = Image.open(img_path)
            img.load()
            
            if img.mode in ('RGBA', 'LA', 'P'):
                if img.mode == 'P':
                    img = img.convert('RGBA')
                background = Image.new('RGB', img.size, (255, 255, 255))
                background.paste(img, mask=img.split()[-1] if img.mode == 'RGBA' else None)
                img = background
            elif img.mode != 'RGB':
                img = img.convert('RGB')
            
            images.append((idx, img))
        except Exception as e:
            logger.warning(f"Failed to load image {img_path}: {e}")
            continue
    
    if not images:
        raise ValueError("No valid images provided for PDF creation")
    
    # Create PDF
    output_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = output_path.with_name(f"{output_path.name}.part")
    if tmp_path.exists():
        tmp_path.unlink()
    
    try:
        c = canvas.Canvas(str(tmp_path))
        c.setTitle(title)
        
        for idx, img in images:
            img_width, img_height = img.size
            c.setPageSize((img_width, img_height))
            
            img_buffer = BytesIO()
            img.save(img_buffer, format='JPEG', quality=95)
            img_buffer.seek(0)
            
            c.drawImage(ImageReader(img_buffer), 0, 0, img_width, img_height)
            c.showPage()
        
        c.save()
        tmp_path.replace(output_path)
        logger.info(f"Created PDF: {output_path}")
        return output_path
        
    except Exception:
        try:
            tmp_path.unlink()
        except FileNotFoundError:
            pass
        raise
