---
name: grab-story
description: Find and fetch story text for Echo from any source — URLs, PDFs, book names, topics, or vague vibes. Saves to backend/db/. Use when asked to "grab", "fetch", "download", "get", or "find" a book, chapter, story, passage, or text. Also use when the user needs demo content, test input, something to paste into Echo, or says things like "find me something good to try", "I need a story", or "get me something visual/immersive".
version: 0.2.0
allowed-tools:
  - Bash
  - Read
  - Write
  - Grep
  - WebFetch
  - Agent
---

# Grab Story — Fetch text for Echo

Finds and fetches story text from any source and saves it to `backend/db/` for use as Echo input. Handles URLs, book names, topics, PDFs, and vague prompts.

## What the user might say

- "grab chapter 3 of Dracula" — specific book + chapter
- "get me something from ancient Greek mythology" — topic/vibe
- "fetch this: https://example.com/story.pdf" — direct URL
- "find a vivid horror passage" — mood-based request
- "download the opening of Moby Dick" — specific section
- "get something with rich visuals for a 3D demo" — Echo-optimized request

## Strategy: Adapt to the input

### If the user gives a direct URL

1. Determine the content type:
   - **HTML page**: Use WebFetch to get the content, or curl + strip HTML tags
   - **PDF**: Download with curl, use `pdftotext` to extract (check `which pdftotext` first, install with `brew install poppler` if missing)
   - **Plain text**: Download directly with curl
2. Extract the requested section (chapter, passage, etc.)
3. Save to `backend/db/`

### If the user gives a book name (with or without chapter)

Search multiple public domain sources in order:
1. **Project Gutenberg** — largest free ebook library
   - Search: `https://www.gutenberg.org/ebooks/search/?query={book+name}`
   - Plain text: `https://www.gutenberg.org/files/{id}/{id}-0.txt` or `https://www.gutenberg.org/cache/epub/{id}/pg{id}.txt`
2. **Standard Ebooks** — beautifully formatted public domain books
   - Browse: `https://standardebooks.org/ebooks/` (search by author/title)
3. **Internet Archive** — huge collection of texts
   - Search: `https://archive.org/search?query={book+name}&mediatype=texts`
4. **WikiSource** — source texts with good structure
5. **General web search** via WebFetch if needed

### If the user gives a topic or vibe

Use your knowledge to suggest 2-3 specific books/passages that would work well for Echo (visually rich, describable physical spaces), then fetch the user's pick. Prioritize:
- Vivid physical descriptions (architecture, landscapes, interiors)
- Strong atmosphere and lighting
- Multiple distinct locations/scenes
- Public domain or freely available

Good Echo sources by genre:
- **Gothic**: Poe, Stoker, Shelley, Lovecraft
- **Adventure**: Verne, Stevenson, Doyle
- **Fantasy**: Tolkien (some public domain), myths, fairy tales
- **Historical**: Dickens, Hugo, Dumas
- **Horror**: Lovecraft, M.R. James, Blackwood
- **Mythology**: Ovid, Homer, Norse Eddas

## Extraction

### For plain text files
1. Download to `/tmp/`
2. Find chapter/section boundaries with grep
3. Strip boilerplate headers/footers (Gutenberg `*** START/END ***`, etc.)
4. Extract the requested section with sed
5. **Verify the end of the extracted text** — read the last 10 lines and make sure it doesn't include the start of the next chapter, page numbers, or other junk. Trim if needed. This is a common mistake with sed range extraction where the end boundary captures a few lines too many.

### For HTML pages
1. Fetch with WebFetch or curl
2. Strip HTML: `<script>`, `<style>`, tags, entities
3. Extract the relevant section

### For PDFs
1. Download to `/tmp/`
2. Convert the full PDF with `pdftotext input.pdf output.txt` (page-range extraction often misses chapter boundaries that don't align to page breaks)
3. Find chapter boundaries in the extracted text with grep, then use sed/head/tail to extract
4. **Always verify the tail** — read the last 10 lines of the output and trim any next-chapter headings, page numbers, or blank lines that leaked in

## Saving

- Save to `backend/db/` in the repo
- Naming: `{book-slug}-ch{N}.txt` or `{descriptive-name}.txt`
  - `great-gatsby-ch3.txt`
  - `norse-creation-myth.txt`
  - `fall-of-house-of-usher.txt`
- Show the user: file path, line count, and first few lines to confirm

## Important notes

- Prefer public domain texts — check copyright status if unsure
- For Echo, prioritize passages with rich spatial/visual descriptions over dialogue-heavy sections
- If the text is very long (>10k chars), warn the user and suggest a shorter section
- Clean up temp files in /tmp after extraction
- If you can't find the exact text, tell the user what you found and ask how to proceed
