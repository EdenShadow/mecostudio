#!/usr/bin/env python3
"""
Smart document converter - auto-detects file type and converts
Usage: python convert.py <input_file> [output_folder]
"""

import sys
import os
from pathlib import Path

def main():
    if len(sys.argv) < 2:
        print("Usage: python convert.py <input_file> [output_folder]")
        print("Example: python convert.py document.docx ~/Documents/知识库/")
        sys.exit(1)
    
    input_file = Path(sys.argv[1])
    output_folder = Path(sys.argv[2]) if len(sys.argv) > 2 else None
    
    if not input_file.exists():
        print(f"ERROR: File not found: {input_file}")
        sys.exit(1)
    
    # Determine output path
    if output_folder:
        output_folder.mkdir(parents=True, exist_ok=True)
        output_file = output_folder / f"{input_file.stem}.md"
    else:
        output_file = input_file.with_suffix('.md')
    
    # Route to appropriate converter
    suffix = input_file.suffix.lower()
    
    if suffix == '.docx':
        from convert_docx import convert_docx_to_md
        convert_docx_to_md(input_file, output_file)
    elif suffix == '.pdf':
        from convert_pdf import convert_pdf_to_md
        convert_pdf_to_md(input_file, output_file)
    elif suffix == '.doc':
        print("WARNING: .doc (old Word format) requires antiword or LibreOffice")
        print("Try: libreoffice --headless --convert-to docx input.doc")
        sys.exit(1)
    else:
        print(f"ERROR: Unsupported file format: {suffix}")
        print("Supported: .docx, .pdf")
        sys.exit(1)

if __name__ == "__main__":
    # First ensure dependencies
    from ensure_deps import check_and_install
    check_and_install()
    
    # Then convert
    main()
