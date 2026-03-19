---
name: doc-to-md
description: Convert DOCX and PDF files to Markdown format and save to specified folders. Use when user needs to extract and convert document content (DOCX/PDF) into structured Markdown files for knowledge base or archiving. Supports automatic library installation, document parsing, and organized output.
---

# DOC to Markdown Converter

Convert Microsoft Word (.docx) and PDF documents to clean, structured Markdown files.

## Capabilities

- **DOCX Support**: Extract text, headings, tables, and basic formatting
- **PDF Support**: Extract text and structure using pdfplumber
- **Auto-installation**: Automatically installs required Python libraries if missing
- **Organized Output**: Saves converted files to specified knowledge base folders

## Workflow

### Step 1: Check/Install Dependencies

Required Python packages:
- `python-docx` - For DOCX parsing
- `pdfplumber` - For PDF text extraction
- `PyMuPDF` (fitz) - Alternative PDF parser (optional, better formatting)

```bash
pip install python-docx pdfplumber pymupdf
```

### Step 2: Convert Document

For DOCX files:
1. Load document with python-docx
2. Extract paragraphs and preserve heading hierarchy
3. Convert tables to Markdown table format
4. Output clean Markdown

For PDF files:
1. Load with pdfplumber or PyMuPDF
2. Extract text page by page
3. Detect headers/structure if possible
4. Output Markdown

### Step 3: Save to Destination

Default knowledge base locations:
- `~/Documents/知识库/` - General knowledge base
- `~/workspace/knowledge/` - Workspace knowledge
- Or user-specified path

## Usage Examples

```
Convert this DOCX to markdown: /path/to/file.docx
Save to: ~/Documents/知识库/经验/
```

```
Extract this PDF as markdown: report.pdf
Output folder: ~/workspace/knowledge/research/
```

## Output Format

```markdown
# Document Title (from first heading or filename)

## Section 1

Content...

## Section 2

More content...

---
*Converted from: filename.docx*
*Date: YYYY-MM-DD*
```

## Scripts

Use the helper scripts in `scripts/` directory:

- `convert_docx.py` - Convert DOCX to Markdown
- `convert_pdf.py` - Convert PDF to Markdown
- `ensure_deps.py` - Check and install dependencies

## Notes

- Preserves heading hierarchy (# ## ###)
- Converts tables to Markdown table syntax
- Strips complex formatting (fonts, colors)
- Handles Chinese and international text
- Large PDFs may take time to process
