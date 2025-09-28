#!/bin/bash

# Initialize Git repository
git init

# Configure Git (replace with your information)
git config user.name "Your Name"
git config user.email "your.email@example.com"

# Add all files
git add .

# Make initial commit
git commit -m "Initial commit: Roll Call App"

# Create main branch (if not already on main)
git branch -M main

# Instructions for adding remote repository
echo "Repository initialized with initial commit."
echo ""
echo "To connect to a remote GitHub repository, run:"
echo "git remote add origin https://github.com/yourusername/rollcall-app-ionic.git"
echo "git push -u origin main"