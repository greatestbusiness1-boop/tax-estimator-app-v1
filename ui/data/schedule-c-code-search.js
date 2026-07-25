(function () {
  "use strict";

  const cache = new Map();

  function normalize(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  const stopWords = new Set([
    "a", "an", "and", "at", "business", "company", "for",
    "from", "in", "of", "or", "other", "service", "services",
    "the", "to", "with"
  ]);

  function tokens(value) {
    return normalize(value)
      .split(" ")
      .filter((token) => token && !stopWords.has(token));
  }

  async function load(taxYear) {
    const year = String(taxYear || "").trim();

    if (!/^\d{4}$/.test(year)) {
      throw new Error("Select a valid tax year first.");
    }

    if (cache.has(year)) {
      return cache.get(year);
    }

    const response = await fetch(
      `/data/schedule-c-codes-${encodeURIComponent(year)}.json`,
      { cache: "no-store" }
    );

    if (!response.ok) {
      throw new Error(
        `The official Schedule C business-code list for ${year} is not loaded yet. Select Office Review Needed.`
      );
    }

    const data = await response.json();

    if (
      !data ||
      !Array.isArray(data.codes) ||
      data.codes.length === 0
    ) {
      throw new Error(
        `The Schedule C code list for ${year} could not be read.`
      );
    }

    cache.set(year, data);
    return data;
  }

  function scoreEntry(entry, query) {
    const normalizedQuery = normalize(query);
    const queryTokens = tokens(query);
    const code = String(entry.code || "");
    const description = normalize(entry.description);
    const sector = normalize(entry.sector);
    const aliases = normalize(
      Array.isArray(entry.aliases)
        ? entry.aliases.join(" ")
        : ""
    );
    const searchText = `${description} ${sector} ${aliases}`;
    let score = 0;

    if (!normalizedQuery) {
      return 0;
    }

    if (code === normalizedQuery) {
      score += 1000;
    }

    if (description === normalizedQuery) {
      score += 700;
    }

    if (description.includes(normalizedQuery)) {
      score += 350;
    }

    if (aliases.includes(normalizedQuery)) {
      score += 420;
    }

    queryTokens.forEach((token) => {
      if (description.includes(token)) score += 55;
      if (aliases.includes(token)) score += 80;
      if (sector.includes(token)) score += 20;
      if (code.startsWith(token)) score += 25;
    });

    const matchedTokens = queryTokens.filter(
      (token) => searchText.includes(token)
    ).length;

    if (
      queryTokens.length > 1 &&
      matchedTokens === queryTokens.length
    ) {
      score += 120;
    }

    return score;
  }

  async function search(query, taxYear, limit = 8) {
    const data = await load(taxYear);
    const normalizedQuery = normalize(query);

    if (!normalizedQuery) {
      return {
        metadata: data,
        results: []
      };
    }

    const results = data.codes
      .map((entry) => ({
        ...entry,
        score: scoreEntry(entry, normalizedQuery)
      }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return String(a.code).localeCompare(String(b.code));
      })
      .slice(0, Math.max(1, Number(limit) || 8));

    return {
      metadata: data,
      results
    };
  }

  async function findByCode(code, taxYear) {
    const data = await load(taxYear);
    const cleanCode = String(code || "").replace(/\D/g, "");

    return (
      data.codes.find(
        (entry) => String(entry.code) === cleanCode
      ) || null
    );
  }

  window.IrsScheduleCCodeCenter = {
    load,
    search,
    findByCode,
    normalize
  };
})();
