const io = require("socket.io-client");
const PROVISION_DATA = require("./_lib/provision-data");

const DEFAULT_BASE_URL = process.env.TARIFKALKULATOR_BASE_URL || "https://tarifrechner.software";
const DEFAULT_SERVICE_ROOT_PATH = process.env.TARIFKALKULATOR_SERVICE_ROOT_PATH || "whitelabel";
const DEFAULT_WHITELABEL_ID = process.env.TARIFKALKULATOR_WHITELABEL_ID || "34ec3a70-d7d4-11ef-982f-df6ea12393d2";
const DEFAULT_COUNTRY = process.env.TARIFKALKULATOR_COUNTRY || "de";
const DEFAULT_COUNTRY_CODE = process.env.TARIFKALKULATOR_COUNTRY_CODE || "81";
const DEFAULT_HOUSE_NUMBER = process.env.TARIFKALKULATOR_HOUSE_NUMBER || "1";

// Providers excluded from "höchste Provision" recommendation due to poor reviews
const BLACKLISTED_PROVIDERS = new Set([
  "immergrün", "immergrun",
  "primastrom",
  "voxenergie",
  "grünwelt energie", "grunwelt energie",
  "extraenergie", "extragrün", "extragrun", "extragrün gmbh",
  "hitstrom", "hitenergie",
  "almado",
  "fuxx", "fuxx sparenergie",
  "365 ag",
  "stromio",
  "gas.de",
  "energy2day", "energy2day gmbh",
  "enstroga",
  "brillant energie", "brillant energie gmbh",
  "sgb energie", "sgb energie gmbh",
  "leu energie", "leu energie gmbh", "leu energie gmbh & co. kg",
  "primaenergy", "prima energy", "primaenergie", "primagas", "primastrom",
  "evd", "evd energieversorgung", "evd energieversorgung deutschland",
  "evm", "evm energie", "energieversorgung mittelrhein", "energieversorgung mittelrhein ag",
].map(n => n.toLowerCase()));

function normalize(text) {
  return String(text || "")
    .toLowerCase()
     .replace(/[\u00e4]/g, "ae")
     .replace(/[\u00f6]/g, "oe")
     .replace(/[\u00fc]/g, "ue")
     .replace(/\u00df/g, "ss")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function trimSlashes(value) {
  return String(value || "").replace(/^\/+|\/+$/g, "");
}

function buildBasePath(serviceRootPath) {
  const root = trimSlashes(serviceRootPath);
  return root ? `/${root}` : "";
}

async function fetchJson(url) {
  const response = await fetch(url, { method: "GET" });
  if (!response.ok) {
    throw new Error(`GET failed (${response.status}) for ${url}`);
  }
  return response.json();
}

async function resolveAddress({
  baseUrl,
  serviceRootPath,
  whitelabelId,
  postalCode,
  country,
}) {
  const pathPrefix = buildBasePath(serviceRootPath);
  const middlewareBase = `${baseUrl}${pathPrefix}/middleware/middleware`;

  const citiesUrl = `${middlewareBase}/cities?id=${encodeURIComponent(whitelabelId)}&zip=${encodeURIComponent(postalCode)}&country=${encodeURIComponent(country)}`;
  const citiesPayload = await fetchJson(citiesUrl);
  const cities = Array.isArray(citiesPayload?.data?.result) ? citiesPayload.data.result : [];
  const city = String(cities[0]?.city || "").trim();
  if (!city) {
    throw new Error("No city found for postal code");
  }

  const streetsUrl = `${middlewareBase}/streets?id=${encodeURIComponent(whitelabelId)}&zip=${encodeURIComponent(postalCode)}&city=${encodeURIComponent(city)}&country=${encodeURIComponent(country)}`;
  const streetsPayload = await fetchJson(streetsUrl);
  const streets = Array.isArray(streetsPayload?.data?.result) ? streetsPayload.data.result : [];
  const street = String(streets[0]?.street || "").trim();
  if (!street) {
    throw new Error("No street found for postal code and city");
  }

  return { city, street };
}

function connectSocket({ baseUrl, serviceRootPath }) {
  const pathPrefix = buildBasePath(serviceRootPath);
  return io(baseUrl, {
    path: `${pathPrefix}/socket.io`,
    transports: ["websocket", "polling"],
    timeout: 20000,
    reconnection: false,
    forceNew: true,
  });
}

async function requestRatecalc({
  baseUrl,
  serviceRootPath,
  payload,
}) {
  const socket = connectSocket({ baseUrl, serviceRootPath });

  try {
    await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Socket connect timeout")), 20000);
        const onConnect = () => {
          clearTimeout(timer);
          resolve();
        };
        const onError = (err) => {
          clearTimeout(timer);
          reject(err);
        };

        socket.on("connect", onConnect);
        socket.on("connect_error", onError);
        socket.on("error", onError);
    });

    const result = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("ratecalc response timeout")), 25000);

      socket.emit("ratecalc", payload, (ack) => {
        clearTimeout(timer);
        resolve(ack);
      });
    });

    if (result?.error) {
      const detail = result?.data?.message || "Unknown ratecalc error";
      throw new Error(detail);
    }

    return Array.isArray(result?.result) ? result.result : [];
  } finally {
    socket.close();
  }
}

