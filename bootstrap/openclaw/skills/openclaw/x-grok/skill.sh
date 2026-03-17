#!/bin/bash
# X.com Grok Query Skill - Wrapper
# 
# Usage:
#   x-grok "你的问题"
# 
# Examples:
#   x-grok "帮我找一些x上知名的财经博主"
#   x-grok "What are the latest AI trends"

QUERY="$*"

if [ -z "$QUERY" ]; then
    echo "X.com Grok Query Skill"
    echo ""
    echo "Usage: x-grok <question>"
    echo ""
    echo "Examples:"
    echo "  x-grok 帮我找一些x上知名的财经博主"
    echo "  x-grok What are the latest AI trends"
    echo "  x-grok 解释一下比特币的最新价格走势"
    echo ""
    echo "Output: ~/Documents/知识库/X-Grok/[Timestamp]_[query].txt"
    exit 0
fi

# Generate filename
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
FILENAME=$(echo "$QUERY" | sed 's/[<>:"/\\|?*]//g; s/ /_/g; s/......$//' | cut -c1-40)
OUTPUT_DIR="$HOME/Documents/知识库/X-Grok"
OUTPUT_FILE="$OUTPUT_DIR/${TIMESTAMP}_${FILENAME}.txt"

# Create directory
mkdir -p "$OUTPUT_DIR"

echo "X.com Grok Query"
echo "================"
echo ""
echo "📝 Question: $QUERY"
echo "📁 Output: $OUTPUT_FILE"
echo ""
echo "🌐 Opening X.com..."
echo ""

# Open X.com in browser
open "https://x.com" 2>/dev/null || echo "Please open https://x.com manually"

echo ""
echo "📋 Steps:"
echo "1. Find and click the Grok button on X.com"
echo "2. Ask your question: \"$QUERY\""
echo "3. Wait for Grok's response"
echo "4. Copy the answer"
echo "5. Paste it below and press Ctrl+D to save"
echo ""
echo "📥 Paste answer (Ctrl+D when done):"

# Read and save the answer
cat > "$OUTPUT_FILE" <<EOF
X.com Grok Query Result
=======================
Date: $(date)
Question: $QUERY
=======================

EOF

# Read additional content
cat >> "$OUTPUT_FILE"

echo ""
echo "✅ Saved to: $OUTPUT_FILE"
