#!/usr/bin/env python3
"""
Ensure all dependencies are installed
Usage: python ensure_deps.py
"""

import subprocess
import sys

def install_package(package):
    """Install a package using pip."""
    print(f"Installing {package}...")
    subprocess.check_call([sys.executable, "-m", "pip", "install", package])

def check_and_install():
    """Check and install required packages."""
    
    packages = {
        "python-docx": "docx",
        "pdfplumber": "pdfplumber",
        "PyMuPDF": "fitz"
    }
    
    missing = []
    
    for package, import_name in packages.items():
        try:
            __import__(import_name)
            print(f"✓ {package} is installed")
        except ImportError:
            print(f"✗ {package} is missing")
            missing.append(package)
    
    if missing:
        print(f"\nInstalling missing packages: {', '.join(missing)}")
        for package in missing:
            install_package(package)
        print("\n✓ All dependencies installed!")
    else:
        print("\n✓ All dependencies are already installed")
    
    return len(missing) == 0

if __name__ == "__main__":
    check_and_install()
