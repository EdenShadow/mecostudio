#!/bin/bash
# NotebookLM CLI Helper - 简化常用操作

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 检查 nlm 是否安装
check_nlm() {
    if ! command -v nlm &> /dev/null; then
        echo -e "${RED}错误: nlm 未安装${NC}"
        echo "请运行: uv tool install notebooklm-mcp-cli"
        exit 1
    fi
}

# 检查是否登录
check_auth() {
    if ! nlm login --check &> /dev/null; then
        echo -e "${YELLOW}警告: 尚未登录${NC}"
        echo "请运行: nlm login"
        exit 1
    fi
}

# 获取或创建默认笔记本
get_or_create_default_notebook() {
    local notebook_name="${1:-Kimi 默认笔记本}"
    
    # 尝试查找已存在的同名笔记本
    local existing_id=$(nlm notebook list --format json 2>/dev/null | \
        python3 -c "import sys,json; data=json.load(sys.stdin); print([n['id'] for n in data if n.get('title')=='$notebook_name'][0])" 2>/dev/null || echo "")
    
    if [ -n "$existing_id" ]; then
        echo "$existing_id"
        return
    fi
    
    # 创建新笔记本
    echo -e "${GREEN}创建新笔记本: $notebook_name${NC}" >&2
    nlm notebook create "$notebook_name" --description "由 Kimi CLI 自动创建" 2>&1 | \
        grep -oE '^[0-9]+' | head -1
}

# 主命令 case
case "$1" in
    "status")
        check_nlm
        echo "=== NotebookLM CLI 状态 ==="
        nlm --version
        echo ""
        nlm login --check 2>&1 || echo "未登录"
        ;;
    
    "list")
        check_nlm
        check_auth
        echo "=== 我的笔记本 ==="
        nlm notebook list
        ;;
    
    "quick-add")
        # 快速添加 URL 到默认笔记本
        check_nlm
        check_auth
        
        URL="$2"
        if [ -z "$URL" ]; then
            echo "用法: helper.sh quick-add <url>"
            exit 1
        fi
        
        NOTEBOOK_ID=$(get_or_create_default_notebook)
        echo -e "${GREEN}添加到笔记本 ID: $NOTEBOOK_ID${NC}"
        nlm source add "$NOTEBOOK_ID" --url "$URL"
        echo -e "${GREEN}✓ 添加成功${NC}"
        ;;
    
    "ask")
        # 快速查询默认笔记本
        check_nlm
        check_auth
        
        QUESTION="${2:-总结主要观点}"
        NOTEBOOK_ID=$(get_or_create_default_notebook)
        
        echo -e "${YELLOW}查询: $QUESTION${NC}"
        nlm notebook query "$NOTEBOOK_ID" "$QUESTION"
        ;;
    
    "podcast")
        # 生成播客
        check_nlm
        check_auth
        
        NOTEBOOK_ID="${2:-$(get_or_create_default_notebook)}"
        echo -e "${GREEN}为笔记本 $NOTEBOOK_ID 生成播客...${NC}"
        nlm studio create "$NOTEBOOK_ID" --type audio --confirm
        echo -e "${GREEN}✓ 播客生成已启动，稍后使用 'nlm studio list $NOTEBOOK_ID' 查看状态${NC}"
        ;;
    
    *)
        echo "NotebookLM Helper - 简化命令"
        echo ""
        echo "用法:"
        echo "  helper.sh status          - 检查状态和登录情况"
        echo "  helper.sh list            - 列出所有笔记本"
        echo "  helper.sh quick-add <url> - 快速添加 URL 到默认笔记本"
        echo "  helper.sh ask [问题]      - 询问默认笔记本"
        echo "  helper.sh podcast [id]    - 生成播客"
        echo ""
        echo "或者直接使用 nlm 命令:"
        echo "  nlm --help"
        ;;
esac
