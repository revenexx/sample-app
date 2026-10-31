# Changelog

What each version of this app changed. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); `manifest.json#version` is strict semver, one bump per pull request. Versions before 0.9.3 are recorded only in the git history; 0.9.2 was registered from outside `main`, so this version skips it.

## [0.9.3] — unreleased

Completes the Marketplace listing the release gate checks ([MAR-19](https://linear.app/revenexx/issue/MAR-19)). No schema change, no route change.

### Changed

- `manifest.json#icon` is `chat-round-line`, the Solar glyph of the Greetings navigation entry, which the Cockpit already draws for the app.
- `billing.json#legal` names the privacy policy (https://www.revenexx.com/privacy) and terms (https://www.revenexx.com/terms), the same pages the other revenexx apps link.
- This changelog starts here. The release gate reads the entry for the submitted version from it.
