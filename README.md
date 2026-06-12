# FIFA World Cup 2026 Fixture & Tracker

A stunning, interactive, and fully offline-capable (via LocalStorage) single-page tracker for the FIFA World Cup 2026. This app lists all group stages and provides a dynamic, perfectly aligned Knockout Bracket leading to the final.

## Features

- **Modern Glassmorphism UI**: Uses a responsive, sleek dark mode design with modern fonts and animations.
- **Group Stages & Bracket**: Fully generated tree from Round of 32 down to the Final.
- **Interactive Scoring**: Input match scores directly into the UI. The scores are automatically saved to your browser's LocalStorage, meaning your results survive page refreshes!
- **Data Export**: Click "Export Data" to generate an updated `data.json` file. You can replace the existing `data.json` in the codebase to make your scores the new default for all users.
- **Tooltips**: Hover over any match to see kickoff time and stadium location details.

## How to update Match Results

By default, the data is pulled from `data.json`. 

1. Simply type your scores directly on the webpage. It automatically saves to your browser.
2. If you want these scores to show up for everyone visiting your site, click **Export Data**. 
3. This downloads a new `data.json` file. Replace the `data.json` in this folder with your newly downloaded file.
4. Commit and push the updated `data.json` to GitHub!

## How to Host for FREE on GitHub Pages

Hosting this site so anyone in the world can use it is completely free and takes 2 minutes.

1. **Create a GitHub Repository:**
   - Go to [GitHub](https://github.com/) and create a new public repository (e.g., `worldcup-tracker`).
2. **Upload Files:**
   - Upload all the files in this folder (`index.html`, `style.css`, `app.js`, `data.json`) to your new repository.
3. **Enable GitHub Pages:**
   - In your repository, click on **Settings** (the gear icon).
   - In the left sidebar, scroll down and click on **Pages**.
   - Under the "Build and deployment" section, find the "Source" dropdown and make sure it says **Deploy from a branch**.
   - Under "Branch", select `main` (or `master`) and keep the folder as `/ (root)`. Click **Save**.
4. **Your site is live!**
   - After 1-2 minutes, GitHub will give you a link at the top of the Pages settings (e.g., `https://yourusername.github.io/worldcup-tracker`). 
   - Share this link with your friends!

## Modifying the Data Programmatically

If you ever need to reset or bulk-change the tournament data, you can edit the `generate_data.py` script provided in this folder and re-run it:
```bash
python3 generate_data.py
```
This will output a fresh `data.json` file!
