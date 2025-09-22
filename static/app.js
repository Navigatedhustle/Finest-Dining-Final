
(() => {
  const $ = (id) => document.getElementById(id);
  const statusDot = $("statusDot");
  const statusText = $("statusText");
  const resultsEl = $("results");

  function setStatus(ok, msg) {
    statusDot.classList.remove("dot-warn");
    statusDot.classList.toggle("dot-ok", !!ok);
    statusText.textContent = msg || (ok ? "Ready" : "Initializing…");
  }

  async function ping() {
    try {
      const r = await fetch("/_ping", { cache: "no-store" });
      setStatus(r.ok, r.ok ? "Ready" : "Offline");
    } catch {
      setStatus(false, "Offline");
    }
  }

  function toast(msg) { alert(msg); }

  function renderResults(payload) {
    resultsEl.innerHTML = "";
    if (!payload || !payload.restaurants || !payload.restaurants.length) {
      resultsEl.innerHTML = `<div class="rest"><div>No results yet. Try a different ZIP/radius or paste a menu URL.</div></div>`;
      return;
    }

    for (const r of payload.restaurants) {
      const badgeKind = r.source === "menu" ? "menu" : "playbook";
      const cuisine = (r.cuisine || []).join(", ");
      const dist = (r.distance_mi != null) ? `${r.distance_mi.toFixed(2)} mi` : "";
      const websiteBtn = r.website ? `<a class="btn-ghost" href="${r.website}" target="_blank" rel="noopener">Open website</a>` : "";

      let picksHtml = "";
      for (const p of (r.picks || []).slice(0, 3)) {
        const confClass = p.confidence === "high" ? "conf-high" : p.confidence === "medium" ? "conf-med" : "conf-low";
        const estK = p.est_kcal != null ? `<span class="chip kcal">${p.est_kcal} kcal</span>` : "";
        const estP = p.est_protein_g != null ? `<span class="chip protein">${p.est_protein_g} g protein</span>` : "";
        const conf = p.confidence ? `<span class="chip ${confClass}">${p.confidence}</span>` : "";
        const mods = (p.modifiers || []).map(m => `<span class="chip">${m}</span>`).join(" ");
        const script = p.server_script || "";

        picksHtml += `
          <div class="pick">
            <div class="pick-title">${p.item_name || "Pick"}</div>
            <div class="pick-row">${estK} ${estP} ${conf}</div>
            ${p.why_it_works ? `<div class="help" style="margin-top:6px">${p.why_it_works}</div>` : ""}
            ${mods ? `<div class="pick-row">${mods}</div>` : ""}
            <div class="actions">
              ${websiteBtn}
              ${script ? `<button class="btn-ghost" data-copy="${script.replace(/"/g,'&quot;')}">Copy ask</button>` : ""}
            </div>
          </div>
        `;
      }

      const html = `
        <div class="rest">
          <div class="rest-head">
            <div class="rest-title">${r.name || "Restaurant"}</div>
            <div class="badges">
              ${dist ? `<span class="badge">${dist}</span>` : ""}
              ${cuisine ? `<span class="badge">${cuisine}</span>` : ""}
              <span class="badge ${badgeKind}">${r.source === "menu" ? "Parsed from Menu" : "Playbook"}</span>
            </div>
          </div>
          <div class="card-content">${picksHtml || "<div class='help'>No picks yet.</div>"}</div>
        </div>
      `;
      resultsEl.insertAdjacentHTML("beforeend", html);
    }

    resultsEl.querySelectorAll("[data-copy]").forEach(btn => {
      btn.addEventListener("click", () => {
        const text = btn.getAttribute("data-copy");
        navigator.clipboard.writeText(text);
        toast("Copied to clipboard");
      });
    });
  }

  async function postJSON(url, data) {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!r.ok) throw new Error(`${url} → ${r.status}`);
    return await r.json();
  }

  function getFlags() {
    const flags = [];
    document.querySelectorAll('input[name="flags"]:checked').forEach(i => flags.push(i.value));
    return flags;
  }

  document.addEventListener("DOMContentLoaded", async () => {
    $("testNetworkBtn").addEventListener("click", ping);
    await ping();

    const params = new URLSearchParams(location.search);
    if (params.get("zip")) {
      $("zipInput").value = params.get("zip");
      $("radiusInput").value = params.get("radius_miles") || "3";
      try {
        const payload = await postJSON("/nearby-by-zip", {
          zip: $("zipInput").value,
          radius_miles: parseFloat($("radiusInput").value || "3"),
          calorie_target: parseInt($("calTarget").value || "600", 10),
          prioritize_protein: $("prioProtein").checked,
          flags: getFlags(),
          only_chains: $("onlyChains").checked
        });
        renderResults(payload);
        setStatus(true, "Ready");
      } catch (e) {
        setStatus(false, "Error");
      }
      history.replaceState({}, "", location.pathname);
    }

    $("zipForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const zip = $("zipInput").value.trim();
      if (!/^\\d{5}$/.test(zip)) { alert("Please enter a 5-digit ZIP."); return; }

      $("searchBtn").disabled = true;
      $("searchBtn").textContent = "Searching…";
      try {
        const payload = await postJSON("/nearby-by-zip", {
          zip,
          radius_miles: parseFloat($("radiusInput").value || "3"),
          calorie_target: parseInt($("calTarget").value || "600", 10),
          prioritize_protein: $("prioProtein").checked,
          flags: getFlags(),
          only_chains: $("onlyChains").checked
        });
        renderResults(payload);
        setStatus(true, "Ready");
      } catch (err) {
        setStatus(false, "Error");
        alert("Search failed. See server logs.");
      } finally {
        $("searchBtn").disabled = false;
        $("searchBtn").textContent = "Search";
      }
    });

    $("urlForm").addEventListener("submit", async (e) => {
      e.preventDefault();
      const url = $("menuUrl").value.trim();
      if (!/^https?:\\/\\//i.test(url)) { alert("Enter a valid http(s) menu URL."); return; }

      $("analyzeUrlBtn").disabled = true;
      $("analyzeUrlBtn").textContent = "Analyzing…";
      try {
        const payload = await postJSON("/analyze-url", {
          url,
          calorie_target: parseInt($("calTarget").value || "600", 10),
          prioritize_protein: $("prioProtein").checked,
          flags: getFlags()
        });
        renderResults(payload);
        setStatus(true, "Ready");
      } catch (err) {
        setStatus(false, "Error");
        alert("Analyze URL failed. Check robots.txt or try a PDF.");
      } finally {
        $("analyzeUrlBtn").disabled = false;
        $("analyzeUrlBtn").textContent = "Analyze URL";
      }
    });
  });
})();
