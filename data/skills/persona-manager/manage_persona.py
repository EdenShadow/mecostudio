import argparse
import os
import sys

def update_soul(agent_id, content):
    home = os.path.expanduser("~")
    workspace = os.path.join(home, ".openclaw", f"workspace-{agent_id}")
    soul_path = os.path.join(workspace, "SOUL.md")
    
    if not os.path.exists(workspace):
        print(f"Error: Workspace for agent {agent_id} not found at {workspace}")
        return False
        
    try:
        with open(soul_path, 'w', encoding='utf-8') as f:
            f.write(content)
        print(f"Successfully updated SOUL.md for {agent_id}")
        return True
    except Exception as e:
        print(f"Error updating SOUL.md: {e}")
        return False

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Update agent persona")
    parser.add_argument("agent_id", help="The ID of the agent")
    parser.add_argument("--content", help="New content for SOUL.md")
    parser.add_argument("--file", help="Path to file containing new content")
    
    args = parser.parse_args()
    
    content = args.content
    if args.file:
        try:
            with open(args.file, 'r', encoding='utf-8') as f:
                content = f.read()
        except Exception as e:
            print(f"Error reading content file: {e}")
            sys.exit(1)
            
    if not content:
        if args.content:
            content = args.content
        else:
            print("Error: No content provided via --content or --file")
            sys.exit(1)
        
    success = update_soul(args.agent_id, content)
    sys.exit(0 if success else 1)
