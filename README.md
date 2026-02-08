# Antigravity Observer

Antigravity Observer is an extension for the Antigravity IDE designed to track and visualize usage quotas for Gemini AI models. It provides real-time insights into your API limits and consumption directly within your development environment, ensuring you can manage resources effectively and avoid unexpected service interruptions while you code.

## Features

- **Real-time Quota Monitoring** - Track your current usage and remaining quota for active AI models
- **Status Bar Integration** - View quota information at a glance directly in the IDE status bar
- **Model Selection** - Easily switch between available Gemini models from the status bar
- **Usage Tracking** - Monitor which models you use most frequently to make informed decisions
- **Automatic Updates** - Quota information refreshes automatically to keep you informed
- **Multi-model Support** - Track quota across different Gemini model variants
- **Login State Detection** - Automatically adjusts display when logged in or logged out

## How to Use

### Model Selection

To select an AI model, **click on the status bar** at the bottom of the IDE where quota information is displayed. A list of available Gemini models will appear - choose your desired model from the list.

### Display Logic

The extension automatically determines which models to display in the status bar using intelligent display logic:

- **Selected models** - Your actively selected models are always shown at the top
- **Recently used** - Models are sorted by last usage time (newest first)
- **Most frequently used** - When no active selection, shows the 3 most used models
- **Sort order** - Models are sorted by: usage percentage → reset time → name

## Important Note

**When switching to a different account, it is recommended to restart the Antigravity IDE** to ensure proper quota information display and avoid cache-related issues.

