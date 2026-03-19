#!/usr/bin/env python3
"""
PDF to Markdown converter
Usage: python convert_pdf.py <input.pdf> [output.md]
"""

import sys
import os
from pathlib import Path

def convert_pdf_to_md(input_path, output_path=None):
    """Convert PDF file to Markdown."""
    
    # Try PyMuPDF (fitz) first, fallback to pdfplumber
    try:
        import fitz  # PyMuPDF
        use_fitz = True
    except ImportError:
        try:
            import pdfplumber
            use_fitz = False
        except ImportError:
            print("ERROR: Neither PyMuPDF nor pdfplumber installed.")
            print("Run: pip install pymupdf pdfplumber")
            sys.exit(1)
    
    input_path = Path(input_path)
    if not input_path.exists():
        print(f"ERROR: File not found: {input_path}")
        sys.exit(1)
    
    # Default output path
    if output_path is None:
        output_path = input_path.with_suffix('.md')
    else:
        output_path = Path(output_path)
    
    # Ensure output directory exists
    output_path.parent.mkdir(parents=True, exist_ok=True)
    
    md_lines = []
    title = input_path.stem
    md_lines.append(f"# {title}\n")
    md_lines.append(f"\n*Source: {input_path.name}*\n")
    md_lines.append("---\n")
    
    if use_fitz:
        # Use PyMuPDF
        doc = fitz.open(str(input_path))
        for page_num, page in enumerate(doc, 1):
            text = page.get_text()
            if text.strip():
                md_lines.append(f"\n## Page {page_num}\n")
                md_lines.append(text)
        doc.close()
    else:
        # Use pdfplumber
        with pdfplumber.open(str(input_path)) as pdf:
            for page_num, page in enumerate(pdf.pages, 1):
                text = page.extract_text()
                if text and text.strip():
                    md_lines.append(f"\n## Page {page_num}\n")
                    md_lines.append(text + "\n")
    
    # Write output
    with open(output_path, 'w', encoding='utf-8') as f:
        f.writelines(md_lines)
    
    print(f"✓ Converted: {input_path} → {output_path}")
    return output_path

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python convert_pdf.py <input.pdf> [output.md]")
        sys.exit(1)
    
    input_file = sys.argv[1]
    output_file = sys.argv[2] if len(sys.argv) > 2 else None
    convert_pdf_to_md(input_file, output_file)
