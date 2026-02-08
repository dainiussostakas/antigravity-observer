# Changelog

## [1.0.0] - 2026-02-08

### Changed
- Updated extension description to be more concise
- Changed category from "Other" to "Machine Learning" for better discoverability
- Removed `selectedModels` configuration from visible settings UI (now managed internally)

### Documentation
- Expanded README with comprehensive feature list
- Added detailed usage instructions for model selection
- Documented intelligent display logic and sorting priorities
- Added important note about restarting IDE when switching accounts
- Translated all Lithuanian text to English for consistency

### Added
- Initial release of Antigravity Observer
- Real-time quota monitoring for Google AI/Gemini models
- Status bar integration showing quota information
- Click-to-select model functionality from status bar
- Automatic quota refresh at configurable intervals
- Multi-model support with intelligent display logic
- Login/logout state detection
- Usage tracking for model frequency monitoring
- Smart model display prioritization:
  - Selected models shown at top
  - Recently used models sorted by last usage time
  - Most frequently used models (top 3) when no selection
  - Multi-level sort by usage percentage, reset time, and name
- Configurable refresh rate (default: 60 seconds)
- Internal model selection persistence

### Security
- Secure API key handling and storage
- No sensitive data logging
- Encrypted configuration storage

[1.0.0]: https://github.com/yourusername/antigravity-observer/releases/tag/v1.0.0
