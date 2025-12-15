
      (function(){
        const ch1 = document.querySelector('ch1');
        const ch2 = document.querySelector('ch2');
        if(!ch1 || !ch2) return;
        const icon1 = ch1.querySelector('icon');
        const icon2 = ch2.querySelector('icon');

        function switchTo(showEl, hideEl){
          showEl.classList.remove('hidden');
          hideEl.classList.add('hidden');
        }

        // Format large numbers as short strings (e.g. 1.2K, 3.4M, 5B)
        function formatShort(n){
          const num = Number(n) || 0;
          const abs = Math.abs(num);
          let v, suffix = '';
          if (abs >= 1e9) { v = (num / 1e9).toFixed(1); suffix = 'B'; }
          else if (abs >= 1e6) { v = (num / 1e6).toFixed(1); suffix = 'M'; }
          else if (abs >= 1e3) { v = (num / 1e3).toFixed(1); suffix = 'K'; }
          else { return String(num); }
          // strip trailing .0
          v = v.replace(/\.0$/, '');
          return v + suffix;
        }

        // initialize: show ch1, hide ch2
        ch1.classList.remove('hidden');
        ch2.classList.add('hidden');

        if(icon1) icon1.addEventListener('click', async function(e){
          e.preventDefault();
          switchTo(ch2, ch1);
          await updateCounts(ch2);
        });
        if(icon2) icon2.addEventListener('click', async function(e){
          e.preventDefault();
          switchTo(ch1, ch2);
          await updateCounts(ch1);
        });

        // Static-friendly YouTube fetch (client-side).
        // Fallback order:
        // 1) If an API key is provided (data-yt-api-key), call YouTube Data API (note: exposes key in static site).
        // 2) Try to fetch the channel "about" page and parse subscriber count from HTML (may be blocked by CORS).
        // 3) Try jina.ai HTML proxy as a last-resort text proxy.
        async function fetchYouTubeSubs(channelId, apiKey){
          if(!channelId) return 0;
          // Helper to call channels.statistics once we have a channelId
          async function fetchStatsByChannelId(id){
            try{
              const url = `https://www.googleapis.com/youtube/v3/channels?part=statistics&id=${encodeURIComponent(id)}&key=${encodeURIComponent(apiKey)}`;
              const res = await fetch(url);
              if(!res.ok) return null;
              const j = await res.json();
              const item = j.items && j.items[0];
              if(item && item.statistics){
                // prefer subscriberCount; ensure it's not hidden
                if(item.statistics.hiddenSubscriberCount) return null;
                return parseInt(item.statistics.subscriberCount || 0, 10) || 0;
              }
            }catch(e){ /* ignore */ }
            return null;
          }

          // 1) YouTube Data API (requires API key)
          if(apiKey){
            try{
              let resolvedId = channelId;
              // If identifier looks like a handle (starts with @) or doesn't look like a channel ID (UC...)
              if(/^@/.test(channelId) || !/^UC[a-zA-Z0-9_-]{20,}$/.test(channelId)){
                // try to resolve via search by query (strip leading @ for handles)
                const q = encodeURIComponent(channelId.replace(/^@/, ''));
                const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=channel&q=${q}&maxResults=1&key=${encodeURIComponent(apiKey)}`;
                const sres = await fetch(searchUrl);
                if(sres.ok){
                  const sj = await sres.json();
                  const ch = sj.items && sj.items[0];
                  if(ch && ch.snippet && ch.snippet.channelId) resolvedId = ch.snippet.channelId;
                }
              }

              const stats = await fetchStatsByChannelId(resolvedId);
              if(Number.isFinite(stats)) return stats;
            }catch(e){ /* ignore and fallback */ }
          }

          // helper to extract number from strings like "1,234 subscribers" or JSON snippets
          function extractNumber(str){
            if(!str) return 0;
            const m = str.replace(/\u00A0/g,' ').match(/([0-9][0-9,\.\s]*)/);
            if(!m) return 0;
            return parseInt(m[1].replace(/[^0-9]/g,''), 10) || 0;
          }

          // 2) Try fetching the channel about page directly
          const aboutUrls = [
            `https://www.youtube.com/channel/${channelId}/about`,
            `https://www.youtube.com/user/${channelId}/about`,
            `https://www.youtube.com/c/${channelId}/about`
          ];

          for(const u of aboutUrls){
            try{
              const res = await fetch(u, { mode: 'cors' });
              if(!res.ok) continue;
              const text = await res.text();
              // Common patterns
              let m = text.match(/"subscriberCountText"\s*:\s*\{[^}]*"simpleText"\s*:\s*"([^"]+)"/);
              if(!m) m = text.match(/"subscriberCountText"\s*:\s*\{[^}]*"runs"\s*:\s*\[\{[^}]*"text"\s*:\s*"([^"]+)"/);
              if(!m) m = text.match(/(\d[0-9,\.\s]*)\s*subscribers/gi);
              if(m){
                const val = Array.isArray(m) ? m[1] || m[0] : m[0];
                const n = extractNumber(val);
                if(n) return n;
              }
            }catch(e){ /* CORS or network error: continue to next */ }
          }

          // 3) Try jina.ai text proxy (third-party) as last resort
          try{
            const proxy = `https://r.jina.ai/http://www.youtube.com/channel/${channelId}/about`;
            const res = await fetch(proxy);
            if(res.ok){
              const text = await res.text();
              const m = text.match(/subscriber[s]?\W*([0-9,\.\s]+)/i) || text.match(/([0-9,\.\s]+)\s*subscribers/i);
              if(m){
                return extractNumber(m[1] || m[0]);
              }
            }
          }catch(e){ /* ignore */ }

          return 0;
        }

        async function fetchDiscordMembers(guildId){
          if(!guildId) return 0;
          try{
            const res = await fetch(`/api/discord-members?guildId=${encodeURIComponent(guildId)}`);
            if(!res.ok) return 0;
            const j = await res.json();
            return j.memberCount || 0;
          }catch(e){ return 0; }
        }

        async function updateCounts(chEl){
          if(!chEl) return;
          const yt = chEl.dataset.youtubeId;
          const ytKey = chEl.dataset.ytApiKey || chEl.dataset.ytApi || chEl.dataset.youtubeApiKey || null;
          const dc = chEl.dataset.discordId;
          const h1 = chEl.querySelector('h1');
          const base = parseInt(h1 && h1.dataset.baseCount || 0, 10) || 0;
          const [subs, members] = await Promise.all([fetchYouTubeSubs(yt, ytKey), fetchDiscordMembers(dc)]);
          const total = base + (Number(subs) || 0) + (Number(members) || 0);
          if(h1) h1.textContent = `${formatShort(total)} Followers`;
        }

        // Initialize counts from HTML `data-base-count`, then fetch live updates
        (async function initCountsFromHTML(){
          try{
            const h1a = ch1.querySelector('h1');
            const h1b = ch2.querySelector('h1');
            if(h1a){
              const base = parseInt(h1a.dataset.baseCount || 0, 10) || 0;
              h1a.textContent = `${formatShort(base)} Followers`;
            }
            if(h1b){
              const base = parseInt(h1b.dataset.baseCount || 0, 10) || 0;
              h1b.textContent = `${formatShort(base)} Followers`;
            }
          }catch(e){ /* ignore */ }

          // Fetch live counts for the currently visible channel
          await updateCounts(ch1);
        })();
      })();