// ── Provision matching ────────────────────────────────────────────────────────

function inferContractMonths(tarifName) {
  const name = String(tarifName || "");
  if (/\b36\b/.test(name)) return 36;
  if (/\b24\b/.test(name)) return 24;
  if (/\b12\b/.test(name)) return 12;
  return 24; // default assumption
}

function matchProvision(providerName, rateName, sector, customerGroup, consumption, today) {
  const normP = normalize(providerName);
  const normR = normalize(rateName);
  const todayStr = today || new Date().toISOString().split("T")[0];

  let bestMatch = null;
  let bestSonder = 0;

  for (const row of PROVISION_DATA) {
    if (row.sparte !== sector) continue;
    if (row.typ !== customerGroup) continue;

    const rowProvider = normalize(row.versorger);
    if (!normP.includes(rowProvider) && !rowProvider.includes(normP)) continue;

    const rowTarif = normalize(row.tarif);
    if (!normR.includes(rowTarif) && !rowTarif.includes(normR)) continue;

    // Date validity check
    if (row.gueltigVon && todayStr < row.gueltigVon) continue;
    if (row.gueltigBis && todayStr > row.gueltigBis) continue;

    // Sonderprovision entries (verbrauchVon=0, verbrauchBis=0)
    if (row.verbrauchVon === 0 && row.verbrauchBis === 0 && row.sonderprovision) {
      const sonderMatch = row.sonderprovision.match(/([\d.,]+)/);
      if (sonderMatch) bestSonder += parseFloat(sonderMatch[1].replace(",", ".")) || 0;
      continue;
    }

    // Consumption band check
    if (consumption < row.verbrauchVon || consumption > row.verbrauchBis) continue;

    // Pick the row with the highest base provision
    const rowProv = row.provisionEuro + (row.provisionEuroJeKwh * consumption);
    if (!bestMatch || rowProv > bestMatch._totalProv) {
      bestMatch = { ...row, _totalProv: rowProv };
    }
  }

  if (!bestMatch) return null;
  return {
    provisionEuro: bestMatch._totalProv + bestSonder,
    contractMonths: inferContractMonths(bestMatch.tarif),
  };
}

function isBlacklisted(providerName) {
  const norm = normalize(providerName);
  for (const bl of BLACKLISTED_PROVIDERS) {
    const normBl = normalize(bl);
    if (norm.includes(normBl) || normBl.includes(norm)) return true;
  }
  return false;
}

function isSpottarif(service, allServices) {
  const totalCost = parseFloat(service.totalPrice || service.total_cost_minus_bonuses || service.total_cost || 0) || 0;
  if (totalCost <= 0) return true;

  // Calculate median
  const costs = allServices
    .map(s => parseFloat(s.totalPrice || s.total_cost_minus_bonuses || s.total_cost || 0) || 0)
    .filter(c => c > 0)
    .sort((a, b) => a - b);
  if (!costs.length) return true;
  const median = costs[Math.floor(costs.length / 2)];

  // If total cost is more than 30% below median → Spottarif
  return totalCost < median * 0.7;
}

function extractServiceFields(svc) {
  return {
    resellerName: svc.providerName || svc.reseller_name || "",
    serviceName: svc.rateName || svc.service_name || "",
    workingPriceCt: parseFloat(svc.workPrice || svc.working_price || 0) || 0,
    basePriceEurYear: parseFloat(svc.basePriceYear || svc.base_price || 0) || 0,
    totalCostEurYear: parseFloat(svc.totalPrice || svc.total_cost_minus_bonuses || svc.total_cost || 0) || 0,
  };
}

