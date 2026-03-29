---
name: grab-story
description: Fetch a public domain book chapter from Project Gutenberg and save it to backend/db/ for use as Echo story input. Use when asked to "grab", "fetch", "download", or "get" a book, chapter, or story passage.
version: 0.1.0
allowed-tools:
  - Bash
  - Read
  - Write
  - Grep
  - WebFetch
---

# Grab Story — Fetch public domain text for Echo

Fetches a book chapter or passage from Project Gutenberg and saves it to `backend/db/` so it can be pasted into Echo's story input.

## How to use

The user will say something like:
- "grab chapter 3 of Dracula"
- "fetch the opening of Moby Dick"
- "get 20,000 Leagues chapter 10"

### Step 1: Find the book on Project Gutenberg

Search for the book using the Gutenberg search page:
```
https://www.gutenberg.org/ebooks/search/?query={book+name}
```

Use WebFetch to find the ebook number. Then get the plain text URL:
```
https://www.gutenberg.org/files/{ebook_id}/{ebook_id}-0.txt
```

If the `-0.txt` URL doesn't work, try:
```
https://www.gutenberg.org/cache/epub/{ebook_id}/pg{ebook_id}.txt
```

### Step 2: Download the full text

```bash
curl -sL -o /tmp/gutenberg-{ebook_id}.txt "https://www.gutenberg.org/files/{ebook_id}/{ebook_id}-0.txt"
```

### Step 3: Find chapter boundaries

Use grep to find the start and end lines of the requested chapter:
```bash
grep -n "Chapter\|CHAPTER" /tmp/gutenberg-{ebook_id}.txt
```

If chapters aren't labeled cleanly, search for known opening lines of the chapter.

### Step 4: Extract the chapter

Use sed to extract the lines between chapter start and the next chapter:
```bash
sed -n '{start_line},{end_line}p' /tmp/gutenberg-{ebook_id}.txt > backend/db/{book-slug}-ch{N}.txt
```

Naming convention: `{book-slug}-ch{N}.txt`
- `great-gatsby-ch3.txt`
- `dracula-ch1.txt`
- `moby-dick-ch1.txt`

### Step 5: Confirm

Tell the user:
- File saved at `backend/db/{filename}`
- Line count
- Show the first few lines so they can verify it's the right content

## Important notes

- Only fetch from Project Gutenberg (gutenberg.org) — all texts are public domain
- Save to `backend/db/` directory in the repo
- Strip the Gutenberg header/footer (lines before/after `*** START/END OF THE PROJECT GUTENBERG EBOOK ***`)
- If the user asks for a specific passage rather than a full chapter, extract just that portion
- Clean up temp files in /tmp after extraction
