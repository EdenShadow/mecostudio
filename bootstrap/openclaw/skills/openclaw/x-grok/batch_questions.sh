#!/bin/bash
# Batch x-grok questions

cd ~/.openclaw/skills/x-grok

QUESTIONS=(
    "What are the most underrated AI tools launched in 2026 that actually solve real problems? Not hype, just utility."
    "Which tech founders on X.com have the most contrarian views about AI development that turned out to be right?"
    "What political trends on X.com in 2026 indicate a major shift in how democracies use social media for governance?"
    "Who are the most credible independent journalists on X covering underreported geopolitical conflicts?"
    "How are drone warfare and AI changing military strategy in 2026? What do defense experts on X say about autonomous weapons?"
    "What underground entertainment trends started on X.com and crossed over to mainstream culture in 2026?"
    "Which food creators on X are revolutionizing how we think about sustainable eating without being preachy?"
    "What alternative learning platforms are actually replacing traditional degrees, according to educators on X?"
    "What productivity tools are solo founders using in 2026 to compete with big tech? The real stack, not the marketed one."
    "What are the boldest but most credible predictions for 2027 from thinkers on X who have a track record of being right?"
)

echo "=================================="
echo "🤖 10 X-GROK QUESTIONS"
echo "=================================="

for i in "${!QUESTIONS[@]}"; do
    num=$((i + 1))
    echo ""
    echo "=================================="
    echo "Q$num/10: ${QUESTIONS[$i]:0:50}..."
    echo "=================================="
    
    timeout 90 python3 skill.py "${QUESTIONS[$i]}" 2>&1 | tail -20
    
    if [ $num -lt 10 ]; then
        echo "⏳ Waiting 5s..."
        sleep 5
    fi
done

echo ""
echo "=================================="
echo "✅ COMPLETED"
echo "=================================="
ls -la ~/Documents/知识库/我的助手/综合查询/*.txt | tail -10