function pickRecommendations(services, sector, customerGroup, consumption) {
  const today = new Date().toISOString().split("T")[0];

  // Enrich each service with provision data
  const enriched = services.map(svc => {
    const fields = extractServiceFields(svc);
    const prov = matchProvision(
      fields.resellerName, fields.serviceName,
      sector, customerGroup, consumption, today
    );
    return {
      ...fields,
      provisionEuro: prov ? prov.provisionEuro : 0,
      contractMonths: prov ? prov.contractMonths : inferContractMonths(fields.serviceName),
      _raw: svc,
    };
  });

  // Filter out Spottarife
  const nonSpot = enriched.filter(e => !isSpottarif(e._raw, services));

  // Filter by minimum provision
  const minProvFiltered = nonSpot.filter(e => {
    if (e.provisionEuro <= 0) return false;
    if (isBlacklisted(e.resellerName)) return false;
    if (e.contractMonths >= 24) return e.provisionEuro >= 150;
    if (e.contractMonths >= 12) return e.provisionEuro >= 130;
    return e.provisionEuro >= 130;
  });

  if (!minProvFiltered.length) {
    // Fallback: relax provision filter, take top 3 with any provision
    const withProv = nonSpot.filter(e => e.provisionEuro > 0);
    if (!withProv.length) return null;
    const sorted = withProv.sort((a, b) => a.totalCostEurYear - b.totalCostEurYear);
    const pick = sorted[0];
    return {
      sweetspot: formatRec(pick, "sweetspot"),
      cheapest: formatRec(pick, "cheapest"),
      highestProvision: formatRec(pick, "highestProvision"),
      fallback: true,
    };
  }

  // 1) Cheapest: lowest totalCostEurYear
  const sortedByCost = [...minProvFiltered].sort((a, b) => a.totalCostEurYear - b.totalCostEurYear);
  const cheapest = sortedByCost[0];

  // 2) Highest Provision
  const sortedByProv = [...minProvFiltered].sort((a, b) => b.provisionEuro - a.provisionEuro);
  const highestProv = sortedByProv[0];

  // 3) Sweetspot (50/50): score = normalized_savings * 0.5 + normalized_provision * 0.5
  const maxCost = Math.max(...minProvFiltered.map(e => e.totalCostEurYear));
  const minCost = Math.min(...minProvFiltered.map(e => e.totalCostEurYear));
  const maxProv = Math.max(...minProvFiltered.map(e => e.provisionEuro));
  const minProv = Math.min(...minProvFiltered.map(e => e.provisionEuro));
  const costRange = maxCost - minCost || 1;
  const provRange = maxProv - minProv || 1;

  const scored = minProvFiltered.map(e => ({
    ...e,
    _score: 0.5 * (1 - (e.totalCostEurYear - minCost) / costRange) + 0.5 * ((e.provisionEuro - minProv) / provRange),
  }));
  scored.sort((a, b) => b._score - a._score);
  const sweetspot = scored[0];

  return {
    sweetspot: formatRec(sweetspot, "sweetspot"),
    cheapest: formatRec(cheapest, "cheapest"),
    highestProvision: formatRec(highestProv, "highestProvision"),
    totalQualified: minProvFiltered.length,
  };
}

function formatRec(entry, tag) {
  if (!entry) return null;
  return {
    tag,
    resellerName: entry.resellerName,
    serviceName: entry.serviceName,
    workingPriceCt: entry.workingPriceCt,
    basePriceEurYear: entry.basePriceEurYear,
    totalCostEurYear: entry.totalCostEurYear,
    provisionEuro: Math.round(entry.provisionEuro * 100) / 100,
    contractMonths: entry.contractMonths,
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const postalCode = String(body.postalCode || "").trim();
    const sector = String(body.sector || "").trim().toLowerCase();
    const consumption = Number.parseFloat(body.consumption);
    const customerType = String(body.customerType || "Privat").trim().toLowerCase();

    if (!postalCode || !["strom", "gas"].includes(sector) || !Number.isFinite(consumption) || consumption <= 0) {
      return res.status(400).json({ ok: false, error: "postalCode, sector (strom|gas) and consumption are required" });
    }

    const customerGroup = customerType === "privat" ? "privat" : "business";
    const branch = sector === "strom" ? "electric" : "gas";
    const type = customerGroup === "privat" ? "private" : "company";

    const baseUrl = String(DEFAULT_BASE_URL).replace(/\/+$/, "");
    const serviceRootPath = trimSlashes(DEFAULT_SERVICE_ROOT_PATH);
    const whitelabelId = DEFAULT_WHITELABEL_ID;
    const country = String(DEFAULT_COUNTRY || "de").trim().toLowerCase() || "de";
    const countryCode = String(body.countryCode || DEFAULT_COUNTRY_CODE || "81").trim() || "81";

    const { city, street } = await resolveAddress({
      baseUrl,
      serviceRootPath,
      whitelabelId,
      postalCode,
      country,
    });

    const socketPayload = {
      id: whitelabelId,
      branch,
      type,
      country: countryCode,
      zip: postalCode,
      city,
      street,
      houseNumber: String(DEFAULT_HOUSE_NUMBER || "1"),
      consum: consumption,
      filtervar: [],
    };

    if (branch === "electric") {
      socketPayload.consumNt = 0;
      socketPayload.VarFilters = [];
    }

    const services = await requestRatecalc({
      baseUrl,
      serviceRootPath,
      payload: socketPayload,
    });

    if (!services.length) {
      return res.status(502).json({ ok: false, error: "No services returned by ratecalc socket API" });
    }

    const recs = pickRecommendations(services, sector, customerGroup, consumption);
    if (!recs) {
      return res.status(404).json({ ok: false, error: "Keine Tarife mit ausreichender Provision gefunden.", count: services.length });
    }

    return res.status(200).json({
      ok: true,
      sector,
      customerGroup,
      recommendations: {
        sweetspot: recs.sweetspot,
        cheapest: recs.cheapest,
        highestProvision: recs.highestProvision,
      },
      // Backward compat: "reference" = sweetspot
      reference: recs.sweetspot,
      meta: {
        branch,
        type,
        city,
        street,
        country,
        countryCode,
        postalCode,
        consumption,
        totalServices: services.length,
        totalQualified: recs.totalQualified || 0,
        fallback: !!recs.fallback,
      },
    });
  } catch (error) {
    return res.status(500).json({ ok: false, error: "tariff-reference failed", detail: error?.message || String(error) });
  }
};
