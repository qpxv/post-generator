#!/bin/bash

JOURNAL_DIR="/Users/benwinzer/Desktop/2026"
LOCK_FILE="/tmp/post-generator.lock"
DELAY=10
FRESH_WINDOW=120  # seconds — only trigger if newest file is younger than this

# Prevent parallel runs
if [ -f "$LOCK_FILE" ]; then
  if kill -0 "$(cat "$LOCK_FILE")" 2>/dev/null; then
    echo "$(date): already running (pid $(cat "$LOCK_FILE")), skipping"
    exit 0
  fi
fi
echo $$ > "$LOCK_FILE"
trap "rm -f '$LOCK_FILE'" EXIT

# Find the newest .txt file in the journal folder
NEWEST=$(ls -t "$JOURNAL_DIR"/*.txt 2>/dev/null | head -1)
if [ -z "$NEWEST" ]; then
  echo "$(date): no .txt files found in $JOURNAL_DIR"
  exit 0
fi

# Only proceed if the file was just created (within FRESH_WINDOW seconds)
MTIME=$(stat -f %m "$NEWEST")
NOW=$(date +%s)
AGE=$((NOW - MTIME))

if [ "$AGE" -gt "$FRESH_WINDOW" ]; then
  echo "$(date): newest file is ${AGE}s old (> ${FRESH_WINDOW}s), not a fresh export — skipping"
  exit 0
fi

echo "$(date): new journal file detected: $(basename "$NEWEST") (${AGE}s old)"
echo "$(date): waiting ${DELAY}s before generating posts..."
sleep "$DELAY"

echo "$(date): launching post generator..."
/Users/benwinzer/Desktop/run-post.sh
