// ============================================
// MUSIC API - Spotify Search, Stream, Playlist
// ============================================

function setupMusicRoutes(app) {
    // Music search via NexRay Spotify
    app.get('/api/music/search', async (req, res) => {
        const q = (req.query.q || '').trim();
        if (!q) return res.json({ tracks: [] });
        try {
            const response = await fetch('https://api.nexray.eu.cc/search/spotify?q=' + encodeURIComponent(q));
            const data = await response.json();
            const tracks = (data.result || []).map(track => ({
                title: track.title || 'Unknown',
                artist: track.artist || 'Unknown',
                url: track.url || '',
                cover: track.thumbnail || '',
                duration: track.duration || '',
                album: track.album || '',
                spotifyUrl: track.url || ''
            }));
            res.json({ tracks });
        } catch (e) { res.json({ tracks: [] }); }
    });

    // Get audio stream URL dari Spotify
    app.get('/api/music/stream', async (req, res) => {
        const spotifyUrl = req.query.url;
        if (!spotifyUrl) return res.status(400).json({ error: 'URL required' });
        try {
            const response = await fetch('https://api.nexray.eu.cc/downloader/spotify?url=' + encodeURIComponent(spotifyUrl));
            const data = await response.json();
            if (data.result?.url) res.json({ url: data.result.url });
            else if (data.url) res.json({ url: data.url });
            else res.json({ error: 'No stream URL found' });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // Default music playlist
    app.get('/api/music', async (req, res) => {
        res.json({
            playlist: [{ id: 1, title: "Lofi Chill Beats", artist: "MikuHost Radio", url: "https://cdn.mikucai.my.id/music/lofi1.mp3", cover: "https://cdn.aceimg.com/27a9dbe8f.jpg" }],
            defaultVolume: 0.5
        });
    });
}

module.exports = { setupMusicRoutes };