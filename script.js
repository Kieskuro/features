
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
        // This implementation accepts full YouTube URLs, handles (@name), channel IDs (UC...),
        // and plain names. Priority:
        // 1) Try a local server proxy endpoint `/api/youtube-subs?identifier=...` if available.
        // 2) If `apiKey` is provided, use YouTube Data API to resolve and fetch `statistics.subscriberCount`.
        // 3) As a last resort, attempt to fetch the channel About page and parse subscriber text.
        async function fetchYouTubeSubs(identifier, apiKey){
          if(!identifier) return 0;

          // Helpers
          function extractNumber(str){
            if(!str) return 0;
            const m = String(str).replace(/\u00A0/g,' ').match(/([0-9][0-9,\.\s]*)/);
            if(!m) return 0;
            return parseInt(m[1].replace(/[^0-9]/g,''), 10) || 0;
          }

          function parseSubscribersFromHTML(html){
            if(!html) return 0;
            try{
              if(typeof DOMParser !== 'undefined'){
                const doc = new DOMParser().parseFromString(html, 'text/html');
                // Prefer span elements containing 'subscriber'
                const spans = doc.querySelectorAll('span');
                for(const s of spans){
                  const t = (s.textContent || '').trim();
                  if(/subscriber/i.test(t)){
                    const n = extractNumber(t);
                    if(n) return n;
                  }
                }
                // fallback: search any metadata-like containers
                const candidates = doc.querySelectorAll('[class*="metadata"], [class*="attributed"], [class*="yt-core"]');
                for(const c of candidates){
                  const t = (c.textContent || '').trim();
                  if(/subscriber/i.test(t)){
                    const n = extractNumber(t);
                    if(n) return n;
                  }
                }
              }
            }catch(e){ /* ignore DOM parse errors */ }
            // final fallback: regex
            const m = html.match(/<span[^>]*>([0-9,\.\s]+)\s*subscribers<\/span>/i) || html.match(/([0-9,\.\s]+)\s*subscribers/i);
            if(m) return extractNumber(m[1] || m[0]);
            return 0;
          }

          function isChannelId(s){
            return /^UC[a-zA-Z0-9_-]{20,}$/.test(s);
          }

          function normalizeIdentifier(input){
            const v = String(input).trim();
            // Full URL? extract the path segment
            try{
              if(/^https?:\/\//i.test(v)){
                const u = new URL(v);
                const p = u.pathname.replace(/^\/+/, '').split('/');
                // patterns: /channel/UC..., /c/Name, /user/Name, /@handle
                if(p[0] === 'channel' && p[1]) return p[1];
                if(p[0] === 'c' && p[1]) return p[1];
                if(p[0] === 'user' && p[1]) return p[1];
                // handle like /@handle
                const m = u.pathname.match(/@[^\/]+/);
                if(m) return m[0];
                // if the URL contains a query to channel, try to find it
                if(u.searchParams && u.searchParams.get('channel_id')) return u.searchParams.get('channel_id');
                // otherwise return the last non-empty segment
                for(let i = p.length - 1; i >= 0; i--){ if(p[i]) return p[i]; }
              }
            }catch(e){ /* not a url */ }
            return v;
          }

          const id = normalizeIdentifier(identifier);

          // 1) Try server-side proxy first (if available). Expect JSON { subscriberCount: N }
          try{
            const proxyRes = await fetch(`/api/youtube-subs?identifier=${encodeURIComponent(id)}`);
            if(proxyRes.ok){
              const pj = await proxyRes.json();
              const val = pj.subscriberCount || pj.subscribers || pj.count || pj.subscriber_count || 0;
              if(Number(val)) return Number(val);
            }
          }catch(e){ /* no proxy or network error; continue */ }

          // 2) If API key provided, use YouTube Data API
          if(apiKey){
            try{
              let channelId = id;
              // If id isn't a channelId, resolve via search
              if(!isChannelId(id)){
                const q = encodeURIComponent(id.replace(/^@/, ''));
                const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=channel&q=${q}&maxResults=1&key=${encodeURIComponent(apiKey)}`;
                const sres = await fetch(searchUrl);
                if(sres.ok){
                  const sj = await sres.json();
                  const ch = sj.items && sj.items[0];
                  if(ch && ch.snippet && ch.snippet.channelId) channelId = ch.snippet.channelId;
                }
              }
              // Fetch statistics
              if(isChannelId(channelId)){
                const url = `https://www.googleapis.com/youtube/v3/channels?part=statistics&id=${encodeURIComponent(channelId)}&key=${encodeURIComponent(apiKey)}`;
                const r = await fetch(url);
                if(r.ok){
                  const j = await r.json();
                  const item = j.items && j.items[0];
                  if(item && item.statistics && !item.statistics.hiddenSubscriberCount){
                    return parseInt(item.statistics.subscriberCount || 0, 10) || 0;
                  }
                }
              }
            }catch(e){ /* ignore API errors and fall back */ }
          }

          // 3) Try direct about-page fetches (best-effort; may be blocked by CORS)
          const candidates = [];
          if(isChannelId(id)) candidates.push(`https://www.youtube.com/channel/${id}/about`);
          // handle may start with @
          if(/^@/.test(id)){
            candidates.push(`https://www.youtube.com/${id}/about`);
            candidates.push(`https://www.youtube.com/c/${id.replace(/^@/, '')}/about`);
            candidates.push(`https://www.youtube.com/user/${id.replace(/^@/, '')}/about`);
          } else {
            candidates.push(`https://www.youtube.com/c/${id}/about`);
            candidates.push(`https://www.youtube.com/user/${id}/about`);
            candidates.push(`https://www.youtube.com/${id}/about`);
          }

          for(const u of candidates){
            try{
              const res = await fetch(u, { mode: 'cors' });
              if(!res.ok) continue;
              const text = await res.text();
              // prefer parsing ytInitialData if present
              const mJson = text.match(/ytInitialData\s*=\s*(\{[\s\S]*?\});/);
              if(mJson && mJson[1]){
                try{
                  const obj = JSON.parse(mJson[1]);
                  // recursive search for subscriberCountText
                  function findSubscriberText(node){
                    if(!node || typeof node !== 'object') return null;
                    if(node.subscriberCountText){
                      const s = node.subscriberCountText;
                      if(typeof s.simpleText === 'string') return s.simpleText;
                      if(Array.isArray(s.runs) && s.runs[0] && s.runs[0].text) return s.runs[0].text;
                    }
                    for(const k in node){
                      if(!Object.prototype.hasOwnProperty.call(node,k)) continue;
                      try{ const found = findSubscriberText(node[k]); if(found) return found;}catch(e){}
                    }
                    return null;
                  }
                  const subText = findSubscriberText(obj);
                  if(subText && /subscriber/i.test(String(subText)) && !/video/i.test(String(subText))){
                    const n = extractNumber(subText);
                    if(n) return n;
                  }
                }catch(e){ /* JSON parse error - continue */ }
              }
              // fallback to DOM/regex parse
              const parsed = parseSubscribersFromHTML(text);
              if(parsed) return parsed;
            }catch(e){ /* CORS or network error; try next candidate */ }
          }

          return 0;
        }

        async function fetchDiscordMembers(guildId){
          if(!guildId) return 0;
          // 1) Try server-side proxy (keeps tokens secret)
          try{
            const res = await fetch(`/api/discord-members?guildId=${encodeURIComponent(guildId)}`);
            if(res.ok){
              const j = await res.json();
              return j.memberCount || j.approximate_member_count || j.presence_count || 0;
            }
          }catch(e){ /* ignore and fallback to public endpoints */ }

          // 2) Try Discord public widget JSON (works if widget is enabled)
          try{
            const url = `https://discord.com/api/guilds/${encodeURIComponent(guildId)}/widget.json`;
            const res = await fetch(url, { mode: 'cors' });
            if(res.ok){
              const j = await res.json();
              // widget may provide presence_count or members array
              return j.presence_count || j.approximate_member_count || (Array.isArray(j.members) ? j.members.length : 0) || 0;
            }
          }catch(e){ /* likely CORS or network error; continue to proxy fallback */ }

          return 0;
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