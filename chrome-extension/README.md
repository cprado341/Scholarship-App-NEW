# Scholarship Agent Autofill Extension

This is a local unpacked Chrome extension. It reads only approved fill plans from the Scholarship Agent app API. It does not read SQLite directly and it never clicks final submit.

## Install

1. Open `chrome://extensions`.
2. Turn on `Developer mode`.
3. Click `Load unpacked`.
4. Select this folder: `chrome-extension`.

## Use

1. Run the local Scholarship Agent portal.
2. In the Application Review Queue, approve the required safety items.
3. Click `Approve & Start Autofill` or `Fill With Extension`.
4. The extension opens the scholarship page, fills known fields, and stops before final submit.

File uploads remain manual in this first version.
